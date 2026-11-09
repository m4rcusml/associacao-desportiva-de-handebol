import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { consultarResultado, corrigirResultado, interromperJogo } from "../dist/modules/jogos/resultado.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let base: string;
const password = "Senha-local-de-teste-2026";
const emails: string[] = [];
const clubes: string[] = [];
const campeonatos: string[] = [];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };
const FUSO = "America/Recife";

type Metodo = "GET" | "POST";
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
    await tx.authUser.create({ data: { id: authId, name: "Presidente dos excepcionais", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente dos excepcionais", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
let presidente: Awaited<ReturnType<typeof criarPresidente>>;
type Conta = { id: string; email: string; cookie: string };

async function cadastrar(clubeId: string, nome: string): Promise<Conta> {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil: "atleta", clubeId });
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
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato excepcional", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  return id;
}
const dataLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
type JogoDetalhado = {
  id: string; status: string; iniciadoEm: string | null; resultado: string | null; vencedorInscricaoId: string | null; invalidadoEm: string | null;
  interrompidoEm: string | null; clubeA: { inscricaoId: string }; clubeB: { inscricaoId: string };
};
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string) {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: `${dataLocal()}T12:00`, fusoHorario: FUSO });
  assert.equal(response.status, 201, await response.clone().text());
  return await response.json() as JogoDetalhado;
}
const nomeCookie = (jogoId: string) => `handebol.arbitragem.${jogoId}`;
const cookieDe = (response: Response, jogoId: string) => response.headers.getSetCookie().find(c => c.startsWith(`${nomeCookie(jogoId)}=`))!.split(";")[0];
async function arbitrar(jogoId: string) {
  const senha = (await (await request("GET", `/jogos/${jogoId}/arbitragem/senha`, presidente.cookie)).json()).senha as string;
  throttler.onApplicationShutdown();
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
  assert.equal(response.status, 201, await response.clone().text());
  return cookieDe(response, jogoId);
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
  return JSON.parse(texto);
}

type Placar = { placarClubeA: number; placarClubeB: number };
type Vencedor = { inscricaoId: string; clube: { id: string; nome: string } } | null;
type Encerramento = { jogo: { status: string; iniciadoEm: string | null; encerradoEm: string; resultado: string; vencedor: Vencedor }; placar: Placar; alterado: boolean };
type Interrupcao = { jogo: { status: string; interrompidoEm: string | null }; interrupcoes: { interrompidoEm: string; retomadoEm: string | null }[]; alterado: boolean };
type Resultado = {
  jogo: { status: string; resultado: string | null; vencedor: Vencedor }; placar: Placar | null;
  invalidacao: { invalidadoEm: string; motivo: string; presidente: { id: string } } | null;
  interrupcoes: { interrompidoEm: string; retomadoEm: string | null }[];
  alteracoes: { tipo: string; resultadoAnterior: string; inscricaoVencedorAnteriorId: string | null; resultadoNovo: string; inscricaoVencedorNovoId: string | null; motivo: string | null; presidente: { id: string } }[];
  alterado?: boolean;
};
const encerramento = (resultado: string, vencedorInscricaoId: string | null) => ({ resultado, vencedorInscricaoId });
const iniciar = (jogo: string, cookie: string) => ok(request("POST", `/arbitragem/jogos/${jogo}/inicio`, cookie));
const encerrar = (jogo: string, cookie: string, body: unknown) => request("POST", `/arbitragem/jogos/${jogo}/encerramento`, cookie, body);
const interromper = (jogo: string, cookie: string) => request("POST", `/arbitragem/jogos/${jogo}/interrupcao`, cookie);
const retomar = (jogo: string, cookie: string) => request("POST", `/arbitragem/jogos/${jogo}/retomada`, cookie);
const resultadoDo = (jogo: string, cookie = presidente.cookie) => request("GET", `/jogos/${jogo}/resultado`, cookie);
const corrigir = (jogo: string, atual: unknown, novo: unknown, cookie = presidente.cookie) => request("POST", `/jogos/${jogo}/correcao-resultado`, cookie, { atual, novo });
const invalidar = (jogo: string, motivo: unknown, cookie = presidente.cookie) => request("POST", `/jogos/${jogo}/invalidacao`, cookie, { motivo });
const credenciar = (jogo: string, cookie: string, atletaId: string, numeroCamisa: number) =>
  request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, cookie, { atletaId, numeroCamisa });
const entrar = (jogo: string, cookie: string, atletaId: string) => request("POST", `/arbitragem/jogos/${jogo}/credenciamentos/${atletaId}/entrada`, cookie);
const lancar = (jogo: string, cookie: string, participacaoId: string, tipo = "gol") =>
  request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, cookie, { operacaoId: randomUUID(), tipo, participacaoId });
async function suspender(campeonato: string, atletaId: string, quantidadeJogos: number) {
  const response = await request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, { atletaId, quantidadeJogos, motivo: "Conduta antidesportiva" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}
const cumprimentos = (suspensaoId: string) => prisma.cumprimentoSuspensao.findMany({ where: { suspensaoId }, select: { jogoId: true } });
const placarDe = (p: Placar | null) => p && [p.placarClubeA, p.placarClubeB];

/** Ana (A) e Bruno (B) credenciados; Carla (A) sem credenciamento; Duda (A) suspensa por 3 jogos; arbitragem por senha. */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo.id);
  const [ana, bruno, carla, duda] = [await cadastrar(a, "Ana"), await cadastrar(b, "Bruno"), await cadastrar(a, "Carla"), await cadastrar(a, "Duda")];
  const participacao = async (atletaId: string, camisa: number) =>
    (await ok<{ participacao: { participacaoId: string } }>(credenciar(jogo.id, arbitro, atletaId, camisa))).participacao.participacaoId;
  const pAna = await participacao(ana.id, 7);
  const pBruno = await participacao(bruno.id, 9);
  const suspensao = await suspender(campeonato, duda.id, 3);
  return { a, b, campeonato, jogo: jogo.id, inscricaoA: jogo.clubeA.inscricaoId, inscricaoB: jogo.clubeB.inscricaoId, arbitro, ana, bruno, carla, duda, pAna, pBruno, suspensao };
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Jogos levam lançamentos, participações, arbitragens, interrupções, históricos e cumprimentos em cascata.
    await tx.jogo.deleteMany({ where: { campeonatoId: { in: campeonatos } } });
    await tx.campeonato.deleteMany({ where: { id: { in: campeonatos } } });
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = (await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id);
    await tx.carteirinha.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.vinculoClube.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.atleta.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.clube.deleteMany({ where: { id: { in: clubes } } });
    await tx.presidente.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
  });
  await app.close();
});

test("interrupção mantém o mesmo jogo em andamento, pausa lançamentos e entradas e só cumpre no encerramento definitivo", async () => {
  const { jogo, arbitro, ana, carla, pAna, pBruno, suspensao, inscricaoA } = await cenario();
  await recusa(interromper(jogo, arbitro), 409, /Somente jogo em andamento/);
  await iniciar(jogo, arbitro);
  for (const p of [pAna, pAna, pBruno]) await ok(lancar(jogo, arbitro, p));
  await recusa(interromper(jogo, ""), 401);
  await recusa(interromper(jogo, presidente.cookie), 401);

  const pausa = await ok<Interrupcao>(interromper(jogo, arbitro));
  assert.deepEqual([pausa.alterado, pausa.jogo.status, pausa.interrupcoes.length, pausa.interrupcoes[0].retomadoEm], [true, "em_andamento", 1, null]);
  assert.equal(pausa.jogo.interrompidoEm, pausa.interrupcoes[0].interrompidoEm);
  const repetida = await ok<Interrupcao>(interromper(jogo, arbitro));
  assert.deepEqual([repetida.alterado, repetida.interrupcoes.length], [false, 1], "repetir não abre outra interrupção");
  assert.equal((await ok<JogoDetalhado>(request("GET", `/jogos/${jogo}`, presidente.cookie))).interrompidoEm, pausa.jogo.interrompidoEm);

  // Durante a interrupção: sem lançamento novo nem entrada em quadra, inclusive direto no banco; credenciamento continua.
  await recusa(lancar(jogo, arbitro, pAna), 409, /interrompido/);
  await recusa(entrar(jogo, arbitro, ana.id), 409, /interrompido/);
  await assert.rejects(prisma.lancamentoJogo.create({ data: { operacaoId: randomUUID(), jogoId: jogo, participacaoId: pAna, tipo: "gol", registradoEm: new Date() } }));
  await assert.rejects(prisma.participacao.update({ where: { id: pAna }, data: { entrouEmQuadraEm: new Date() } }));
  assert.equal((await credenciar(jogo, arbitro, carla.id, 11)).status, 200);
  assert.deepEqual(await cumprimentos(suspensao), [], "interrupção temporária não cumpre");

  // Retomada: o mesmo jogo, com os mesmos registros; repetir não tem efeito.
  const retomada = await ok<Interrupcao>(retomar(jogo, arbitro));
  assert.deepEqual([retomada.alterado, retomada.jogo.status, retomada.jogo.interrompidoEm], [true, "em_andamento", null]);
  assert.ok(retomada.interrupcoes[0].retomadoEm);
  assert.equal((await ok<Interrupcao>(retomar(jogo, arbitro))).alterado, false);
  assert.equal((await ok<{ alterado: boolean }>(entrar(jogo, arbitro, ana.id))).alterado, true);
  assert.deepEqual(placarDe((await ok<{ placar: Placar }>(lancar(jogo, arbitro, pAna))).placar), [3, 1], "placar preservado após a retomada");

  // Nova interrupção e encerramento definitivo durante ela: interrompido, conta uma vez para a suspensão.
  await ok(interromper(jogo, arbitro));
  const fim = await ok<Encerramento>(encerrar(jogo, arbitro, encerramento("interrompido", inscricaoA)));
  assert.deepEqual([fim.alterado, fim.jogo.status, fim.jogo.resultado, fim.jogo.vencedor?.inscricaoId, placarDe(fim.placar)], [true, "finalizado", "interrompido", inscricaoA, [3, 1]]);
  assert.equal((await ok<Encerramento>(encerrar(jogo, arbitro, encerramento("normal", null)))).alterado, false, "reenvio não muda o resultado");
  assert.deepEqual(await cumprimentos(suspensao), [{ jogoId: jogo }]);
  const consulta = await ok<Resultado>(resultadoDo(jogo));
  assert.deepEqual(consulta.interrupcoes.map(i => i.retomadoEm === null), [false, true]);
  assert.deepEqual([consulta.jogo.resultado, consulta.jogo.vencedor?.inscricaoId], ["interrompido", inscricaoA]);
  assert.equal((await ok<JogoDetalhado>(request("GET", `/jogos/${jogo}`, presidente.cookie))).interrompidoEm, null);
  await recusa(retomar(jogo, arbitro), 401);
  await assert.rejects(prisma.interrupcaoJogo.create({ data: { jogoId: jogo, interrompidoEm: new Date() } }), "banco recusa interrupção de jogo finalizado");
});

test("interrupção concorrente com um lançamento: o lançamento aguarda e é recusado", async () => {
  const { jogo, arbitro, pAna } = await cenario();
  await iniciar(jogo, arbitro);
  const token = decodeURIComponent(arbitro.split("=")[1]);
  let pedido: Promise<Response> | undefined;
  await prisma.$transaction(async tx => {
    await interromperJogo(tx, jogo, token);
    pedido = lancar(jogo, arbitro, pAna);
    await esperar(300);
  });
  await recusa(pedido!, 409, /interrompido/);
  assert.equal(await prisma.lancamentoJogo.count({ where: { jogoId: jogo } }), 0);
});

test("consulta do resultado não mistura jogo e histórico de uma correção concorrente", async () => {
  const { jogo, arbitro, inscricaoA } = await cenario();
  await iniciar(jogo, arbitro);
  await ok(encerrar(jogo, arbitro, encerramento("normal", inscricaoA)));
  let escrita: Promise<unknown> | undefined;
  const anterior = await prisma.$transaction(async tx => {
    const [{ pid: leitor }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    // Pausa após ler o jogo: o escritor confirma (antes da correção) ou aguarda o bloqueio da consulta.
    const leitura = new Proxy(tx, { get(target, property, receiver) {
      if (property !== "jogo") return Reflect.get(target, property, receiver);
      return new Proxy(target.jogo, { get(model, key) {
        if (key !== "findUnique") return Reflect.get(model, key);
        return async (args: Parameters<typeof model.findUnique>[0]) => {
          const dados = await model.findUnique(args);
          let escritor = 0;
          let terminou = false;
          escrita = prisma.$transaction(async concorrente => {
            [{ pid: escritor }] = await concorrente.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            return corrigirResultado(concorrente, presidente.id, jogo, {
              atual: { resultado: "normal", vencedorInscricaoId: inscricaoA },
              novo: { resultado: "abandono", vencedorInscricaoId: null },
            });
          });
          void escrita.then(() => { terminou = true; }, () => { terminou = true; });
          const limite = Date.now() + 3000;
          while (!terminou) {
            const [{ bloqueado }] = await prisma.$queryRaw<{ bloqueado: boolean }[]>`
              SELECT ${leitor}::int = ANY(pg_blocking_pids(${escritor}::int)) AS bloqueado`;
            if (bloqueado) break;
            assert.ok(Date.now() < limite, "escritor deve confirmar ou aguardar a consulta");
            await esperar(10);
          }
          return dados;
        };
      } });
    } });
    return consultarResultado(leitura, jogo);
  });
  await escrita;
  assert.deepEqual([anterior.jogo.resultado, anterior.jogo.vencedor?.inscricaoId, anterior.alteracoes.length],
    ["normal", inscricaoA, 0], "consulta anterior não pode conter o histórico de um resultado que ainda não apresenta");
  const posterior = await ok<Resultado>(resultadoDo(jogo));
  assert.deepEqual([posterior.jogo.resultado, posterior.jogo.vencedor, posterior.alteracoes.length], ["abandono", null, 1]);
});

test("W.O. sem início fica 0 a 0, cumpre suspensão uma vez e exige jogo não iniciado", async () => {
  const { campeonato, a, b, jogo, arbitro, suspensao, inscricaoB } = await cenario();
  for (const body of [undefined, {}, { resultado: "wo" }, { resultado: "empate", vencedorInscricaoId: null }, { ...encerramento("wo", null), extra: 1 }]) {
    await recusa(encerrar(jogo, arbitro, body), 400);
  }
  await recusa(encerrar(jogo, arbitro, encerramento("wo", randomUUID())), 400, /inscrição do clube A ou do clube B/);
  await recusa(encerrar(jogo, arbitro, encerramento("normal", null)), 409, /inicie o jogo/);
  await recusa(encerrar(jogo, "", encerramento("wo", inscricaoB)), 401);

  const wo = await ok<Encerramento>(encerrar(jogo, arbitro, encerramento("wo", inscricaoB)));
  assert.deepEqual([wo.alterado, wo.jogo.status, wo.jogo.iniciadoEm, wo.jogo.resultado, wo.jogo.vencedor?.inscricaoId, placarDe(wo.placar)],
    [true, "finalizado", null, "wo", inscricaoB, [0, 0]]);
  assert.ok(wo.jogo.encerradoEm);
  const reenvio = await ok<Encerramento>(encerrar(jogo, arbitro, encerramento("wo", inscricaoB)));
  assert.deepEqual([reenvio.alterado, reenvio.jogo.encerradoEm], [false, wo.jogo.encerradoEm]);
  assert.deepEqual(await cumprimentos(suspensao), [{ jogoId: jogo }], "W.O. conta uma vez");
  const sessoes = await prisma.sessaoArbitragem.findMany({ where: { arbitragem: { jogoId: jogo } }, select: { motivoRevogacao: true } });
  assert.deepEqual(new Set(sessoes.map(s => s.motivoRevogacao)), new Set(["jogo_encerrado"]));

  // Jogo já iniciado não é W.O.
  const outro = await agendar(campeonato, b, a);
  const arbitroOutro = await arbitrar(outro.id);
  await iniciar(outro.id, arbitroOutro);
  await recusa(encerrar(outro.id, arbitroOutro, encerramento("wo", outro.clubeA.inscricaoId)), 409, /W\.O\. encerra somente jogo ainda não iniciado/);
  assert.equal((await ok<JogoDetalhado>(request("GET", `/jogos/${outro.id}`, presidente.cookie))).status, "em_andamento");

  // Banco: W.O. somente sem início, demais somente com início; vencedor só de inscrição do jogo.
  const avulso = await agendar(campeonato, a, b);
  await assert.rejects(prisma.jogo.update({ where: { id: avulso.id }, data: { status: "finalizado", encerradoEm: new Date(), resultado: "normal" } }));
  await assert.rejects(prisma.jogo.update({ where: { id: avulso.id }, data: { status: "finalizado", encerradoEm: new Date() } }));
  await assert.rejects(prisma.jogo.update({ where: { id: avulso.id }, data: { status: "finalizado", encerradoEm: new Date(), resultado: "wo", inscricaoClubeVencedorId: randomUUID() } }));
  await assert.rejects(prisma.jogo.update({ where: { id: avulso.id }, data: { resultado: "wo" } }), "resultado só com o jogo finalizado");
});

test("abandono sem vencedor preserva placar e estatísticas individuais", async () => {
  const { jogo, arbitro, pAna, pBruno } = await cenario();
  await iniciar(jogo, arbitro);
  for (const [p, tipo] of [[pAna, "gol"], [pBruno, "gol"], [pBruno, "cartaoAmarelo"]] as const) await ok(lancar(jogo, arbitro, p, tipo));
  const fim = await ok<Encerramento>(encerrar(jogo, arbitro, encerramento("abandono", null)));
  assert.deepEqual([fim.jogo.resultado, fim.jogo.vencedor, placarDe(fim.placar)], ["abandono", null, [1, 1]]);
  const registros = await ok<{ desempenho: { participacaoId: string; gols: number; cartoesAmarelos: number }[] }>(request("GET", `/jogos/${jogo}/lancamentos`, presidente.cookie));
  const de = (id: string) => registros.desempenho.find(d => d.participacaoId === id)!;
  assert.deepEqual([de(pAna).gols, de(pBruno).gols, de(pBruno).cartoesAmarelos], [1, 1, 1]);
  const detalhe = await ok<JogoDetalhado>(request("GET", `/jogos/${jogo}`, presidente.cookie));
  assert.deepEqual([detalhe.status, detalhe.resultado, detalhe.vencedorInscricaoId, detalhe.invalidadoEm], ["finalizado", "abandono", null, null]);
});

test("após o encerramento somente o presidente corrige o resultado e invalida, com histórico e sem recontar", async () => {
  const { campeonato, a, b, jogo, arbitro, ana, pAna, suspensao, inscricaoA, inscricaoB } = await cenario();
  await iniciar(jogo, arbitro);
  await ok(lancar(jogo, arbitro, pAna));
  // Antes do encerramento, o presidente não altera o resultado.
  await recusa(corrigir(jogo, encerramento("normal", null), encerramento("abandono", null)), 409, /somente após o encerramento/);
  await recusa(invalidar(jogo, "Atleta irregular"), 409, /somente após o encerramento/);
  await ok(encerrar(jogo, arbitro, encerramento("normal", inscricaoA)));
  const normalA = encerramento("normal", inscricaoA);

  // Permissões e validações.
  for (const cookie of [ana.cookie, arbitro]) {
    await recusa(corrigir(jogo, normalA, encerramento("abandono", null), cookie), cookie === arbitro ? 401 : 403);
    await recusa(invalidar(jogo, "x", cookie), cookie === arbitro ? 401 : 403);
    await recusa(resultadoDo(jogo, cookie), cookie === arbitro ? 401 : 403);
  }
  await recusa(corrigir(jogo, normalA, encerramento("abandono", randomUUID())), 400);
  await recusa(request("POST", `/jogos/${jogo}/correcao-resultado`, presidente.cookie, { novo: normalA }), 400);
  await recusa(invalidar(jogo, " "), 400);
  await recusa(corrigir(randomUUID(), normalA, encerramento("abandono", null)), 404);
  await recusa(corrigir(jogo, normalA, encerramento("wo", inscricaoA)), 409, /não é W\.O\./);
  const divergente = await recusa(corrigir(jogo, encerramento("normal", inscricaoB), encerramento("abandono", null)), 409, /difere/);
  assert.equal(divergente.resultado.jogo.vencedor.inscricaoId, inscricaoA, "conflito devolve o resultado vigente");

  // Correção e repetição.
  const corrigido = await ok<Resultado>(corrigir(jogo, normalA, encerramento("abandono", null)));
  assert.deepEqual([corrigido.alterado, corrigido.jogo.resultado, corrigido.jogo.vencedor], [true, "abandono", null]);
  assert.equal((await ok<Resultado>(corrigir(jogo, normalA, encerramento("abandono", null)))).alterado, false, "repetição sem efeito");

  // Invalidação posterior, definitiva; correção ainda possível depois dela.
  const invalidado = await ok<Resultado>(invalidar(jogo, "Atleta irregular"));
  assert.deepEqual([invalidado.alterado, invalidado.invalidacao?.motivo, invalidado.invalidacao?.presidente.id], [true, "Atleta irregular", presidente.id]);
  const repetida = await ok<Resultado>(invalidar(jogo, "Outro motivo"));
  assert.deepEqual([repetida.alterado, repetida.invalidacao?.motivo, repetida.invalidacao?.invalidadoEm], [false, "Atleta irregular", invalidado.invalidacao?.invalidadoEm]);
  await ok(corrigir(jogo, encerramento("abandono", null), encerramento("normal", inscricaoB)));

  const final = await ok<Resultado>(resultadoDo(jogo));
  assert.deepEqual([final.jogo.resultado, final.jogo.vencedor?.inscricaoId, placarDe(final.placar)], ["normal", inscricaoB, [1, 0]], "placar preservado");
  assert.deepEqual(final.alteracoes.map(a => [a.tipo, a.resultadoAnterior, a.inscricaoVencedorAnteriorId, a.resultadoNovo, a.inscricaoVencedorNovoId, a.motivo]), [
    ["correcao", "normal", inscricaoA, "abandono", null, null],
    ["invalidacao", "abandono", null, "abandono", null, "Atleta irregular"],
    ["correcao", "abandono", null, "normal", inscricaoB, null],
  ]);
  assert.ok(final.alteracoes.every(a => a.presidente.id === presidente.id));
  assert.deepEqual(await cumprimentos(suspensao), [{ jogoId: jogo }], "correção e invalidação não recontam");
  await recusa(request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, arbitro, { operacaoId: randomUUID(), tipo: "gol", participacaoId: pAna }), 401);

  // Banco: alteração sem histórico, desfazer invalidação e apagar o histórico são recusados.
  await assert.rejects(prisma.jogo.update({ where: { id: jogo }, data: { inscricaoClubeVencedorId: inscricaoA } }));
  await assert.rejects(prisma.jogo.update({ where: { id: jogo }, data: { invalidadoEm: null } }));
  await assert.rejects(prisma.alteracaoResultadoJogo.deleteMany({ where: { jogoId: jogo } }));
  await assert.rejects(prisma.alteracaoResultadoJogo.updateMany({ where: { jogoId: jogo }, data: { motivo: "outro" } }));

  // W.O.: somente o vencedor muda.
  const wo = await agendar(campeonato, b, a);
  const arbitroWo = await arbitrar(wo.id);
  await ok(encerrar(wo.id, arbitroWo, encerramento("wo", null)));
  await recusa(corrigir(wo.id, encerramento("wo", null), encerramento("normal", null)), 409, /permanece W\.O\./);
  const vencedorWo = await ok<Resultado>(corrigir(wo.id, encerramento("wo", null), encerramento("wo", wo.clubeB.inscricaoId)));
  assert.deepEqual([vencedorWo.jogo.resultado, vencedorWo.jogo.vencedor?.inscricaoId, placarDe(vencedorWo.placar)], ["wo", wo.clubeB.inscricaoId, [0, 0]]);
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensao } }), 2, "cada jogo cumpre uma vez");

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const [rota, metodo] of [["/arbitragem/jogos/{jogoId}/interrupcao", "post"], ["/arbitragem/jogos/{jogoId}/retomada", "post"], ["/jogos/{jogoId}/resultado", "get"],
    ["/jogos/{jogoId}/correcao-resultado", "post"], ["/jogos/{jogoId}/invalidacao", "post"]] as const) {
    assert.ok(contrato.paths[rota]?.[metodo], rota);
  }
  assert.ok(contrato.paths["/arbitragem/jogos/{jogoId}/encerramento"].post.requestBody);
});
