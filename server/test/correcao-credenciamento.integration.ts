import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { encerrarJogo } from "../dist/modules/jogos/ciclo.js";
import {
  corrigirCamisaPelaArbitragem, estornarCredenciamento, registrarEntrada, traduzirErroCredenciamento,
} from "../dist/modules/participacoes/credenciamento.js";
import { registrarLancamento } from "../dist/modules/resultados/lancamentos.js";

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
    await tx.authUser.create({ data: { id: authId, name: "Presidente dos credenciamentos", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente dos credenciamentos", perfil: "presidente", presidente: { create: {} } } });
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
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato das correções de credenciamento", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  return id;
}
const dataLocal = (fuso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string) {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: `${dataLocal("America/Recife")}T12:00`, fusoHorario: "America/Recife" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}
const nomeCookie = (jogoId: string) => `handebol.arbitragem.${jogoId}`;
async function arbitrar(jogoId: string) {
  const senha = (await (await request("GET", `/jogos/${jogoId}/arbitragem/senha`, presidente.cookie)).json()).senha as string;
  throttler.onApplicationShutdown();
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
  assert.equal(response.status, 201, await response.clone().text());
  return response.headers.getSetCookie().find(c => c.startsWith(`${nomeCookie(jogoId)}=`))!.split(";")[0];
}
const tokenDe = (cookie: string) => decodeURIComponent(cookie.split("=")[1]);

type Pessoa = { id: string; nomeCompleto: string };
type Participacao = { participacaoId: string; inscricaoId: string; atleta: Pessoa; numeroCamisa: number; credenciadoEm: string; entrouEmQuadraEm: string | null; escalado: boolean };
type Alteracao = { id: string; tipo: string; inscricaoId: string; atleta: Pessoa; credenciadoEm: string; numeroCamisaAnterior: number; numeroCamisaNova: number | null; registradaEm: string };
type Correcao = { participacao: Participacao; alteracao?: Alteracao; alterado: boolean };
type Estorno = { estorno: Alteracao; alterado: boolean };

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
  return texto ? JSON.parse(texto) : null;
}
const ARBITRAGEM = "/arbitragem/jogos";
const credenciar = async (jogo: string, cookie: string, atletaId: string, numeroCamisa: number) =>
  (await ok<{ participacao: Participacao }>(request("POST", `${ARBITRAGEM}/${jogo}/credenciamentos`, cookie, { atletaId, numeroCamisa }))).participacao;
const corrigir = (jogo: string, cookie: string, atletaId: string, numeroCamisaAtual: number, numeroCamisa: number, rota = ARBITRAGEM) =>
  request("POST", `${rota}/${jogo}/credenciamentos/${atletaId}/camisa`, cookie, { numeroCamisaAtual, numeroCamisa });
const estornar = (jogo: string, cookie: string, atletaId: string, numeroCamisa: number) =>
  request("POST", `${ARBITRAGEM}/${jogo}/credenciamentos/${atletaId}/estorno`, cookie, { numeroCamisa });
const entrar = (jogo: string, cookie: string, atletaId: string) => ok<{ participacao: Participacao }>(request("POST", `${ARBITRAGEM}/${jogo}/credenciamentos/${atletaId}/entrada`, cookie));
const iniciar = (jogo: string, cookie: string) => ok(request("POST", `${ARBITRAGEM}/${jogo}/inicio`, cookie));
const lancar = async (jogo: string, cookie: string, participacaoId: string) =>
  (await ok<{ lancamento: { id: string } }>(request("POST", `${ARBITRAGEM}/${jogo}/lancamentos`, cookie, { operacaoId: randomUUID(), tipo: "gol", participacaoId }))).lancamento;
const historico = (jogoId: string) => prisma.alteracaoCredenciamento.findMany({ where: { jogoId }, orderBy: [{ registradaEm: "asc" }, { id: "asc" }] });
const camisas = async (jogo: string) => Object.fromEntries((await prisma.participacao.findMany({
  where: { jogoId: jogo, credenciadoEm: { not: null } }, select: { numeroCamisa: true, atleta: { select: { usuario: { select: { nomeCompleto: true } } } } },
})).map(p => [p.atleta.usuario.nomeCompleto, p.numeroCamisa]));

/** Dois clubes inscritos com técnico no A; Ana (7) e Carla (8) do A e Bruno (9) do B credenciados; Davi do A sem credenciamento. */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const tecnicoA = await cadastrar("tecnico", { nome: "Técnico A" });
  assert.equal((await request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: tecnicoA.id })).status, 200);
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo);
  const [ana, bruno, carla, davi] = [
    await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: b, nome: "Bruno" }),
    await cadastrar("atleta", { clubeId: a, nome: "Carla" }), await cadastrar("atleta", { clubeId: a, nome: "Davi" }),
  ];
  const pAna = (await credenciar(jogo, arbitro, ana.id, 7)).participacaoId;
  const pBruno = (await credenciar(jogo, arbitro, bruno.id, 9)).participacaoId;
  const pCarla = (await credenciar(jogo, arbitro, carla.id, 8)).participacaoId;
  return { a, b, tecnicoA, campeonato, jogo, arbitro, ana, bruno, carla, davi, pAna, pBruno, pCarla };
}

/**
 * A primeira operação grava e mantém a transação aberta; a segunda começa e precisa aguardar um bloqueio de linha
 * (`wait_event_type = 'Lock'`) antes de a primeira confirmar. Devolve o resultado das duas.
 */
async function emDisputa<A, B>(primeira: (tx: PrismaService) => Promise<A>, segunda: (tx: PrismaService) => Promise<B>) {
  let gravou!: () => void;
  let liberar!: () => void;
  let conectou!: (pid: number) => void;
  const gravada = new Promise<void>(resolve => { gravou = resolve; });
  const liberacao = new Promise<void>(resolve => { liberar = resolve; });
  const conectada = new Promise<number>(resolve => { conectou = resolve; });
  const vencedora = prisma.$transaction(async tx => {
    try { return await primeira(tx as PrismaService); } finally { gravou(); await liberacao; }
  }, { timeout: 15_000 });
  await gravada;
  let terminou = false;
  const concorrente = prisma.$transaction(async tx => {
    const [conexao] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    conectou(conexao.pid);
    return segunda(tx as PrismaService);
  }, { timeout: 15_000 }).then(valor => ({ valor, erro: null }), erro => ({ valor: null, erro: traduzirErroCredenciamento(erro) as { getStatus?: () => number; message: string } }))
    .finally(() => { terminou = true; });
  let aguardou = false;
  try {
    const pid = await conectada;
    const limite = Date.now() + 5_000;
    while (!terminou) {
      const [estado] = await prisma.$queryRaw<{ aguardando: boolean }[]>`SELECT wait_event_type = 'Lock' AS aguardando FROM pg_stat_activity WHERE pid = ${pid}`;
      if (estado?.aguardando) { aguardou = true; break; }
      assert.ok(Date.now() < limite, "operação concorrente não chegou à disputa do bloqueio");
      await setTimeout(10);
    }
  } finally {
    liberar();
  }
  return { primeira: await vencedora, segunda: await concorrente, aguardou };
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Jogos levam lançamentos, participações, histórico, arbitragens, sessões e cumprimentos em cascata.
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

test("arbitragem corrige a camisa antes e durante o jogo, inclusive após a entrada, sem repetir camisa no clube e com histórico", async () => {
  const { a, b, campeonato, jogo, arbitro, ana, bruno, carla, davi, pAna } = await cenario();

  // Antes do início: Ana 7 → 10.
  const c1 = await ok<Correcao>(corrigir(jogo.toUpperCase(), arbitro, ana.id.toUpperCase(), 7, 10));
  assert.deepEqual([c1.alterado, c1.participacao.participacaoId, c1.participacao.numeroCamisa], [true, pAna, 10]);
  assert.deepEqual([c1.alteracao?.tipo, c1.alteracao?.numeroCamisaAnterior, c1.alteracao?.numeroCamisaNova, c1.alteracao?.atleta.nomeCompleto], ["correcao_camisa", 7, 10, "Ana"]);
  assert.equal(c1.alteracao?.credenciadoEm, c1.participacao.credenciadoEm, "credenciamento preservado");

  // Reenvio: a camisa já é a pedida.
  const reenvio = await ok<Correcao>(corrigir(jogo, arbitro, ana.id, 7, 10));
  assert.deepEqual([reenvio.alterado, reenvio.alteracao, reenvio.participacao.numeroCamisa], [false, undefined, 10]);
  // Camisa conhecida desatualizada: conflito com o registro atual, sem sobrescrever.
  const desatualizada = await recusa(corrigir(jogo, arbitro, ana.id, 7, 11), 409, /mudou: o atleta está com a camisa 10/);
  assert.equal(desatualizada.participacao.numeroCamisa, 10);

  // Camisa única no clube: a 8 é da Carla; a 9 é do Bruno, em outro clube, e pode ser usada.
  await recusa(corrigir(jogo, arbitro, ana.id, 10, 8), 409, /camisa 8 já está em uso/);
  assert.equal((await ok<Correcao>(corrigir(jogo, arbitro, ana.id, 10, 9))).participacao.numeroCamisa, 9);
  // A 7 liberada volta a valer para outro atleta do clube.
  assert.equal((await credenciar(jogo, arbitro, davi.id, 7)).numeroCamisa, 7);

  // Durante o jogo e após a entrada em quadra.
  await iniciar(jogo, arbitro);
  await entrar(jogo, arbitro, carla.id);
  const c2 = await ok<Correcao>(corrigir(jogo, arbitro, carla.id, 8, 0));
  assert.deepEqual([c2.participacao.numeroCamisa, Boolean(c2.participacao.entrouEmQuadraEm)], [0, true]);
  assert.deepEqual(await camisas(jogo), { Ana: 9, Bruno: 9, Carla: 0, Davi: 7 });

  // Lista da arbitragem e lançamentos mostram a camisa atual.
  const lista = await ok<{ clubes: { atletas: { atleta: Pessoa; credenciamento: Participacao | null }[] }[] }>(request("GET", `${ARBITRAGEM}/${jogo}/atletas`, arbitro));
  const carlaNaLista = lista.clubes.flatMap(c => c.atletas).find(a => a.atleta.id === carla.id);
  assert.equal(carlaNaLista?.credenciamento?.numeroCamisa, 0);

  const registros = await historico(jogo);
  assert.deepEqual(registros.map(r => [r.tipo, r.numeroCamisaAnterior, r.numeroCamisaNova]), [["correcao_camisa", 7, 10], ["correcao_camisa", 10, 9], ["correcao_camisa", 8, 0]]);

  // Corpo, atleta e permissão.
  for (const body of [{}, { numeroCamisa: 3 }, { numeroCamisaAtual: 9, numeroCamisa: 9 }, { numeroCamisaAtual: 9, numeroCamisa: -1 }, { numeroCamisaAtual: 9, numeroCamisa: 1.5 }, { numeroCamisaAtual: 9, numeroCamisa: 3, motivo: "x" }]) {
    await recusa(request("POST", `${ARBITRAGEM}/${jogo}/credenciamentos/${ana.id}/camisa`, arbitro, body), 400);
  }
  await recusa(corrigir(jogo, arbitro, "nao-uuid", 9, 3), 400);
  await recusa(corrigir(jogo, arbitro, randomUUID(), 9, 3), 409, /não está credenciado/);
  await recusa(corrigir(jogo, "", ana.id, 9, 3), 401);
  const outroJogo = await agendar(campeonato, b, a);
  await recusa(corrigir(outroJogo, arbitro, bruno.id, 9, 3), 401, undefined);
  assert.deepEqual(await camisas(jogo), { Ana: 9, Bruno: 9, Carla: 0, Davi: 7 });
});

test("arbitragem desfaz credenciamento sem entrada nem lançamentos, preservando histórico e escolha; reenvio não tem efeito", async () => {
  const { jogo, arbitro, tecnicoA, ana, bruno, carla, davi, pAna, pBruno } = await cenario();
  // Davi escolhido pelo técnico e credenciado: o estorno mantém a escolha.
  assert.equal((await request("POST", `/jogos/${jogo}/escalacao`, tecnicoA.cookie, { atletaId: davi.id })).status, 200);
  const pDavi = (await credenciar(jogo, arbitro, davi.id, 12)).participacaoId;
  const carteirinhaAna = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: ana.id } });

  const e1 = await ok<Estorno>(estornar(jogo, arbitro, ana.id.toUpperCase(), 7));
  assert.deepEqual([e1.alterado, e1.estorno.tipo, e1.estorno.numeroCamisaAnterior, e1.estorno.numeroCamisaNova, e1.estorno.atleta.nomeCompleto], [true, "estorno", 7, null, "Ana"]);
  assert.equal(await prisma.participacao.count({ where: { id: pAna } }), 0, "sem escolha, a participação sai");
  const copia = await prisma.alteracaoCredenciamento.findUniqueOrThrow({ where: { id: e1.estorno.id } });
  assert.deepEqual([copia.carteirinhaId, copia.atletaId, copia.credenciadoEm.toISOString()], [carteirinhaAna.id, ana.id, e1.estorno.credenciadoEm]);

  // Reenvio do mesmo estorno; camisa diferente ou atleta nunca credenciado são conflito.
  const reenvio = await ok<Estorno>(estornar(jogo, arbitro, ana.id, 7));
  assert.deepEqual([reenvio.alterado, reenvio.estorno.id], [false, e1.estorno.id]);
  await recusa(estornar(jogo, arbitro, ana.id, 70), 409, /não está credenciado/);
  await recusa(estornar(jogo, arbitro, randomUUID(), 1), 409, /não está credenciado/);
  // Camisa informada diferente da atual: conflito com o registro atual.
  const divergente = await recusa(estornar(jogo, arbitro, bruno.id, 10), 409, /mudou: o atleta está com a camisa 9/);
  assert.equal(divergente.participacao.participacaoId, pBruno);

  // Escolhido: a escolha do técnico permanece, sem credenciamento.
  await ok<Estorno>(estornar(jogo, arbitro, davi.id, 12));
  const escolha = await prisma.participacao.findUniqueOrThrow({ where: { id: pDavi } });
  assert.deepEqual([escolha.escolhidaPorTecnicoId, escolha.credenciadoEm, escolha.carteirinhaId, escolha.numeroCamisa], [tecnicoA.id, null, null, null]);

  // A camisa liberada pode ser usada por outro atleta, e o atleta estornado pode ser credenciado de novo.
  assert.equal((await credenciar(jogo, arbitro, carla.id, 8)).numeroCamisa, 8, "credenciamento existente devolvido");
  assert.equal((await ok<Correcao>(corrigir(jogo, arbitro, carla.id, 8, 7))).participacao.numeroCamisa, 7);
  const novo = await credenciar(jogo, arbitro, ana.id, 8);
  assert.notEqual(novo.participacaoId, pAna);
  const davisNovo = await credenciar(jogo, arbitro, davi.id, 12);
  assert.deepEqual([davisNovo.participacaoId, davisNovo.escalado], [pDavi, true]);

  // Durante o jogo: estorno ainda permitido sem entrada nem lançamentos.
  await iniciar(jogo, arbitro);
  await ok<Estorno>(estornar(jogo, arbitro, ana.id, 8));
  const tipos = (await historico(jogo)).map(r => `${r.tipo}:${r.numeroCamisaAnterior}`);
  assert.deepEqual(tipos, ["estorno:7", "estorno:12", "correcao_camisa:8", "estorno:8"]);
  for (const body of [{}, { numeroCamisa: -1 }, { numeroCamisa: 1, motivo: "x" }]) {
    await recusa(request("POST", `${ARBITRAGEM}/${jogo}/credenciamentos/${bruno.id}/estorno`, arbitro, body), 400);
  }
});

test("estorno recusado após entrada ou lançamento, inclusive anulado; o caso fica com o presidente após o encerramento", async () => {
  const { jogo, arbitro, ana, bruno, carla, pBruno, pCarla } = await cenario();
  await iniciar(jogo, arbitro);
  await entrar(jogo, arbitro, ana.id);
  await recusa(estornar(jogo, arbitro, ana.id, 7), 409, /já entrou em quadra.*presidente, após o encerramento/);

  await lancar(jogo, arbitro, pBruno);
  await recusa(estornar(jogo, arbitro, bruno.id, 9), 409, /gols ou penalidades.*presidente, após o encerramento/);
  const anulado = await lancar(jogo, arbitro, pCarla);
  assert.equal((await request("POST", `${ARBITRAGEM}/${jogo}/lancamentos/${anulado.id}/anulacao`, arbitro, { operacaoId: randomUUID() })).status, 200);
  await recusa(estornar(jogo, arbitro, carla.id, 8), 409, /gols ou penalidades/);
  assert.equal(await prisma.alteracaoCredenciamento.count({ where: { jogoId: jogo } }), 0);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, credenciadoEm: { not: null } } }), 3);
  // A camisa continua corrigível mesmo com entrada e lançamentos.
  assert.equal((await ok<Correcao>(corrigir(jogo, arbitro, bruno.id, 9, 99))).participacao.numeroCamisa, 99);
});

test("banco repete as regras: camisa e estorno só com o registro no histórico, que não muda nem é apagado", async () => {
  const { jogo, arbitro, ana, pAna, pBruno } = await cenario();
  const credenciamento = await prisma.participacao.findUniqueOrThrow({ where: { id: pAna } });
  await assert.rejects(prisma.participacao.update({ where: { id: pAna }, data: { numeroCamisa: 30 } }), /histórico/, "camisa sem histórico");
  await assert.rejects(prisma.participacao.delete({ where: { id: pAna } }), /histórico/, "exclusão sem histórico");
  await assert.rejects(prisma.participacao.update({ where: { id: pAna }, data: { credenciadoEm: new Date() } }), "data do credenciamento não muda");

  const registrar = (tx: { $executeRaw: PrismaService["$executeRaw"] }, tipo: string, nova: number | null, anterior = 7) => tx.$executeRaw`
    INSERT INTO "AlteracaoCredenciamento" (id, "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", tipo, "numeroCamisaAnterior", "numeroCamisaNova", "registradaEm")
    SELECT gen_random_uuid(), "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", ${tipo}::"TipoAlteracaoCredenciamento", ${anterior}, ${nova}, now()
    FROM "Participacao" WHERE id = ${pAna}::uuid`;
  await assert.rejects(registrar(prisma, "correcao_camisa", 30, 8), /credenciamento vigente/, "cópia diferente do vigente");
  await assert.rejects(registrar(prisma, "correcao_camisa", 7), "nova camisa igual à anterior");
  await assert.rejects(registrar(prisma, "estorno", 3), "estorno sem nova camisa");
  await assert.rejects(prisma.alteracaoCredenciamento.create({ data: {
    jogoId: jogo, inscricaoClubeId: credenciamento.inscricaoClubeId, vinculoClubeId: credenciamento.vinculoClubeId, atletaId: ana.id,
    carteirinhaId: credenciamento.carteirinhaId!, credenciadoEm: credenciamento.credenciadoEm!, tipo: "estorno", numeroCamisaAnterior: 7, registradaEm: new Date(Date.now() - 60_000),
  } }), /própria transação/, "registro com data retroativa");
  // Registro de outra camisa nova não autoriza esta alteração.
  await assert.rejects(prisma.$transaction(async tx => {
    await registrar(tx, "correcao_camisa", 31);
    await tx.participacao.update({ where: { id: pAna }, data: { numeroCamisa: 30 } });
  }), /histórico/);
  // Registro e alteração juntos: aceito.
  await prisma.$transaction(async tx => {
    await registrar(tx, "correcao_camisa", 30);
    await tx.participacao.update({ where: { id: pAna }, data: { numeroCamisa: 30 } });
  });
  const [registro] = await historico(jogo);
  await assert.rejects(prisma.alteracaoCredenciamento.update({ where: { id: registro.id }, data: { numeroCamisaNova: 31 } }), /não pode ser alterado/);
  await assert.rejects(prisma.alteracaoCredenciamento.delete({ where: { id: registro.id } }), /não pode ser excluído/);

  // Estorno com entrada ou lançamento é recusado pelo banco mesmo com o registro.
  await iniciar(jogo, arbitro);
  await lancar(jogo, arbitro, pBruno);
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.$executeRaw`
      INSERT INTO "AlteracaoCredenciamento" (id, "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", tipo, "numeroCamisaAnterior", "registradaEm")
      SELECT gen_random_uuid(), "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", 'estorno', "numeroCamisa", now()
      FROM "Participacao" WHERE id = ${pBruno}::uuid`;
    await tx.participacao.delete({ where: { id: pBruno } });
  }), /sem gols ou penalidades/);
  assert.equal(await prisma.lancamentoJogo.count({ where: { participacaoId: pBruno } }), 1, "lançamento preservado");
});

test("camisa disputada e correção contra estorno simultâneos: a primeira operação prevalece", async () => {
  const { jogo, arbitro, ana, carla } = await cenario();
  const outroDispositivo = await arbitrar(jogo);
  const disputa = await Promise.all([corrigir(jogo, arbitro, ana.id, 7, 20), corrigir(jogo, outroDispositivo, carla.id, 8, 20)]);
  assert.deepEqual(disputa.map(r => r.status).sort(), [200, 409]);
  const atuais = await camisas(jogo);
  assert.equal(Object.values(atuais).filter(n => n === 20).length, 1);

  const camisaAna = atuais.Ana;
  assert.ok(camisaAna !== null, "Ana continua credenciada após a disputa de camisa");
  const respostas = await Promise.all([corrigir(jogo, arbitro, ana.id, camisaAna, 21), estornar(jogo, outroDispositivo, ana.id, camisaAna)]);
  assert.deepEqual(respostas.map(r => r.status).sort(), [200, 409]);
  const historicoAna = (await historico(jogo)).filter(r => r.atletaId === ana.id && r.numeroCamisaAnterior === camisaAna);
  assert.equal(historicoAna.length, 1, "somente a operação vencedora registrou");
  // Mesma correção em paralelo: uma grava, as demais são reenvio.
  const camisaCarla = (await camisas(jogo)).Carla;
  assert.ok(camisaCarla !== null, "Carla continua credenciada após a disputa de camisa");
  const repetidas = await Promise.all(Array.from({ length: 4 }, (_, i) => corrigir(jogo, i % 2 ? arbitro : outroDispositivo, carla.id, camisaCarla, 40)));
  const corpos = await Promise.all(repetidas.map(async r => { assert.equal(r.status, 200); return r.json() as Promise<Correcao>; }));
  assert.deepEqual(corpos.map(c => c.alterado).sort(), [false, false, false, true]);
});

test("lançamento e entrada concorrem com o estorno: quem bloqueia a participação primeiro decide", async () => {
  const { jogo, arbitro, ana, bruno, carla, davi, pAna, pBruno } = await cenario();
  const pDavi = (await credenciar(jogo, arbitro, davi.id, 13)).participacaoId;
  await iniciar(jogo, arbitro);
  const token = tokenDe(arbitro);

  // Lançamento em curso: o estorno aguarda e encontra o gol.
  const l1 = await emDisputa(
    tx => registrarLancamento(tx, jogo, token, { operacaoId: randomUUID(), tipo: "gol", participacaoId: pAna }),
    tx => estornarCredenciamento(tx, jogo, token, ana.id, { numeroCamisa: 7 }),
  );
  assert.ok(l1.aguardou);
  assert.deepEqual([l1.segunda.erro?.getStatus?.(), await prisma.participacao.count({ where: { id: pAna } })], [409, 1]);
  assert.match(l1.segunda.erro!.message, /gols ou penalidades/);

  // Estorno em curso: o lançamento aguarda e não encontra mais a participação credenciada.
  const l2 = await emDisputa(
    tx => estornarCredenciamento(tx, jogo, token, bruno.id, { numeroCamisa: 9 }),
    tx => registrarLancamento(tx, jogo, token, { operacaoId: randomUUID(), tipo: "gol", participacaoId: pBruno }),
  );
  assert.ok(l2.aguardou);
  assert.ok([404, 409].includes(l2.segunda.erro?.getStatus?.() ?? 0), String(l2.segunda.erro?.message));
  assert.equal(await prisma.lancamentoJogo.count({ where: { participacaoId: pBruno } }), 0);

  // Entrada em curso: o estorno aguarda e encontra a entrada.
  const e1 = await emDisputa(
    tx => registrarEntrada(tx, jogo, token, carla.id),
    tx => estornarCredenciamento(tx, jogo, token, carla.id, { numeroCamisa: 8 }),
  );
  assert.ok(e1.aguardou);
  assert.equal(e1.segunda.erro?.getStatus?.(), 409);
  assert.match(e1.segunda.erro!.message, /entrou em quadra/);

  // Estorno em curso: a entrada aguarda e é recusada, sem gravar nada.
  const e2 = await emDisputa(
    tx => estornarCredenciamento(tx, jogo, token, davi.id, { numeroCamisa: 13 }),
    tx => registrarEntrada(tx, jogo, token, davi.id),
  );
  assert.ok(e2.aguardou);
  assert.equal(e2.segunda.erro?.getStatus?.(), 409);
  assert.equal(await prisma.participacao.count({ where: { id: pDavi } }), 0);

  // Correção de camisa em curso: a entrada do mesmo atleta aguarda e é registrada com a nova camisa.
  const c1 = await emDisputa(
    tx => corrigirCamisaPelaArbitragem(tx, jogo, token, ana.id, { numeroCamisaAtual: 7, numeroCamisa: 70 }),
    tx => registrarEntrada(tx, jogo, token, ana.id),
  );
  assert.ok(c1.aguardou);
  assert.deepEqual([c1.segunda.valor?.alterado, c1.segunda.valor?.participacao.numeroCamisa], [true, 70]);
});

test("encerramento concorre com a correção; depois somente o presidente corrige a camisa e estorna", async () => {
  const { a, b, campeonato, jogo, arbitro, ana, bruno, carla, pAna } = await cenario();
  await iniciar(jogo, arbitro);
  await entrar(jogo, arbitro, ana.id);
  await lancar(jogo, arbitro, pAna);
  const token = tokenDe(arbitro);

  // Durante o jogo, o presidente não corrige: é a arbitragem.
  await recusa(corrigir(jogo, presidente.cookie, ana.id, 7, 17, "/jogos"), 409, /somente após o encerramento/);

  // Correção em curso: o encerramento aguarda e termina depois, com a nova camisa preservada.
  const c1 = await emDisputa(
    tx => corrigirCamisaPelaArbitragem(tx, jogo, token, carla.id, { numeroCamisaAtual: 8, numeroCamisa: 18 }),
    tx => encerrarJogo(tx, jogo, token, { resultado: "normal", vencedorInscricaoId: null }),
  );
  assert.ok(c1.aguardou);
  assert.equal(c1.segunda.erro, null, String(c1.segunda.erro?.message));
  assert.equal((await prisma.jogo.findUniqueOrThrow({ where: { id: jogo } })).status, "finalizado");
  assert.equal((await camisas(jogo)).Carla, 18);

  // Depois do encerramento, a arbitragem não corrige nem estorna.
  for (const resposta of [await corrigir(jogo, arbitro, ana.id, 7, 17), await estornar(jogo, arbitro, bruno.id, 9)]) {
    assert.ok([401, 403].includes(resposta.status), `arbitragem bloqueada após o encerramento (${resposta.status})`);
  }

  // Presidente corrige a camisa da atleta que entrou e tem gol, sem reabrir a arbitragem.
  const c2 = await ok<Correcao>(corrigir(jogo.toUpperCase(), presidente.cookie, ana.id.toUpperCase(), 7, 17, "/jogos"));
  assert.deepEqual([c2.alterado, c2.participacao.numeroCamisa, Boolean(c2.participacao.entrouEmQuadraEm), c2.alteracao?.numeroCamisaAnterior], [true, 17, true, 7]);
  const registros = await ok<{ lancamentos: { numeroCamisa: number }[] }>(request("GET", `/jogos/${jogo}/lancamentos`, presidente.cookie));
  assert.deepEqual(registros.lancamentos.map(l => l.numeroCamisa), [17]);
  await recusa(corrigir(jogo, presidente.cookie, ana.id, 7, 27, "/jogos"), 409, /mudou/);
  await recusa(corrigir(jogo, presidente.cookie, ana.id, 17, 18, "/jogos"), 409, /camisa 18 já está em uso/);
  assert.equal(await prisma.sessaoArbitragem.count({ where: { arbitragem: { jogoId: jogo }, revogadaEm: null } }), 0);

  // Somente presidente. Estorno pelo presidente (MAR-83): Ana tem entrada e gol válidos; Bruno, sem ocorrências, é estornado.
  for (const [cookie, status] of [["", 401], [ana.cookie, 403]] as const) await recusa(corrigir(jogo, cookie, ana.id, 17, 27, "/jogos"), status);
  await recusa(request("POST", `/jogos/${jogo}/credenciamentos/${ana.id}/estorno`, presidente.cookie, { numeroCamisa: 17 }), 409, /entrada em quadra válida/);
  const estornoBruno = await ok<Estorno>(request("POST", `/jogos/${jogo}/credenciamentos/${bruno.id}/estorno`, presidente.cookie, { numeroCamisa: 9 }));
  assert.deepEqual([estornoBruno.alterado, estornoBruno.estorno.tipo, (estornoBruno.estorno as Alteracao & { presidenteId: string }).presidenteId], [true, "estorno", presidente.id]);
  assert.equal((await historico(jogo)).at(-1)?.presidenteId, presidente.id);
  await recusa(corrigir(randomUUID(), presidente.cookie, ana.id, 17, 27, "/jogos"), 404);
  const agendado = await agendar(campeonato, b, a);
  await recusa(corrigir(agendado, presidente.cookie, ana.id, 17, 27, "/jogos"), 409, /somente após o encerramento/);

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const rota of ["/arbitragem/jogos/{jogoId}/credenciamentos/{atletaId}/camisa", "/arbitragem/jogos/{jogoId}/credenciamentos/{atletaId}/estorno", "/jogos/{jogoId}/credenciamentos/{atletaId}/camisa"]) {
    assert.ok(contrato.paths[rota]?.post, rota);
  }
});
