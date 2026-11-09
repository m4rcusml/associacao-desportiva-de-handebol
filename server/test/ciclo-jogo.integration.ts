import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { CofreSenhaArbitragem } from "../dist/modules/arbitragem/senha.js";
import { transicionarCampeonato } from "../dist/modules/campeonatos/campeonatos.js";
import { adiarJogo, encerrarJogo } from "../dist/modules/jogos/ciclo.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const cofre = app.get(CofreSenhaArbitragem);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let base: string;
const password = "Senha-local-de-teste-2026";
const emails: string[] = [];
const clubes: string[] = [];
const campeonatos: string[] = [];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };
const FUSO = "America/Recife";

type Metodo = "GET" | "POST" | "PUT" | "DELETE";
const request = (method: Metodo, path: string, cookie = "", body?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: { Origin: origin, "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const cookies = (response: Response) => response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
async function login(email: string) {
  const response = await request("POST", "/auth/sign-in/email", "", { email, password });
  assert.equal(response.status, 200, await response.clone().text());
  return cookies(response);
}
async function criarPresidente() {
  const email = novoEmail();
  const authId = randomUUID();
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente do ciclo", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente do ciclo", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
let presidente: Awaited<ReturnType<typeof criarPresidente>>;
type Conta = { id: string; email: string; cookie: string };

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, nome = "Pessoa Fictícia" }: { clubeId?: string; nome?: string } = {}): Promise<Conta> {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  assert.equal((await request("POST", `/verificacoes/${id}/aprovacao`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function criarClube(nome: string) {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
async function campeonatoCom(clubesInscritos: string[]) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato do ciclo", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  return id;
}
/** Data local (AAAA-MM-DD) no fuso, deslocada em dias. */
const dataLocal = (dias = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + dias * 86_400_000));
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string) {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: `${dataLocal()}T12:00`, fusoHorario: FUSO });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}
const nomeCookie = (jogoId: string) => `handebol.arbitragem.${jogoId}`;
const cookieDe = (response: Response, jogoId: string) => response.headers.getSetCookie().find(c => c.startsWith(`${nomeCookie(jogoId)}=`))!.split(";")[0];
const senhaDo = async (jogoId: string) => (await (await request("GET", `/jogos/${jogoId}/arbitragem/senha`, presidente.cookie)).json()).senha as string;
const entrarPorSenha = (jogoId: string, senha: string) => {
  throttler.onApplicationShutdown();
  return request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
};
async function arbitrar(jogoId: string) {
  const response = await entrarPorSenha(jogoId, await senhaDo(jogoId));
  assert.equal(response.status, 201, await response.clone().text());
  return cookieDe(response, jogoId);
}
/** Conta de atleta de clube sem relação com o jogo, designada pelo presidente, entra pela designação. */
async function arbitrarPorDesignacao(jogoId: string) {
  const conta = await cadastrar("atleta", { clubeId: await criarClube("Clube neutro"), nome: "Árbitro Designado" });
  assert.equal((await request("POST", `/jogos/${jogoId}/arbitragens`, presidente.cookie, { usuarioId: conta.id })).status, 201);
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/designacao`, conta.cookie, {});
  assert.equal(response.status, 201, await response.clone().text());
  return { conta, cookie: cookieDe(response, jogoId) };
}

async function ok<T>(response: Promise<Response>): Promise<T> {
  const resolvida = await response;
  assert.equal(resolvida.status, 200, await resolvida.clone().text());
  return resolvida.json();
}
async function recusa(response: Promise<Response>, status: number, mensagem?: RegExp) {
  const resolvida = await response;
  const texto = await resolvida.text();
  assert.equal(resolvida.status, status, texto);
  if (mensagem) assert.match(JSON.parse(texto).message, mensagem);
}
type Inicio = { jogo: { id: string; status: string; iniciadoEm: string }; alterado: boolean };
type Encerramento = { jogo: { id: string; status: string; iniciadoEm: string; encerradoEm: string }; placar: { temp_placarClubeA: number; temp_placarClubeB: number }; alterado: boolean };
type JogoDetalhado = { id: string; status: string; inicioPrevistoEm: string | null; inicioPrevistoLocal: string | null; local: string | null; fusoHorario: string };
const iniciar = (jogo: string, cookie: string) => request("POST", `/arbitragem/jogos/${jogo}/inicio`, cookie);
const encerrar = (jogo: string, cookie: string) => request("POST", `/arbitragem/jogos/${jogo}/encerramento`, cookie);
const adiar = (jogo: string, body: unknown, cookie = presidente.cookie) => request("POST", `/jogos/${jogo}/adiamento`, cookie, body);
const cancelar = (jogo: string, cookie = presidente.cookie) => request("POST", `/jogos/${jogo}/cancelamento`, cookie);
const credenciar = (jogo: string, cookie: string, atletaId: string, numeroCamisa: number) =>
  request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, cookie, { atletaId, numeroCamisa });
const lancar = (jogo: string, cookie: string, participacaoId: string, tipo = "temp_gol") =>
  request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, cookie, { operacaoId: randomUUID(), tipo, participacaoId });
const sessao = (jogo: string, cookie: string) => request("GET", `/arbitragem/jogos/${jogo}/sessao`, cookie);
async function suspender(campeonato: string, atletaId: string, quantidadeJogos: number) {
  const response = await request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, { atletaId, quantidadeJogos, motivo: "Conduta antidesportiva" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}

/** Dois clubes inscritos, Ana (A) e Bruno (B) credenciados, Carla (A) sem credenciamento e arbitragem por senha. */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo);
  const [ana, bruno, carla] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: b, nome: "Bruno" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" })];
  const participacao = async (atletaId: string, camisa: number) =>
    (await ok<{ participacao: { participacaoId: string } }>(credenciar(jogo, arbitro, atletaId, camisa))).participacao.participacaoId;
  const pAna = await participacao(ana.id, 7);
  const pBruno = await participacao(bruno.id, 9);
  return { a, b, campeonato, jogo, arbitro, ana, bruno, carla, pAna, pBruno };
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Jogos levam lançamentos, participações, arbitragens, sessões e cumprimentos em cascata; campeonatos, as suspensões.
    await tx.jogo.deleteMany({ where: { campeonatoId: { in: campeonatos } } });
    await tx.campeonato.deleteMany({ where: { id: { in: campeonatos } } });
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = (await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id);
    await tx.carteirinha.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.vinculoClube.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.atleta.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.tecnico.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.clube.deleteMany({ where: { id: { in: clubes } } });
    await tx.presidente.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
  });
  await app.close();
});

test("arbitragem inicia o jogo uma vez; repetição e pedidos simultâneos informam a ação já realizada", async () => {
  const { jogo, arbitro, ana, pAna } = await cenario();
  const outroDispositivo = await arbitrar(jogo);

  // Antes do início: lançamento recusado e encerramento exige jogo iniciado.
  await recusa(lancar(jogo, arbitro, pAna), 409, /jogo em andamento/);
  await recusa(encerrar(jogo, arbitro), 409, /inicie o jogo/);
  for (const cookie of ["", presidente.cookie, ana.cookie]) await recusa(iniciar(jogo, cookie), 401);
  await recusa(iniciar("nao-uuid", arbitro), 400);

  const respostas = await Promise.all([iniciar(jogo, arbitro), iniciar(jogo, outroDispositivo), iniciar(jogo.toUpperCase(), arbitro)]);
  assert.deepEqual(respostas.map(r => r.status), [200, 200, 200]);
  const corpos = await Promise.all(respostas.map(r => r.json() as Promise<Inicio>));
  assert.deepEqual(corpos.map(c => c.alterado).sort(), [false, false, true]);
  assert.deepEqual(new Set(corpos.map(c => c.jogo.iniciadoEm)).size, 1, "um único início registrado");
  assert.deepEqual(corpos.map(c => c.jogo.status), ["em_andamento", "em_andamento", "em_andamento"]);

  // Resposta perdida: reenvio devolve o mesmo início, sem alterá-lo.
  const reenvio = await ok<Inicio>(iniciar(jogo, arbitro));
  assert.deepEqual([reenvio.alterado, reenvio.jogo.iniciadoEm], [false, corpos[0].jogo.iniciadoEm]);
  assert.equal((await ok<{ alterado: boolean }>(lancar(jogo, arbitro, pAna))).alterado, true, "lançamentos liberados após o início");
  // Presidente não inicia pela arbitragem nem cancela/adia jogo em andamento.
  await recusa(cancelar(jogo), 409, /Somente jogo agendado/);
  await recusa(adiar(jogo, { inicioPrevisto: `${dataLocal(1)}T12:00` }), 409, /Somente jogo agendado/);
});

test("encerramento persiste resultado, cumprimento e revogação juntos; reenvio é reconhecido sem reabrir acesso", async () => {
  const { campeonato, a, b, jogo, arbitro, carla, pAna, pBruno } = await cenario();
  const designado = await arbitrarPorDesignacao(jogo);
  const suspensao = await suspender(campeonato, carla.id, 2);
  assert.equal((await ok<Inicio>(iniciar(jogo, designado.cookie))).alterado, true);
  for (const p of [pAna, pAna, pBruno]) await ok(lancar(jogo, arbitro, p));

  // Dois árbitros confirmam ao mesmo tempo: um encerra, o outro recebe a confirmação de ação já realizada.
  const [primeiro, segundo] = await Promise.all([encerrar(jogo, arbitro), encerrar(jogo, designado.cookie)]);
  const corpos = [await ok<Encerramento>(Promise.resolve(primeiro)), await ok<Encerramento>(Promise.resolve(segundo))];
  assert.deepEqual(corpos.map(c => c.alterado).sort(), [false, true]);
  for (const c of corpos) {
    assert.deepEqual([c.jogo.status, c.placar.temp_placarClubeA, c.placar.temp_placarClubeB], ["finalizado", 2, 1]);
    assert.deepEqual(Object.keys(c).sort(), ["alterado", "jogo", "placar"], "confirmação restrita");
  }
  assert.equal(corpos[0].jogo.encerradoEm, corpos[1].jogo.encerradoEm);

  // Cumprimento uma vez, inclusive com reenvios (Carla não jogou, mas o jogo do clube conta).
  const reenvio = await ok<Encerramento>(encerrar(jogo, arbitro));
  assert.deepEqual([reenvio.alterado, reenvio.jogo.encerradoEm], [false, corpos[0].jogo.encerradoEm]);
  assert.deepEqual(await prisma.cumprimentoSuspensao.findMany({ where: { suspensaoId: suspensao }, select: { jogoId: true } }), [{ jogoId: jogo }]);

  // Todas as sessões revogadas pelo encerramento; nenhuma outra operação é liberada pelo reenvio.
  const sessoes = await prisma.sessaoArbitragem.findMany({ where: { arbitragem: { jogoId: jogo } }, select: { revogadaEm: true, motivoRevogacao: true } });
  assert.ok(sessoes.length >= 2);
  assert.ok(sessoes.every(s => s.revogadaEm && s.motivoRevogacao === "jogo_encerrado"));
  for (const cookie of [arbitro, designado.cookie]) {
    await recusa(lancar(jogo, cookie, pAna), 401);
    await recusa(request("GET", `/arbitragem/jogos/${jogo}/lancamentos`, cookie), 401);
    await recusa(sessao(jogo, cookie), 401);
    await recusa(iniciar(jogo, cookie), 401);
    await recusa(credenciar(jogo, cookie, carla.id, 10), 401);
  }
  // Sem sessão ou com sessão de outro jogo, o encerramento não é reconhecido.
  await recusa(encerrar(jogo, ""), 401);
  const outro = await agendar(campeonato, a, b);
  const doOutro = await arbitrar(outro);
  await recusa(encerrar(jogo, doOutro.replace(nomeCookie(outro), nomeCookie(jogo))), 401);
  assert.equal((await ok<{ jogo: { status: string } }>(request("GET", `/arbitragem/jogos/${outro}/sessao`, doOutro))).jogo.status, "agendado", "outros jogos preservados");

  // Senha encerrada; nova entrada recusada; conta designada continua ativa.
  await recusa(request("GET", `/jogos/${jogo}/arbitragem/senha`, presidente.cookie), 409);
  await recusa(entrarPorSenha(jogo, "qualquer"), 403);
  assert.equal((await request("GET", "/sessao", designado.conta.cookie)).status, 200);
  await recusa(request("POST", `/arbitragem/jogos/${jogo}/entrada/designacao`, designado.conta.cookie, {}), 403);
});

test("escrita da arbitragem aguardando o encerramento não grava depois dele", async () => {
  const { jogo, arbitro, carla, pAna } = await cenario();
  await ok(iniciar(jogo, arbitro));
  const token = decodeURIComponent(arbitro.split("=")[1]);
  let pedidos: Promise<Response>[] = [];
  const resultado = await prisma.$transaction(async tx => {
    const encerrado = await encerrarJogo(tx, jogo, token);
    pedidos = [lancar(jogo, arbitro, pAna), credenciar(jogo, arbitro, carla.id, 11)];
    await esperar(300);
    return encerrado;
  });
  assert.equal(resultado.alterado, true);
  for (const pedido of pedidos) await recusa(pedido, 401);
  assert.equal(await prisma.lancamentoJogo.count({ where: { jogoId: jogo } }), 0);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: carla.id } }), 0);

  // Falha na transação desfaz tudo: o jogo continua em andamento e a sessão segue válida.
  const { jogo: outro, arbitro: outroArbitro, campeonato, carla: carlaOutro } = await cenario();
  const suspensa = await suspender(campeonato, carlaOutro.id, 1);
  await ok(iniciar(outro, outroArbitro));
  await assert.rejects(prisma.$transaction(async tx => {
    await encerrarJogo(tx, outro, decodeURIComponent(outroArbitro.split("=")[1]));
    throw new Error("falha depois de encerrar");
  }), /falha depois de encerrar/);
  assert.equal((await prisma.jogo.findUniqueOrThrow({ where: { id: outro } })).status, "em_andamento");
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensa } }), 0);
  assert.equal((await ok<{ jogo: { status: string } }>(sessao(outro, outroArbitro))).jogo.status, "em_andamento");
  assert.equal((await ok<Encerramento>(encerrar(outro, outroArbitro))).alterado, true);
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensa } }), 1);
});

test("adiamento gera nova senha, revoga ambos os métodos e preserva credenciamentos, contas e outros jogos", async () => {
  const { campeonato, a, b, jogo, arbitro, ana, pAna } = await cenario();
  const designado = await arbitrarPorDesignacao(jogo);
  const senhaAntiga = await senhaDo(jogo);
  const outro = await agendar(campeonato, b, a);
  const doOutro = await arbitrar(outro);

  // Somente presidente; dados e jogo validados.
  for (const cookie of ["", ana.cookie, designado.conta.cookie]) await recusa(adiar(jogo, { inicioPrevisto: `${dataLocal(1)}T12:00` }, cookie), cookie ? 403 : 401);
  for (const body of [{}, { inicioPrevisto: "amanhã" }, { inicioPrevisto: `${dataLocal(1)}T12:00`, extra: 1 }, { inicioPrevisto: `${dataLocal(1)}T12:00`, fusoHorario: "Mars/Base" }]) {
    await recusa(adiar(jogo, body), 400);
  }
  await recusa(adiar(jogo, { inicioPrevisto: `${dataLocal(-1)}T12:00` }), 400, /já passou/);
  await recusa(adiar(randomUUID(), { inicioPrevisto: null }), 404);
  assert.equal((await ok<{ jogo: { status: string } }>(sessao(jogo, arbitro))).jogo.status, "agendado", "pedidos recusados não revogam");

  const adiado = await ok<{ jogo: JogoDetalhado; senhaRenovada: boolean; sessoesRevogadas: number }>(adiar(jogo, { inicioPrevisto: `${dataLocal(1)}T15:30`, local: "Ginásio Novo" }));
  assert.deepEqual([adiado.jogo.status, adiado.jogo.inicioPrevistoLocal, adiado.jogo.local, adiado.jogo.fusoHorario, adiado.senhaRenovada], ["agendado", `${dataLocal(1)}T15:30`, "Ginásio Novo", FUSO, true]);
  assert.equal(adiado.sessoesRevogadas, 2);
  assert.equal(JSON.stringify(adiado).includes(senhaAntiga), false, "resposta não expõe senha");

  // Sessões dos dois métodos revogadas com o motivo; senha antiga não entra; acesso depende da nova data.
  for (const cookie of [arbitro, designado.cookie]) await recusa(sessao(jogo, cookie), 401);
  const motivos = await prisma.sessaoArbitragem.findMany({ where: { arbitragem: { jogoId: jogo } }, select: { motivoRevogacao: true } });
  assert.deepEqual(new Set(motivos.map(m => m.motivoRevogacao)), new Set(["jogo_adiado"]));
  const senhaNova = await senhaDo(jogo);
  assert.notEqual(senhaNova, senhaAntiga);
  await recusa(entrarPorSenha(jogo, senhaAntiga), 403, /somente no dia do jogo/);
  await recusa(entrarPorSenha(jogo, senhaNova), 403, /somente no dia do jogo/);
  await recusa(request("POST", `/arbitragem/jogos/${jogo}/entrada/designacao`, designado.conta.cookie, {}), 403);

  // Preservados: credenciamento, designação, conta designada e o outro jogo.
  assert.ok((await prisma.participacao.findUniqueOrThrow({ where: { id: pAna } })).credenciadoEm);
  assert.equal(await prisma.arbitragem.count({ where: { jogoId: jogo, usuarioId: designado.conta.id } }), 1);
  assert.equal((await request("GET", "/sessao", designado.conta.cookie)).status, 200);
  assert.equal((await ok<{ jogo: { status: string } }>(sessao(outro, doOutro))).jogo.status, "agendado");

  // Readiado para hoje: nova senha entra, a antiga não; designação entra de novo.
  await ok(adiar(jogo, { inicioPrevisto: `${dataLocal()}T23:00` }));
  const senhaDeHoje = await senhaDo(jogo);
  await recusa(entrarPorSenha(jogo, senhaNova), 401);
  assert.equal((await entrarPorSenha(jogo, senhaDeHoje)).status, 201);
  assert.equal((await request("POST", `/arbitragem/jogos/${jogo}/entrada/designacao`, designado.conta.cookie, {})).status, 201);

  // Sem nova data: jogo fica sem data e o acesso depende de reagendamento.
  const semData = await ok<{ jogo: JogoDetalhado }>(adiar(jogo, { inicioPrevisto: null }));
  assert.deepEqual([semData.jogo.inicioPrevistoEm, semData.jogo.inicioPrevistoLocal], [null, null]);
  await recusa(entrarPorSenha(jogo, await senhaDo(jogo)), 403, /sem data/);

  // Jogo sem senha emitida: adiamento não gera senha, e a primeira consulta a cria normalmente.
  const semSenha = await agendar(campeonato, a, b);
  const adiadoSemSenha = await ok<{ senhaRenovada: boolean; sessoesRevogadas: number }>(adiar(semSenha, { inicioPrevisto: `${dataLocal(2)}T10:00`, fusoHorario: "America/Sao_Paulo" }));
  assert.deepEqual([adiadoSemSenha.senhaRenovada, adiadoSemSenha.sessoesRevogadas], [false, 0]);
  assert.equal(await prisma.acessoArbitragem.count({ where: { jogoId: semSenha } }), 0);
  assert.equal((await prisma.jogo.findUniqueOrThrow({ where: { id: semSenha } })).fusoHorario, "America/Sao_Paulo");
});

test("credenciamento concorrente com o adiamento aguarda e é recusado com a sessão revogada", async () => {
  const { jogo, arbitro, carla } = await cenario();
  let pedido: Promise<Response> | undefined;
  await prisma.$transaction(async tx => {
    await adiarJogo(tx, cofre, jogo, { inicioPrevisto: `${dataLocal(1)}T12:00` });
    pedido = credenciar(jogo, arbitro, carla.id, 12);
    await esperar(300);
  });
  await recusa(pedido!, 401);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: carla.id } }), 0);
});

test("cancelamento revoga acessos, não conta para suspensão e é idempotente", async () => {
  const { campeonato, a, b, jogo, arbitro, carla, ana } = await cenario();
  const designado = await arbitrarPorDesignacao(jogo);
  const suspensao = await suspender(campeonato, carla.id, 1);
  await recusa(cancelar(jogo, ana.cookie), 403);
  await recusa(cancelar(jogo, arbitro), 401);

  const cancelado = await ok<{ jogo: JogoDetalhado; alterado: boolean }>(cancelar(jogo));
  assert.deepEqual([cancelado.jogo.status, cancelado.alterado], ["cancelado", true]);
  const repetido = await ok<{ jogo: JogoDetalhado; alterado: boolean }>(cancelar(jogo));
  assert.deepEqual([repetido.jogo.status, repetido.alterado], ["cancelado", false]);
  for (const cookie of [arbitro, designado.cookie]) {
    await recusa(sessao(jogo, cookie), 401);
    await recusa(encerrar(jogo, cookie), 401, /indisponível/);
  }
  const sessoes = await prisma.sessaoArbitragem.findMany({ where: { arbitragem: { jogoId: jogo } }, select: { motivoRevogacao: true } });
  assert.deepEqual(new Set(sessoes.map(s => s.motivoRevogacao)), new Set(["jogo_cancelado"]));
  await recusa(request("GET", `/jogos/${jogo}/arbitragem/senha`, presidente.cookie), 409);
  await recusa(adiar(jogo, { inicioPrevisto: `${dataLocal(1)}T12:00` }), 409, /Somente jogo agendado/);
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensao } }), 0, "cancelado não cumpre");
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, credenciadoEm: { not: null } } }), 2, "credenciamentos preservados");
  assert.equal((await request("GET", "/sessao", designado.conta.cookie)).status, 200);

  // Suspensão continua vigente e é cumprida pelo próximo jogo realizado.
  const proximo = await agendar(campeonato, b, a);
  const arbitroProximo = await arbitrar(proximo);
  await ok(iniciar(proximo, arbitroProximo));
  await ok(encerrar(proximo, arbitroProximo));
  assert.deepEqual(await prisma.cumprimentoSuspensao.findMany({ where: { suspensaoId: suspensao }, select: { jogoId: true } }), [{ jogoId: proximo }]);

  // Finalizado não é cancelado.
  await recusa(cancelar(proximo), 409, /Somente jogo agendado/);
});

test("campeonato cancelado com sessões abertas cancela os jogos agendados, revoga acessos e encerra saldos", async () => {
  const { campeonato, a, b, jogo, arbitro, carla } = await cenario();
  const designado = await arbitrarPorDesignacao(jogo);
  const outro = await agendar(campeonato, b, a);
  const doOutro = await arbitrar(outro);
  const suspensao = await suspender(campeonato, carla.id, 3);

  // Início pedido durante o cancelamento do campeonato aguarda e é recusado; nenhum jogo começa.
  let pedido: Promise<Response> | undefined;
  const resposta = await prisma.$transaction(async tx => {
    const resultado = await transicionarCampeonato(tx, campeonato, "cancelar");
    pedido = iniciar(jogo, arbitro);
    await esperar(300);
    return resultado;
  });
  await recusa(pedido!, 401);
  assert.deepEqual([resposta.campeonato.status, resposta.alterado], ["cancelado", true]);
  for (const id of [jogo, outro]) {
    const cancelado = await prisma.jogo.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([cancelado.status, cancelado.iniciadoEm], ["cancelado", null]);
  }
  for (const [id, cookie] of [[outro, doOutro], [jogo, designado.cookie], [jogo, arbitro]] as const) await recusa(sessao(id, cookie), 401);
  const motivos = await prisma.sessaoArbitragem.findMany({ where: { arbitragem: { jogoId: { in: [jogo, outro] } } }, select: { motivoRevogacao: true } });
  assert.deepEqual(new Set(motivos.map(m => m.motivoRevogacao)), new Set(["jogo_cancelado"]));
  const situacao = await prisma.suspensao.findUniqueOrThrow({ where: { id: suspensao }, select: { saldoEncerradoEm: true } });
  assert.ok(situacao.saldoEncerradoEm);
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensao } }), 0);

  // Reconciliação idempotente: repetir não muda saldos nem jogos.
  const repetido = await ok<{ alterado: boolean }>(request("POST", `/campeonatos/${campeonato}/cancelar`, presidente.cookie));
  assert.equal(repetido.alterado, false);
  assert.deepEqual((await prisma.suspensao.findUniqueOrThrow({ where: { id: suspensao }, select: { saldoEncerradoEm: true } })).saldoEncerradoEm, situacao.saldoEncerradoEm);
  assert.equal((await ok<{ alterado: boolean }>(cancelar(outro))).alterado, false);
});

test("banco recusa transições do jogo fora do ciclo e mudanças de agenda após o início", async () => {
  const { jogo, arbitro } = await cenario();
  await assert.rejects(prisma.jogo.update({ where: { id: jogo }, data: { status: "em_andamento" } }), "início exige horário");
  await ok(iniciar(jogo, arbitro));
  const iniciadoEm = (await prisma.jogo.findUniqueOrThrow({ where: { id: jogo } })).iniciadoEm!;
  for (const data of [{ status: "agendado" as const, iniciadoEm: null }, { status: "cancelado" as const, iniciadoEm: null }, { iniciadoEm: new Date(iniciadoEm.getTime() + 1000) },
    { inicioPrevistoEm: new Date() }, { fusoHorario: "UTC" }]) {
    await assert.rejects(prisma.jogo.update({ where: { id: jogo }, data }), JSON.stringify(data));
  }
  await ok(encerrar(jogo, arbitro));
  for (const data of [{ status: "em_andamento" as const, encerradoEm: null }, { encerradoEm: new Date() }, { inicioPrevistoEm: null }]) {
    await assert.rejects(prisma.jogo.update({ where: { id: jogo }, data }), JSON.stringify(data));
  }

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const rota of ["/arbitragem/jogos/{jogoId}/inicio", "/arbitragem/jogos/{jogoId}/encerramento", "/jogos/{jogoId}/adiamento", "/jogos/{jogoId}/cancelamento"]) {
    assert.ok(contrato.paths[rota]?.post, rota);
  }
});
