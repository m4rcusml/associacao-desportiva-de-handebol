import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { transferirAtleta } from "../dist/modules/atletas/transferencias.js";
import { alterarStatus, substituirQr } from "../dist/modules/carteirinhas/carteirinhas.js";
import { aplicarSuspensao } from "../dist/modules/suspensoes/suspensoes.js";

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

type Metodo = "GET" | "POST" | "PUT" | "DELETE";
const request = (method: Metodo, path: string, cookie = "", body?: unknown, comOrigem = true) => fetch(`${base}${path}`, {
  method,
  headers: { ...(comOrigem ? { Origin: origin } : {}), "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
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
    await tx.authUser.create({ data: { id: authId, name: "Presidente do credenciamento", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente do credenciamento", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
let presidente: Awaited<ReturnType<typeof criarPresidente>>;
type Conta = { id: string; email: string; cookie: string };

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, decisao = "aprovacao", nome = "Pessoa Fictícia" }: { clubeId?: string; decisao?: "aprovacao" | null; nome?: string } = {}): Promise<Conta> {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  if (decisao) assert.equal((await request("POST", `/verificacoes/${id}/${decisao}`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function criarClube(nome: string) {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
async function campeonatoCom(clubesInscritos: string[]) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato do credenciamento", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  return id;
}
const dataLocal = (fuso: string, dias = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + dias * 86_400_000));
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string, dias = 0) {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: `${dataLocal("America/Recife", dias)}T12:00`, fusoHorario: "America/Recife" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}
const nomeCookie = (jogoId: string) => `handebol.arbitragem.${jogoId}`;
/** Entrada pela senha do jogo, sem conta: basta para credenciar (RN-025). */
async function arbitrar(jogoId: string) {
  const senha = (await (await request("GET", `/jogos/${jogoId}/arbitragem/senha`, presidente.cookie)).json()).senha as string;
  throttler.onApplicationShutdown();
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
  assert.equal(response.status, 201, await response.clone().text());
  return response.headers.getSetCookie().find(c => c.startsWith(`${nomeCookie(jogoId)}=`))!.split(";")[0];
}
const iniciarJogo = (jogoId: string) => prisma.jogo.update({ where: { id: jogoId }, data: { status: "em_andamento", iniciadoEm: new Date() } });

/** Dois clubes inscritos, técnico no clube A, jogo de hoje e sessão de arbitragem pela senha. */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const tecnicoA = await cadastrar("tecnico", { nome: "Técnico A" });
  assert.equal((await request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: tecnicoA.id })).status, 200);
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  return { a, b, tecnicoA, campeonato, jogo, arbitro: await arbitrar(jogo) };
}

type Pessoa = { id: string; nomeCompleto: string };
type Participacao = { participacaoId: string; inscricaoId: string; atleta: Pessoa; numeroCamisa: number; credenciadoEm: string; entrouEmQuadraEm: string | null; escalado: boolean };
type Resultado = { participacao: Participacao; alterado: boolean };
type AtletaDoJogo = { atleta: Pessoa; escalado: boolean; credenciamento: Participacao | null; impedimento: string | null };
type Lista = { jogo: { id: string; status: string }; clubes: { inscricaoId: string; clube: { id: string; nome: string }; atletas: AtletaDoJogo[] }[] };

const credenciar = (jogo: string, cookie: string, body: unknown) => request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, cookie, body);
const entrar = (jogo: string, cookie: string, atletaId: string) => request("POST", `/arbitragem/jogos/${jogo}/credenciamentos/${atletaId}/entrada`, cookie);
const lerQr = (jogo: string, cookie: string, tokenQr: string) => request("POST", `/arbitragem/jogos/${jogo}/leitura-qr`, cookie, { tokenQr });
async function ok<T = Resultado>(response: Promise<Response>): Promise<T> {
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
const listar = (jogo: string, cookie: string) => ok<Lista>(request("GET", `/arbitragem/jogos/${jogo}/atletas`, cookie));
const qrDe = async (atletaId: string) => (await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId } })).tokenQr;
const suspender = async (campeonato: string, atletaId: string) => {
  const response = await request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, { atletaId, quantidadeJogos: 1, motivo: "Conduta" });
  assert.equal(response.status, 201, await response.clone().text());
};
const acaoPresidente = async (path: string) => assert.equal((await request("POST", path, presidente.cookie, {})).status, 200, path);

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Jogos levam participações, arbitragens e sessões em cascata; campeonatos levam suspensões.
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

test("arbitragem credencia manualmente escalados e não escalados, com camisa única no clube e repetição sem efeito", async () => {
  const { a, b, tecnicoA, jogo, arbitro } = await cenario();
  const [ana, bruno] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Bruno" })];
  const carla = await cadastrar("atleta", { clubeId: b, nome: "Carla" });
  assert.equal((await request("POST", `/jogos/${jogo}/escalacao`, tecnicoA.cookie, { atletaId: ana.id })).status, 200);

  const inicial = await listar(jogo, arbitro);
  assert.deepEqual(inicial.clubes.map(c => [c.clube.id, c.atletas.map(x => [x.atleta.nomeCompleto, x.escalado, x.credenciamento, x.impedimento])]), [
    [a, [["Ana", true, null, null], ["Bruno", false, null, null]]], [b, [["Carla", false, null, null]]],
  ]);

  // Escalada: a participação da escolha recebe carteirinha, data e camisa juntas, sem entrada em quadra.
  const daAna = await ok(credenciar(jogo.toUpperCase(), arbitro, { atletaId: ana.id.toUpperCase(), numeroCamisa: 0 }));
  assert.equal(daAna.alterado, true);
  assert.deepEqual([daAna.participacao.atleta, daAna.participacao.numeroCamisa, daAna.participacao.escalado, daAna.participacao.entrouEmQuadraEm], [{ id: ana.id, nomeCompleto: "Ana" }, 0, true, null]);
  const registro = await prisma.participacao.findUniqueOrThrow({ where: { id: daAna.participacao.participacaoId } });
  const carteirinhaAna = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: ana.id } });
  assert.deepEqual([registro.carteirinhaId, registro.numeroCamisa, registro.escolhidaPorTecnicoId, registro.entrouEmQuadraEm], [carteirinhaAna.id, 0, tecnicoA.id, null]);
  assert.ok(registro.credenciadoEm);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: ana.id } }), 1);

  // Não escalado (RF-021) e camisa repetida em outro clube são permitidos; repetida no mesmo clube, não.
  await recusa(credenciar(jogo, arbitro, { atletaId: bruno.id, numeroCamisa: 0 }), 409, /camisa 0 já está em uso/);
  const doBruno = await ok(credenciar(jogo, arbitro, { atletaId: bruno.id, numeroCamisa: 10 }));
  assert.equal(doBruno.participacao.escalado, false);
  await ok(credenciar(jogo, arbitro, { atletaId: carla.id, numeroCamisa: 0 }));

  // Repetir com a mesma camisa não duplica; com outra camisa é conflito (correção: MAR-71).
  const repetida = await ok(credenciar(jogo, arbitro, { atletaId: ana.id, numeroCamisa: 0 }));
  assert.deepEqual([repetida.alterado, repetida.participacao.credenciadoEm], [false, daAna.participacao.credenciadoEm]);
  await recusa(credenciar(jogo, arbitro, { atletaId: ana.id, numeroCamisa: 5 }), 409, /já credenciado neste jogo com a camisa 0/);

  // Credenciamento não é escalação: retirar a escolha preserva o credenciamento.
  assert.equal((await request("DELETE", `/jogos/${jogo}/escalacao/${ana.id}`, tecnicoA.cookie)).status, 200);
  const lista = await listar(jogo, arbitro);
  assert.deepEqual(lista.clubes[0].atletas.map(x => [x.atleta.nomeCompleto, x.escalado, x.credenciamento?.numeroCamisa]), [["Ana", false, 0], ["Bruno", false, 10]]);

  // Dados inválidos.
  for (const body of [{}, { atletaId: ana.id }, { numeroCamisa: 1 }, { atletaId: ana.id, numeroCamisa: -1 }, { atletaId: ana.id, numeroCamisa: 1.5 }, { atletaId: ana.id, numeroCamisa: "7" },
    { atletaId: "x", numeroCamisa: 1 }, { atletaId: ana.id, tokenQr: "x", numeroCamisa: 1 }, { atletaId: ana.id, numeroCamisa: 1, entrouEmQuadra: true }]) {
    await recusa(credenciar(jogo, arbitro, body), 400);
  }
  await recusa(credenciar(jogo, arbitro, { atletaId: randomUUID(), numeroCamisa: 1 }), 404);
  await recusa(credenciar(jogo, arbitro, { atletaId: tecnicoA.id, numeroCamisa: 1 }), 404);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, credenciadoEm: { not: null } } }), 3);
});

test("elegibilidade igual no manual e no QR: aprovado, clube do jogo, conta e carteirinha ativas e sem suspensão", async () => {
  const { a, campeonato, jogo, arbitro } = await cenario();
  const pendente = await cadastrar("atleta", { clubeId: a, nome: "Pendente", decisao: null });
  const deFora = await cadastrar("atleta", { clubeId: await criarClube("Clube de fora"), nome: "De Fora" });
  const [desativada, invalidada, suspensa] = [
    await cadastrar("atleta", { clubeId: a, nome: "Desativada" }), await cadastrar("atleta", { clubeId: a, nome: "Invalidada" }), await cadastrar("atleta", { clubeId: a, nome: "Suspensa" }),
  ];
  await acaoPresidente(`/contas/${desativada.id}/desativacao`);
  await acaoPresidente(`/carteirinhas/atleta/${invalidada.id}/invalidacao`);
  await suspender(campeonato, suspensa.id);

  const impedimentos = (await listar(jogo, arbitro)).clubes[0].atletas.map(x => [x.atleta.nomeCompleto, x.impedimento]);
  assert.deepEqual(impedimentos, [["Desativada", "conta_desativada"], ["Invalidada", "carteirinha_invalidada"], ["Suspensa", "suspensao"]]);

  const casos: [Conta, RegExp][] = [
    [pendente, /Somente atleta aprovado/], [deFora, /vínculo atual com um dos clubes do jogo/], [desativada, /conta desativada/],
    [invalidada, /carteirinha invalidada/], [suspensa, /suspensão a cumprir/],
  ];
  for (const [atleta, motivo] of casos) {
    await recusa(credenciar(jogo, arbitro, { atletaId: atleta.id, numeroCamisa: 1 }), 409, motivo);
    if (atleta !== pendente) await recusa(credenciar(jogo, arbitro, { tokenQr: await qrDe(atleta.id), numeroCamisa: 1 }), 409, motivo);
  }
  // A leitura do QR mostra o impedimento sem credenciar.
  const leitura = await ok<{ atleta: Pessoa; carteirinha: { codigo: string; status: string }; clube: { inscricaoId: string } | null; credenciamento: unknown; impedimento: string }>(lerQr(jogo, arbitro, await qrDe(invalidada.id)));
  assert.deepEqual([leitura.atleta.nomeCompleto, leitura.carteirinha.status, leitura.clube?.inscricaoId !== undefined, leitura.credenciamento, leitura.impedimento], ["Invalidada", "invalidada", true, null, "carteirinha_invalidada"]);
  assert.equal((await ok<{ clube: unknown; impedimento: string }>(lerQr(jogo, arbitro, await qrDe(deFora.id)))).impedimento, "sem_vinculo_com_clubes_do_jogo");
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo } }), 0);

  // Corrigida a situação, o mesmo atleta é credenciado.
  await acaoPresidente(`/contas/${desativada.id}/reativacao`);
  await acaoPresidente(`/carteirinhas/atleta/${invalidada.id}/reativacao`);
  await ok(credenciar(jogo, arbitro, { atletaId: desativada.id, numeroCamisa: 1 }));
  await ok(credenciar(jogo, arbitro, { tokenQr: await qrDe(invalidada.id), numeroCamisa: 2 }));

  // O banco repete as regras sem a aplicação.
  const inscricao = await prisma.inscricaoClube.findFirstOrThrow({ where: { campeonatoId: campeonato, clubeId: a } });
  for (const atleta of [suspensa]) {
    const vinculo = await prisma.vinculoClube.findFirstOrThrow({ where: { atletaId: atleta.id, fim: null } });
    const carteirinha = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: atleta.id } });
    await assert.rejects(prisma.participacao.create({ data: { jogoId: jogo, inscricaoClubeId: inscricao.id, vinculoClubeId: vinculo.id, atletaId: atleta.id, carteirinhaId: carteirinha.id, credenciadoEm: new Date(), numeroCamisa: 30 } }));
  }
});

test("QR confirma automaticamente com a camisa; repetido não duplica; substituído não é reconhecido; QR não autoriza", async () => {
  const { a, jogo, arbitro } = await cenario();
  const ana = await cadastrar("atleta", { clubeId: a, nome: "Ana" });
  const qr = await qrDe(ana.id);

  const leitura = await ok<{ atleta: Pessoa; clube: { clube: { id: string } }; credenciamento: unknown; impedimento: unknown }>(lerQr(jogo, arbitro, qr));
  assert.deepEqual([leitura.atleta, leitura.clube.clube.id, leitura.credenciamento, leitura.impedimento], [{ id: ana.id, nomeCompleto: "Ana" }, a, null, null]);
  assert.equal(JSON.stringify(leitura).includes("email"), false, "QR não expõe dados cadastrais");

  const primeiro = await ok(credenciar(jogo, arbitro, { tokenQr: qr, numeroCamisa: 7 }));
  assert.equal(primeiro.alterado, true);
  const repetido = await ok(credenciar(jogo, arbitro, { tokenQr: ` ${qr} `, numeroCamisa: 7 }));
  assert.deepEqual([repetido.alterado, repetido.participacao.participacaoId], [false, primeiro.participacao.participacaoId]);
  // Confirmação manual depois do QR também reconhece o credenciamento existente.
  assert.equal((await ok(credenciar(jogo, arbitro, { atletaId: ana.id, numeroCamisa: 7 }))).alterado, false);
  assert.equal((await ok<{ credenciamento: { numeroCamisa: number } }>(lerQr(jogo, arbitro, qr))).credenciamento.numeroCamisa, 7);

  // QR substituído responde como não reconhecido; o credenciamento existente é preservado.
  await prisma.$transaction(tx => substituirQr(tx, presidente.id, ana.id, 1));
  await recusa(credenciar(jogo, arbitro, { tokenQr: qr, numeroCamisa: 7 }), 404, /QR não reconhecido/);
  await recusa(lerQr(jogo, arbitro, qr), 404);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, credenciadoEm: { not: null } } }), 1);

  // Possuir o QR não concede permissão: sem sessão temporária do jogo, nada é lido nem credenciado.
  const bruno = await cadastrar("atleta", { clubeId: a });
  const qrBruno = await qrDe(bruno.id);
  for (const cookie of ["", presidente.cookie, bruno.cookie, `${nomeCookie(jogo)}=${qrBruno}`]) {
    await recusa(credenciar(jogo, cookie, { tokenQr: qrBruno, numeroCamisa: 8 }), 401);
    await recusa(lerQr(jogo, cookie, qrBruno), 401);
    await recusa(request("GET", `/arbitragem/jogos/${jogo}/atletas`, cookie), 401);
  }
  await recusa(lerQr(jogo, arbitro, "desconhecido"), 404);
  for (const body of [{}, { tokenQr: "" }, { tokenQr: qrBruno, numeroCamisa: 1 }]) await recusa(request("POST", `/arbitragem/jogos/${jogo}/leitura-qr`, arbitro, body), 400);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: bruno.id } }), 0);
});

test("atrasados são credenciados com o jogo em andamento; entrada em quadra uma vez, separada do credenciamento", async () => {
  const { a, campeonato, jogo, arbitro } = await cenario();
  const [ana, bruno, carla, dani] = await Promise.all(["Ana", "Bruno", "Carla", "Dani"].map(nome => cadastrar("atleta", { clubeId: a, nome })));
  await ok(credenciar(jogo, arbitro, { atletaId: ana.id, numeroCamisa: 1 }));
  await ok(credenciar(jogo, arbitro, { atletaId: carla.id, numeroCamisa: 3 }));
  await ok(credenciar(jogo, arbitro, { atletaId: dani.id, numeroCamisa: 4 }));
  // Antes do início não há entrada em quadra.
  await recusa(entrar(jogo, arbitro, ana.id), 409, /jogo em andamento/);

  await iniciarJogo(jogo);
  const atrasado = await ok(credenciar(jogo, arbitro, { tokenQr: await qrDe(bruno.id), numeroCamisa: 2 }));
  assert.equal(atrasado.alterado, true, "atrasado é credenciado após o início (RF-020)");

  const entrada = await ok(entrar(jogo, arbitro, ana.id));
  assert.equal(entrada.alterado, true);
  assert.ok(entrada.participacao.entrouEmQuadraEm);
  const repetida = await ok(entrar(jogo, arbitro, ana.id));
  assert.deepEqual([repetida.alterado, repetida.participacao.entrouEmQuadraEm], [false, entrada.participacao.entrouEmQuadraEm]);
  const lista = await listar(jogo, arbitro);
  assert.deepEqual(lista.clubes[0].atletas.map(x => [x.atleta.nomeCompleto, x.credenciamento?.entrouEmQuadraEm !== null]), [["Ana", true], ["Bruno", false], ["Carla", false], ["Dani", false]]);

  // Suspensão e invalidação posteriores preservam o credenciamento e não impedem a entrada (PEN-011, RN-013).
  await suspender(campeonato, carla.id);
  await acaoPresidente(`/carteirinhas/atleta/${bruno.id}/invalidacao`);
  assert.equal((await ok(credenciar(jogo, arbitro, { atletaId: carla.id, numeroCamisa: 3 }))).alterado, false);
  assert.equal((await ok(entrar(jogo, arbitro, carla.id))).alterado, true);
  assert.equal((await ok(entrar(jogo, arbitro, bruno.id))).alterado, true);
  // Conta desativada não entra em quadra.
  await acaoPresidente(`/contas/${dani.id}/desativacao`);
  await recusa(entrar(jogo, arbitro, dani.id), 409, /conta desativada/);

  // Não credenciado, atleta inexistente e corpo não vazio.
  const semCredenciamento = await cadastrar("atleta", { clubeId: a });
  await recusa(entrar(jogo, arbitro, semCredenciamento.id), 409, /Somente atleta credenciado/);
  await recusa(entrar(jogo, arbitro, randomUUID()), 404);
  await recusa(request("POST", `/arbitragem/jogos/${jogo}/credenciamentos/${ana.id}/entrada`, arbitro, { entrouEmQuadraEm: "agora" }), 400);

  // O banco torna credenciamento e entrada definitivos nesta tarefa (correções: MAR-71).
  const pAna = await prisma.participacao.findFirstOrThrow({ where: { jogoId: jogo, atletaId: ana.id } });
  for (const data of [{ numeroCamisa: 9 }, { entrouEmQuadraEm: null }, { entrouEmQuadraEm: new Date() }, { credenciadoEm: new Date() }, { carteirinhaId: null, credenciadoEm: null, numeroCamisa: null }]) {
    await assert.rejects(prisma.participacao.update({ where: { id: pAna.id }, data }), JSON.stringify(data));
  }
  // Encerrado o jogo, o acesso termina e o banco recusa novos credenciamentos.
  await prisma.jogo.update({ where: { id: jogo }, data: { status: "finalizado", encerradoEm: new Date(), resultado: "normal" } });
  await recusa(credenciar(jogo, arbitro, { atletaId: semCredenciamento.id, numeroCamisa: 5 }), 403, /finalizado/);
  const vinculo = await prisma.vinculoClube.findFirstOrThrow({ where: { atletaId: semCredenciamento.id, fim: null } });
  const carteirinha = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: semCredenciamento.id } });
  await assert.rejects(prisma.participacao.create({ data: { jogoId: jogo, inscricaoClubeId: pAna.inscricaoClubeId, vinculoClubeId: vinculo.id, atletaId: semCredenciamento.id, carteirinhaId: carteirinha.id, credenciadoEm: new Date(), numeroCamisa: 5 } }));
});

test("concorrência: camisa disputada, QR repetido em paralelo e suspensão, invalidação, transferência ou desativação em curso", async () => {
  const { a, campeonato, jogo, arbitro } = await cenario();
  const [ana, bruno] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Bruno" })];

  // Mesma camisa para dois atletas do clube ao mesmo tempo: um credenciado, o outro 409.
  const disputa = await Promise.all([ana, bruno].map(x => credenciar(jogo, arbitro, { atletaId: x.id, numeroCamisa: 9 })));
  assert.deepEqual(disputa.map(r => r.status).sort(), [200, 409]);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, numeroCamisa: 9 } }), 1);

  // O mesmo QR enviado várias vezes em paralelo: um credenciamento só.
  const carla = await cadastrar("atleta", { clubeId: a, nome: "Carla" });
  const qr = await qrDe(carla.id);
  const repetidos = await Promise.all(Array.from({ length: 4 }, () => credenciar(jogo, arbitro, { tokenQr: qr, numeroCamisa: 11 })));
  assert.deepEqual(repetidos.map(r => r.status), [200, 200, 200, 200]);
  assert.deepEqual((await Promise.all(repetidos.map(r => r.json() as Promise<Resultado>))).map(r => r.alterado).sort(), [false, false, false, true]);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: carla.id } }), 1);

  // Operação concorrente que torna o atleta inapto: o credenciamento aguarda o commit e é recusado.
  type Inapto = (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], atletaId: string) => Promise<unknown>;
  const casos: [string, Inapto, RegExp][] = [
    ["suspensão", (tx, id) => aplicarSuspensao(tx, campeonato, presidente.id, { atletaId: id, quantidadeJogos: 1, motivo: "Conduta" }), /suspensão a cumprir/],
    ["invalidação", (tx, id) => alterarStatus(tx, presidente.id, id, "invalidada"), /carteirinha invalidada/],
    ["transferência", (tx, id) => transferirAtleta(tx, id, presidente.id, { clubeAtualId: a, clubeDestinoId: clubes.at(-1)! }), /vínculo atual/],
    ["desativação", async (tx, id) => { await tx.$executeRaw`UPDATE "Usuario" SET ativo = false WHERE id = ${id}::uuid`; }, /conta desativada/],
  ];
  await criarClube("Destino da transferência");
  for (const [nome, inapto, motivo] of casos) {
    const atleta = await cadastrar("atleta", { clubeId: a });
    const qrAtleta = await qrDe(atleta.id);
    let pedido: Promise<Response> | undefined;
    await prisma.$transaction(async tx => {
      await inapto(tx, atleta.id);
      pedido = credenciar(jogo, arbitro, { tokenQr: qrAtleta, numeroCamisa: 50 });
      await esperar(300);
    });
    await recusa(pedido!, 409, motivo);
    assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: atleta.id } }), 0, nome);
  }

  // Substituição do QR em curso: o QR antigo deixa de credenciar.
  const dani = await cadastrar("atleta", { clubeId: a });
  const qrAntigo = await qrDe(dani.id);
  let pedido: Promise<Response> | undefined;
  await prisma.$transaction(async tx => {
    await substituirQr(tx, presidente.id, dani.id, 1);
    pedido = credenciar(jogo, arbitro, { tokenQr: qrAntigo, numeroCamisa: 51 });
    await esperar(300);
  });
  await recusa(pedido!, 404);

  // Quem venceu a disputa da camisa continua credenciado depois de suspenso (o jogo é preservado, PEN-011).
  const vencedor = (await prisma.participacao.findFirstOrThrow({ where: { jogoId: jogo, numeroCamisa: 9 } })).atletaId;
  await suspender(campeonato, vencedor);
  const lista = await listar(jogo, arbitro);
  const doClube = lista.clubes.find(c => c.clube.id === a)!.atletas.find(x => x.atleta.id === vencedor)!;
  assert.deepEqual([doClube.credenciamento?.numeroCamisa, doClube.impedimento], [9, null]);
  assert.equal((await ok(credenciar(jogo, arbitro, { atletaId: vencedor, numeroCamisa: 9 }))).alterado, false);
});

test("acessos cruzados: sessão de outro jogo, sessão encerrada, dia errado e arbitragem designada", async () => {
  const { a, b, campeonato, jogo, arbitro } = await cenario();
  const ana = await cadastrar("atleta", { clubeId: a });
  const outroJogo = await agendar(campeonato, b, a);
  const doOutro = await arbitrar(outroJogo);

  // Cookie de outro jogo (mesmo renomeado) não credencia neste.
  await recusa(credenciar(jogo, doOutro, { atletaId: ana.id, numeroCamisa: 1 }), 401);
  await recusa(credenciar(jogo, doOutro.replace(nomeCookie(outroJogo), nomeCookie(jogo)), { atletaId: ana.id, numeroCamisa: 1 }), 401);
  // Credenciar no outro jogo não afeta este: o atleta pode ser credenciado nos dois.
  await ok(credenciar(outroJogo, doOutro, { atletaId: ana.id, numeroCamisa: 1 }));
  await ok(credenciar(jogo, arbitro, { atletaId: ana.id, numeroCamisa: 1 }));

  // Conta designada (sem vínculo com os clubes) credencia; ao virar técnico de um dos clubes, perde o acesso.
  const designado = await cadastrar("tecnico", { nome: "Árbitro Designado" });
  assert.equal((await request("POST", `/jogos/${jogo}/arbitragens`, presidente.cookie, { usuarioId: designado.id })).status, 201);
  const entrada = await request("POST", `/arbitragem/jogos/${jogo}/entrada/designacao`, designado.cookie, {});
  assert.equal(entrada.status, 201);
  const temporario = entrada.headers.getSetCookie().find(c => c.startsWith(`${nomeCookie(jogo)}=`))!.split(";")[0];
  const bruno = await cadastrar("atleta", { clubeId: b });
  await ok(credenciar(jogo, temporario, { atletaId: bruno.id, numeroCamisa: 2 }));
  assert.equal((await request("PUT", `/clubes/${b}/tecnico`, presidente.cookie, { tecnicoId: designado.id })).status, 200);
  const carla = await cadastrar("atleta", { clubeId: a });
  await recusa(credenciar(jogo, temporario, { atletaId: carla.id, numeroCamisa: 3 }), 403);

  // Sessão encerrada (saída) e falta de origem.
  assert.equal((await request("POST", `/arbitragem/jogos/${jogo}/saida`, arbitro)).status, 200);
  await recusa(credenciar(jogo, arbitro, { atletaId: carla.id, numeroCamisa: 3 }), 401);
  const novo = await arbitrar(jogo);
  await recusa(request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, novo, { atletaId: carla.id, numeroCamisa: 3 }, false), 403);
  await ok(credenciar(jogo, novo, { atletaId: carla.id, numeroCamisa: 3 }));

  // Jogo de amanhã: o acesso (e, com ele, o credenciamento) só abre no dia.
  const amanha = await agendar(campeonato, a, b, 1);
  const senha = (await (await request("GET", `/jogos/${amanha}/arbitragem/senha`, presidente.cookie)).json()).senha as string;
  throttler.onApplicationShutdown();
  assert.equal((await request("POST", `/arbitragem/jogos/${amanha}/entrada/senha`, "", { nomeCompleto: "Árbitra", senha })).status, 403);
  await recusa(credenciar(amanha, novo, { atletaId: carla.id, numeroCamisa: 3 }), 401);
  const inexistente = randomUUID();
  await recusa(credenciar(inexistente, `${nomeCookie(inexistente)}=x`, { atletaId: carla.id, numeroCamisa: 3 }), 404);
  await recusa(request("GET", "/arbitragem/jogos/nao-uuid/atletas", novo), 400);

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const [path, metodo] of [["/arbitragem/jogos/{jogoId}/atletas", "get"], ["/arbitragem/jogos/{jogoId}/leitura-qr", "post"], ["/arbitragem/jogos/{jogoId}/credenciamentos", "post"], ["/arbitragem/jogos/{jogoId}/credenciamentos/{atletaId}/entrada", "post"]]) {
    assert.ok(contrato.paths[path]?.[metodo], `${metodo} ${path}`);
  }
});
