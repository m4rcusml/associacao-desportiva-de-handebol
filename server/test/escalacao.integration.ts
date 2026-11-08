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
import { escolherAtleta } from "../dist/modules/participacoes/escalacao.js";

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
async function login(email: string) {
  const response = await request("POST", "/auth/sign-in/email", "", { email, password });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}
async function criarPresidente() {
  const email = novoEmail();
  const authId = randomUUID();
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente da escalação", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente da escalação", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;
type Conta = { id: string; email: string; cookie: string };

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, decisao = "aprovacao", nome = "Pessoa Fictícia" }: { clubeId?: string; decisao?: "aprovacao" | "rejeicao" | null; nome?: string } = {}): Promise<Conta> {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  if (decisao) assert.equal((await request("POST", `/verificacoes/${id}/${decisao}`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function criarClube(nome = "Clube da escalação") {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
async function atribuir(clubeId: string, tecnicoId: string, substituirTecnicoId?: string) {
  const response = await request("PUT", `/clubes/${clubeId}/tecnico`, presidente.cookie, { tecnicoId, ...(substituirTecnicoId ? { substituirTecnicoId } : {}) });
  assert.equal(response.status, 200, await response.clone().text());
}
async function tecnicoDe(clubeId: string, nome = "Técnico Fictício") {
  const tecnico = await cadastrar("tecnico", { nome });
  await atribuir(clubeId, tecnico.id);
  return tecnico;
}
async function campeonatoCom(clubesInscritos: string[]) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato da escalação", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  return id;
}
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string) {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: "2026-12-05T15:00", fusoHorario: "America/Recife" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}
/** Dois clubes inscritos, com técnico em cada um, e um jogo agendado entre eles. */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const [tecnicoA, tecnicoB] = [await tecnicoDe(a, "Técnico A"), await tecnicoDe(b, "Técnico B")];
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  return { a, b, tecnicoA, tecnicoB, campeonato, jogo };
}

type Pessoa = { id: string; nomeCompleto: string };
type Escalado = { participacaoId: string; atleta: Pessoa; vinculoClubeId: string; vinculoAtual: boolean; escolhidaPorTecnico: Pessoa | null; escolhidaEm: string };
type Alteracao = { tipo: "inclusao" | "remocao"; atleta: Pessoa; vinculoClubeId: string; tecnico: Pessoa; ocorridoEm: string };
type ClubeEscalacao = { inscricaoId: string; clube: { id: string }; tecnico: Pessoa | null; escalados: Escalado[]; alteracoes: Alteracao[]; atletasDoClube: Pessoa[] };
type Escalacao = { jogo: { id: string; status: string; inicioPrevistoLocal: string }; clubes: ClubeEscalacao[]; alterado?: boolean };
const escolher = (jogo: string, atletaId: string, cookie: string) => request("POST", `/jogos/${jogo}/escalacao`, cookie, { atletaId });
const retirar = (jogo: string, atletaId: string, cookie: string) => request("DELETE", `/jogos/${jogo}/escalacao/${atletaId}`, cookie);
const consultar = async (jogo: string, cookie: string): Promise<Escalacao> => {
  const response = await request("GET", `/jogos/${jogo}/escalacao`, cookie);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
async function ok(response: Promise<Response>): Promise<Escalacao> {
  const resolvida = await response;
  assert.equal(resolvida.status, 200, await resolvida.clone().text());
  return resolvida.json();
}
const participacoes = (jogoId: string) => prisma.participacao.findMany({ where: { jogoId }, orderBy: { escolhidaEm: "asc" } });
const iniciarJogo = (jogoId: string) => prisma.jogo.update({ where: { id: jogoId }, data: { status: "em_andamento", iniciadoEm: new Date() } });

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // A remoção do jogo leva participações e histórico da escalação em cascata.
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

test("técnico aprovado escala atletas do próprio clube sem credenciar nem confirmar entrada", async () => {
  const { a, b, tecnicoA, tecnicoB, jogo } = await cenario();
  const [ana, bruno] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Bruno" })];
  const deB = await cadastrar("atleta", { clubeId: b, nome: "Carla" });

  const vazia = await consultar(jogo, tecnicoA.cookie);
  assert.equal(vazia.clubes.length, 1, "técnico vê somente o próprio clube");
  assert.equal(vazia.clubes[0].clube.id, a);
  assert.deepEqual(vazia.clubes[0].tecnico, { id: tecnicoA.id, nomeCompleto: "Técnico A" });
  assert.deepEqual(vazia.clubes[0].atletasDoClube.map(x => x.nomeCompleto), ["Ana", "Bruno"]);
  assert.equal(vazia.jogo.inicioPrevistoLocal, "2026-12-05T15:00");

  const corpo = await ok(escolher(jogo.toUpperCase(), ana.id.toUpperCase(), tecnicoA.cookie));
  assert.equal(corpo.alterado, true);
  const [escalada] = corpo.clubes[0].escalados;
  assert.deepEqual([escalada.atleta, escalada.escolhidaPorTecnico, escalada.vinculoAtual], [{ id: ana.id, nomeCompleto: "Ana" }, { id: tecnicoA.id, nomeCompleto: "Técnico A" }, true]);
  // A escolha é preliminar: nenhum credenciamento, camisa ou entrada é registrado (RN-014).
  const [registro] = await participacoes(jogo);
  assert.deepEqual(
    [registro.atletaId, registro.escolhidaPorTecnicoId, registro.carteirinhaId, registro.credenciadoEm, registro.numeroCamisa, registro.entrouEmQuadraEm],
    [ana.id, tecnicoA.id, null, null, null, null],
  );
  // Repetir não duplica nem muda a autoria; o técnico B escala o próprio clube no mesmo jogo.
  const repetida = await ok(escolher(jogo, ana.id, tecnicoA.cookie));
  assert.equal(repetida.alterado, false);
  assert.equal(repetida.clubes[0].escalados[0].escolhidaEm, escalada.escolhidaEm);
  await ok(escolher(jogo, bruno.id, tecnicoA.cookie));
  await ok(escolher(jogo, deB.id, tecnicoB.cookie));
  assert.deepEqual((await consultar(jogo, tecnicoB.cookie)).clubes.map(c => c.escalados.map(e => e.atleta.id)), [[deB.id]]);

  // Presidente consulta os dois clubes.
  const geral = await consultar(jogo, presidente.cookie);
  assert.deepEqual(geral.clubes.map(c => [c.clube.id, c.escalados.map(e => e.atleta.nomeCompleto)]), [[a, ["Ana", "Bruno"]], [b, ["Carla"]]]);

  // Retirar remove a participação sem outra etapa e registra a remoção; repetir não tem efeito.
  const retirada = await ok(retirar(jogo, bruno.id, tecnicoA.cookie));
  assert.equal(retirada.alterado, true);
  assert.deepEqual(retirada.clubes[0].escalados.map(e => e.atleta.id), [ana.id]);
  assert.deepEqual(retirada.clubes[0].alteracoes.map(x => [x.tipo, x.atleta.nomeCompleto, x.tecnico.id]), [["inclusao", "Ana", tecnicoA.id], ["inclusao", "Bruno", tecnicoA.id], ["remocao", "Bruno", tecnicoA.id]]);
  assert.equal((await ok(retirar(jogo, bruno.id, tecnicoA.cookie))).alterado, false);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo } }), 2);

  // Atleta de outro clube, pendente, rejeitado, técnico ou inexistente não entram.
  const pendente = await cadastrar("atleta", { clubeId: a, decisao: null });
  const rejeitado = await cadastrar("atleta", { clubeId: a, decisao: "rejeicao" });
  for (const { id } of [deB, pendente, rejeitado]) assert.equal((await escolher(jogo, id, tecnicoA.cookie)).status, 409);
  for (const id of [tecnicoB.id, randomUUID()]) assert.equal((await escolher(jogo, id, tecnicoA.cookie)).status, 404);
  assert.equal((await escolher(randomUUID(), ana.id, tecnicoA.cookie)).status, 404);
  for (const body of [{}, { atletaId: "x" }, { atletaId: ana.id, numeroCamisa: 7 }, { atletaId: ana.id, credenciado: true }]) {
    assert.equal((await request("POST", `/jogos/${jogo}/escalacao`, tecnicoA.cookie, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo } }), 2);
});

test("atleta com conta desativada ou carteirinha invalidada não é escolhido", async () => {
  const { a, tecnicoA, campeonato, jogo } = await cenario();
  const [ana, bruno, carla] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Bruno" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" })];
  await ok(escolher(jogo, carla.id, tecnicoA.cookie));
  const acao = (path: string) => request("POST", path, presidente.cookie, {}).then(r => assert.equal(r.status, 200, path));
  await acao(`/contas/${ana.id}/desativacao`);
  await acao(`/carteirinhas/atleta/${bruno.id}/invalidacao`);

  for (const [atleta, motivo] of [[ana, /conta desativada/], [bruno, /carteirinha invalidada/]] as const) {
    const recusada = await escolher(jogo, atleta.id, tecnicoA.cookie);
    assert.equal(recusada.status, 409);
    assert.match((await recusada.json()).message, motivo);
  }
  assert.deepEqual((await consultar(jogo, tecnicoA.cookie)).clubes[0].atletasDoClube.map(x => x.nomeCompleto), ["Carla"]);
  // O banco recusa o atalho; a escolha feita antes continua registrada (o credenciamento barrará) e pode ser retirada.
  const inscricaoA = (await prisma.inscricaoClube.findFirstOrThrow({ where: { campeonatoId: campeonato, clubeId: a } })).id;
  for (const { id } of [ana, bruno]) {
    const vinculo = await prisma.vinculoClube.findFirstOrThrow({ where: { atletaId: id, fim: null } });
    await assert.rejects(prisma.participacao.create({ data: { jogoId: jogo, inscricaoClubeId: inscricaoA, vinculoClubeId: vinculo.id, atletaId: id, escolhidaPorTecnicoId: tecnicoA.id, escolhidaEm: new Date() } }));
  }
  await acao(`/carteirinhas/atleta/${carla.id}/invalidacao`);
  assert.equal((await consultar(jogo, tecnicoA.cookie)).clubes[0].escalados.length, 1);
  assert.equal((await escolher(jogo, carla.id, tecnicoA.cookie)).status, 409, "repetir não confirma quem ficou inapto");
  assert.equal((await ok(retirar(jogo, carla.id, tecnicoA.cookie))).alterado, true);

  // Reativadas conta e carteirinha, a escolha volta a ser permitida.
  await acao(`/contas/${ana.id}/reativacao`);
  await acao(`/carteirinhas/atleta/${bruno.id}/reativacao`);
  await ok(escolher(jogo, ana.id, tecnicoA.cookie));
  await ok(escolher(jogo, bruno.id, tecnicoA.cookie));

  // Desativação ou invalidação em curso: a escolha aguarda o commit e é recusada.
  for (const inapto of [
    async (tx: typeof prisma, id: string) => { await tx.$executeRaw`UPDATE "Usuario" SET ativo = false WHERE id = ${id}::uuid`; },
    async (tx: typeof prisma, id: string) => { await (await import("../dist/modules/carteirinhas/carteirinhas.js")).alterarStatus(tx, presidente.id, id, "invalidada"); },
  ]) {
    const atleta = await cadastrar("atleta", { clubeId: a });
    let pedido: Promise<Response> | undefined;
    await prisma.$transaction(async tx => {
      await inapto(tx as typeof prisma, atleta.id);
      pedido = escolher(jogo, atleta.id, tecnicoA.cookie);
      await esperar(300);
    });
    assert.equal((await pedido!).status, 409);
    assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: atleta.id } }), 0);
  }
});

test("novo técnico consulta e altera a escalação anterior, preservando a autoria; clube sem técnico não escala", async () => {
  const { a, tecnicoA, jogo } = await cenario();
  const [ana, bruno, carla] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Bruno" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" })];
  await ok(escolher(jogo, ana.id, tecnicoA.cookie));
  await ok(escolher(jogo, bruno.id, tecnicoA.cookie));

  const novo = await cadastrar("tecnico", { nome: "Técnico Novo" });
  await atribuir(a, novo.id, tecnicoA.id);
  // O técnico substituído perde o acesso imediatamente.
  for (const response of [await request("GET", `/jogos/${jogo}/escalacao`, tecnicoA.cookie), await escolher(jogo, carla.id, tecnicoA.cookie), await retirar(jogo, ana.id, tecnicoA.cookie)]) {
    assert.equal(response.status, 403);
  }
  const anterior = await consultar(jogo, novo.cookie);
  assert.deepEqual(anterior.clubes[0].tecnico, { id: novo.id, nomeCompleto: "Técnico Novo" });
  assert.deepEqual(anterior.clubes[0].escalados.map(e => [e.atleta.nomeCompleto, e.escolhidaPorTecnico?.id]), [["Ana", tecnicoA.id], ["Bruno", tecnicoA.id]]);

  // Confirmar atleta já escolhido mantém o autor; retirar e incluir registram o novo técnico.
  assert.equal((await ok(escolher(jogo, ana.id, novo.cookie))).alterado, false);
  await ok(retirar(jogo, bruno.id, novo.cookie));
  const final = await ok(escolher(jogo, carla.id, novo.cookie));
  assert.deepEqual(final.clubes[0].escalados.map(e => [e.atleta.nomeCompleto, e.escolhidaPorTecnico?.id]), [["Ana", tecnicoA.id], ["Carla", novo.id]]);
  assert.deepEqual(final.clubes[0].alteracoes.map(x => [x.tipo, x.atleta.nomeCompleto, x.tecnico.nomeCompleto]), [
    ["inclusao", "Ana", "Técnico A"], ["inclusao", "Bruno", "Técnico A"], ["remocao", "Bruno", "Técnico Novo"], ["inclusao", "Carla", "Técnico Novo"],
  ]);
  // Bruno escolhido de novo: nova autoria, histórico anterior intacto.
  const reescolhido = await ok(escolher(jogo, bruno.id, novo.cookie));
  assert.equal(reescolhido.clubes[0].escalados.find(e => e.atleta.id === bruno.id)?.escolhidaPorTecnico?.id, novo.id);
  assert.equal(reescolhido.clubes[0].alteracoes.length, 5);

  // Técnico desativado não escala; desvinculado o técnico, o clube fica sem escalação e o presidente não escala.
  await prisma.usuario.update({ where: { id: novo.id }, data: { ativo: false } });
  assert.equal((await escolher(jogo, bruno.id, novo.cookie)).status, 401);
  await prisma.usuario.update({ where: { id: novo.id }, data: { ativo: true } });
  const sessaoNova = await login(novo.email);
  assert.equal((await request("DELETE", `/clubes/${a}/tecnico/${novo.id}`, presidente.cookie)).status, 200);
  assert.equal((await request("GET", `/jogos/${jogo}/escalacao`, sessaoNova)).status, 403);
  assert.equal((await escolher(jogo, bruno.id, sessaoNova)).status, 403);
  const semTecnico = await consultar(jogo, presidente.cookie);
  assert.equal(semTecnico.clubes[0].tecnico, null);
  assert.equal(semTecnico.clubes[0].escalados.length, 3, "escolhas anteriores continuam registradas");
  assert.equal((await escolher(jogo, bruno.id, presidente.cookie)).status, 403);
  assert.equal((await retirar(jogo, ana.id, presidente.cookie)).status, 403);
});

test("a escalação só muda até o início do jogo, inclusive em início concorrente", async () => {
  const { a, tecnicoA, jogo, campeonato, b } = await cenario();
  const [ana, bruno] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Bruno" })];
  await ok(escolher(jogo, ana.id, tecnicoA.cookie));
  const ator = { usuarioId: tecnicoA.id, clubeId: a } as Parameters<typeof escolherAtleta>[1];

  // Início em curso (linha do jogo bloqueada): a escolha aguarda e é recusada depois do commit.
  let pedido: Promise<Response> | undefined;
  await prisma.$transaction(async tx => {
    await tx.jogo.update({ where: { id: jogo }, data: { status: "em_andamento", iniciadoEm: new Date() } });
    pedido = escolher(jogo, bruno.id, tecnicoA.cookie);
    await esperar(300);
  });
  const recusada = await pedido!;
  assert.equal(recusada.status, 409, await recusada.clone().text());
  assert.match((await recusada.json()).message, /até o início do jogo/);
  assert.equal((await retirar(jogo, ana.id, tecnicoA.cookie)).status, 409);
  assert.deepEqual((await participacoes(jogo)).map(p => p.atletaId), [ana.id]);
  // Consulta continua disponível depois do início.
  assert.equal((await consultar(jogo, tecnicoA.cookie)).jogo.status, "em_andamento");

  // Escolha em curso antes do início: o início aguarda o commit e a escolha permanece.
  const outro = await agendar(campeonato, a, b);
  let inicio: Promise<unknown> | undefined;
  let iniciou = false;
  await prisma.$transaction(async tx => {
    await escolherAtleta(tx, ator, outro, bruno.id);
    inicio = iniciarJogo(outro).then(r => { iniciou = true; return r; });
    await esperar(300);
    assert.equal(iniciou, false, "o início espera a escolha terminar");
  });
  await inicio;
  assert.deepEqual((await participacoes(outro)).map(p => p.atletaId), [bruno.id]);

  // Disputa direta: escolha confirmada nunca depois do início confirmado.
  for (let rodada = 0; rodada < 3; rodada++) {
    const alvo = await agendar(campeonato, a, b);
    const [escolha] = await Promise.all([escolher(alvo, ana.id, tecnicoA.cookie), iniciarJogo(alvo)]);
    assert.ok([200, 409].includes(escolha.status), String(escolha.status));
    assert.equal(await prisma.participacao.count({ where: { jogoId: alvo } }), escolha.status === 200 ? 1 : 0);
  }

  // Jogo finalizado ou cancelado também não muda; trigger recusa mesmo sem a aplicação.
  const cancelado = await agendar(campeonato, a, b);
  await prisma.jogo.update({ where: { id: cancelado }, data: { status: "cancelado" } });
  assert.equal((await escolher(cancelado, ana.id, tecnicoA.cookie)).status, 409);
  await assert.rejects(prisma.participacao.updateMany({ where: { jogoId: jogo }, data: { escolhidaEm: new Date() } }));
  await assert.rejects(prisma.participacao.deleteMany({ where: { jogoId: jogo } }));
  const [vinculoBruno] = await prisma.vinculoClube.findMany({ where: { atletaId: bruno.id } });
  const inscricaoA = (await prisma.inscricaoClube.findFirstOrThrow({ where: { campeonatoId: campeonato, clubeId: a } })).id;
  await assert.rejects(prisma.participacao.create({ data: { jogoId: jogo, inscricaoClubeId: inscricaoA, vinculoClubeId: vinculoBruno.id, atletaId: bruno.id, escolhidaPorTecnicoId: tecnicoA.id, escolhidaEm: new Date() } }));
});

test("transferência torna a escolha antiga insuficiente para credenciar e preserva o registro histórico", async () => {
  const { a, b, tecnicoA, tecnicoB, jogo } = await cenario();
  const ana = await cadastrar("atleta", { clubeId: a, nome: "Ana" });
  await ok(escolher(jogo, ana.id, tecnicoA.cookie));
  const [vinculoAntigo] = await prisma.vinculoClube.findMany({ where: { atletaId: ana.id } });

  // Campeonato planejado não impede a transferência (RN-006).
  assert.equal((await request("POST", `/atletas/${ana.id}/transferencia`, presidente.cookie, { clubeAtualId: a, clubeDestinoId: b })).status, 200);
  const doA = await consultar(jogo, tecnicoA.cookie);
  assert.deepEqual(doA.clubes[0].escalados.map(e => [e.atleta.id, e.vinculoClubeId, e.vinculoAtual]), [[ana.id, vinculoAntigo.id, false]]);
  assert.equal(doA.clubes[0].atletasDoClube.length, 0);
  // O clube anterior não volta a escolhê-la; o novo clube escolhe pelo vínculo atual.
  assert.equal((await escolher(jogo, ana.id, tecnicoA.cookie)).status, 409);
  const doB = await ok(escolher(jogo, ana.id, tecnicoB.cookie));
  assert.equal(doB.clubes[0].escalados[0].vinculoAtual, true);
  const [antiga, nova] = await participacoes(jogo);
  assert.equal(antiga.vinculoClubeId, vinculoAntigo.id);
  assert.notEqual(nova.vinculoClubeId, vinculoAntigo.id);

  // Credenciamento (MAR-67) pela escolha antiga é recusado pelo banco; pela atual é aceito, uma vez por atleta.
  const carteirinha = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: ana.id } });
  const credenciar = (id: string, numeroCamisa = 9) => prisma.participacao.update({ where: { id }, data: { carteirinhaId: carteirinha.id, credenciadoEm: new Date(), numeroCamisa } });
  await assert.rejects(credenciar(antiga.id), "escolha anterior à transferência não credencia");
  await credenciar(nova.id);
  // A escolha antiga continua no histórico do clube A, que pode retirá-la; o registro do vínculo não muda.
  const retirada = await ok(retirar(jogo, ana.id, tecnicoA.cookie));
  assert.equal(retirada.clubes[0].escalados.length, 0);
  assert.deepEqual(retirada.clubes[0].alteracoes.map(x => [x.tipo, x.vinculoClubeId]), [["inclusao", vinculoAntigo.id], ["remocao", vinculoAntigo.id]]);
  // A retirada da escolha no clube B preserva o credenciamento (só a escolha sai).
  await ok(retirar(jogo, ana.id, tecnicoB.cookie));
  const [credenciada] = await participacoes(jogo);
  assert.deepEqual([credenciada.id, credenciada.escolhidaEm, credenciada.numeroCamisa], [nova.id, null, 9]);
  assert.equal((await consultar(jogo, tecnicoB.cookie)).clubes[0].escalados.length, 0);
  await assert.rejects(prisma.participacao.delete({ where: { id: nova.id } }), "participação credenciada não é excluída");
});

test("transferência concorrente com a escolha se serializa", async () => {
  const { a, b, tecnicoA, jogo } = await cenario();
  const ana = await cadastrar("atleta", { clubeId: a });
  let pedido: Promise<Response> | undefined;
  await prisma.$transaction(async tx => {
    await transferirAtleta(tx, ana.id, presidente.id, { clubeAtualId: a, clubeDestinoId: b });
    pedido = escolher(jogo, ana.id, tecnicoA.cookie);
    await esperar(300);
  });
  assert.equal((await pedido!).status, 409);
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo } }), 0);

  // Escolha em curso: a transferência aguarda e a escolha fica com o vínculo da época.
  const bruno = await cadastrar("atleta", { clubeId: a });
  const ator = { usuarioId: tecnicoA.id, clubeId: a } as Parameters<typeof escolherAtleta>[1];
  let transferencia: Promise<Response> | undefined;
  let concluida = false;
  await prisma.$transaction(async tx => {
    await escolherAtleta(tx, ator, jogo, bruno.id);
    transferencia = request("POST", `/atletas/${bruno.id}/transferencia`, presidente.cookie, { clubeAtualId: a, clubeDestinoId: b }).then(r => { concluida = true; return r; });
    await esperar(300);
    assert.equal(concluida, false, "a transferência espera a escolha terminar");
  });
  assert.equal((await transferencia!).status, 200);
  const doA = await consultar(jogo, tecnicoA.cookie);
  assert.deepEqual(doA.clubes[0].escalados.map(e => [e.atleta.id, e.vinculoAtual]), [[bruno.id, false]]);
});

test("escolhas simultâneas não duplicam participações nem histórico", async () => {
  const { a, tecnicoA, jogo } = await cenario();
  for (let rodada = 0; rodada < 3; rodada++) {
    const atleta = await cadastrar("atleta", { clubeId: a });
    const inclusoes = await Promise.all([1, 2, 3].map(() => escolher(jogo, atleta.id, tecnicoA.cookie)));
    assert.deepEqual(inclusoes.map(r => r.status), [200, 200, 200]);
    assert.deepEqual((await Promise.all(inclusoes.map(r => r.json() as Promise<Escalacao>))).map(e => e.alterado).sort(), [false, false, true]);
    const retiradas = await Promise.all([1, 2, 3].map(() => retirar(jogo, atleta.id, tecnicoA.cookie)));
    assert.deepEqual(retiradas.map(r => r.status), [200, 200, 200]);
    assert.deepEqual((await Promise.all(retiradas.map(r => r.json() as Promise<Escalacao>))).map(e => e.alterado).sort(), [false, false, true]);
    assert.deepEqual(
      (await prisma.alteracaoEscalacao.findMany({ where: { jogoId: jogo, vinculoClube: { atletaId: atleta.id } }, orderBy: { ocorridoEm: "asc" } })).map(x => x.tipo),
      ["inclusao", "remocao"],
    );
  }
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo } }), 0);
});

test("restrições do banco: clube do jogo, vínculo, autoria, etapas, camisa única e histórico imutável", async () => {
  const { a, b, tecnicoA, tecnicoB, campeonato, jogo } = await cenario();
  const [ana, bruno] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Bruno" })];
  const carla = await cadastrar("atleta", { clubeId: b, nome: "Carla" });
  const pendente = await cadastrar("atleta", { clubeId: a, decisao: null });
  const [inscricaoA, inscricaoB] = await Promise.all([a, b].map(clubeId => prisma.inscricaoClube.findFirstOrThrow({ where: { campeonatoId: campeonato, clubeId } })));
  const vinculo = async (atletaId: string) => (await prisma.vinculoClube.findFirstOrThrow({ where: { atletaId, fim: null } })).id;
  const [vAna, vBruno, vCarla, vPendente] = await Promise.all([ana, bruno, carla, pendente].map(x => vinculo(x.id)));
  const escolha = (tecnicoId: string) => ({ escolhidaPorTecnicoId: tecnicoId, escolhidaEm: new Date() });

  // Clube de fora do jogo, inscrição de outro clube, atleta diferente do vínculo, técnico de outro clube, pendente, sem etapa.
  const c = await criarClube();
  const outroCampeonato = await campeonatoCom([a, c]);
  const inscricaoForaDoJogo = await prisma.inscricaoClube.findFirstOrThrow({ where: { campeonatoId: outroCampeonato, clubeId: a } });
  for (const data of [
    { inscricaoClubeId: inscricaoForaDoJogo.id, vinculoClubeId: vAna, atletaId: ana.id, ...escolha(tecnicoA.id) },
    { inscricaoClubeId: inscricaoB.id, vinculoClubeId: vAna, atletaId: ana.id, ...escolha(tecnicoB.id) },
    { inscricaoClubeId: inscricaoA.id, vinculoClubeId: vAna, atletaId: bruno.id, ...escolha(tecnicoA.id) },
    { inscricaoClubeId: inscricaoA.id, vinculoClubeId: vAna, atletaId: ana.id, ...escolha(tecnicoB.id) },
    { inscricaoClubeId: inscricaoA.id, vinculoClubeId: vPendente, atletaId: pendente.id, ...escolha(tecnicoA.id) },
    { inscricaoClubeId: inscricaoA.id, vinculoClubeId: vAna, atletaId: ana.id },
    { inscricaoClubeId: inscricaoA.id, vinculoClubeId: vAna, atletaId: ana.id, escolhidaPorTecnicoId: tecnicoA.id },
  ]) {
    await assert.rejects(prisma.participacao.create({ data: { jogoId: jogo, ...data } }), JSON.stringify(data));
  }

  await ok(escolher(jogo, ana.id, tecnicoA.cookie));
  await ok(escolher(jogo, bruno.id, tecnicoA.cookie));
  await ok(escolher(jogo, carla.id, tecnicoB.cookie));
  const porAtleta = async (atletaId: string) => prisma.participacao.findFirstOrThrow({ where: { jogoId: jogo, atletaId } });
  const [pAna, pBruno, pCarla] = await Promise.all([ana, bruno, carla].map(x => porAtleta(x.id)));
  // Escolha duplicada pelo mesmo vínculo e identificação imutável.
  await assert.rejects(prisma.participacao.create({ data: { jogoId: jogo, inscricaoClubeId: inscricaoA.id, vinculoClubeId: vAna, atletaId: ana.id, ...escolha(tecnicoA.id) } }));
  for (const data of [{ vinculoClubeId: vBruno }, { inscricaoClubeId: inscricaoB.id }, { atletaId: bruno.id }, { escolhidaPorTecnicoId: tecnicoB.id }]) {
    await assert.rejects(prisma.participacao.update({ where: { id: pAna.id }, data }), JSON.stringify(data));
  }

  // Credenciamento: carteirinha, data e camisa juntos; carteirinha do próprio atleta; camisa única por clube no jogo.
  const cart = async (atletaId: string) => (await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId } })).id;
  const [cAna, cBruno, cCarla] = await Promise.all([ana, bruno, carla].map(x => cart(x.id)));
  const agora = new Date();
  for (const data of [
    { credenciadoEm: agora }, { carteirinhaId: cAna, credenciadoEm: agora }, { carteirinhaId: cBruno, credenciadoEm: agora, numeroCamisa: 7 },
    { carteirinhaId: cAna, credenciadoEm: agora, numeroCamisa: -1 }, { entrouEmQuadraEm: agora },
  ]) {
    await assert.rejects(prisma.participacao.update({ where: { id: pAna.id }, data }), JSON.stringify(data));
  }
  await prisma.participacao.update({ where: { id: pAna.id }, data: { carteirinhaId: cAna, credenciadoEm: agora, numeroCamisa: 7 } });
  await assert.rejects(prisma.participacao.update({ where: { id: pBruno.id }, data: { carteirinhaId: cBruno, credenciadoEm: agora, numeroCamisa: 7 } }), "camisa repetida no mesmo clube e jogo");
  await prisma.participacao.update({ where: { id: pCarla.id }, data: { carteirinhaId: cCarla, credenciadoEm: agora, numeroCamisa: 7 } });
  // Entrada em quadra separada do credenciamento (RN-020).
  await prisma.participacao.update({ where: { id: pAna.id }, data: { entrouEmQuadraEm: new Date() } });
  assert.equal((await porAtleta(bruno.id)).credenciadoEm, null);

  // Histórico da escalação é somente de inclusão e exige o técnico atual do clube do atleta.
  const [primeira] = await prisma.alteracaoEscalacao.findMany({ where: { jogoId: jogo }, orderBy: { ocorridoEm: "asc" } });
  await assert.rejects(prisma.alteracaoEscalacao.update({ where: { id: primeira.id }, data: { tecnicoId: tecnicoB.id } }));
  await assert.rejects(prisma.alteracaoEscalacao.delete({ where: { id: primeira.id } }));
  await assert.rejects(prisma.alteracaoEscalacao.create({ data: { jogoId: jogo, vinculoClubeId: vCarla, tipo: "inclusao", tecnicoId: tecnicoA.id, ocorridoEm: new Date() } }));
  assert.equal(await prisma.alteracaoEscalacao.count({ where: { jogoId: jogo } }), 3);
});

test("somente técnico aprovado do clube altera; presidente consulta; contrato OpenAPI publica as rotas", async () => {
  const { a, tecnicoA, jogo } = await cenario();
  const ana = await cadastrar("atleta", { clubeId: a });
  const pendente = await cadastrar("tecnico", { decisao: null });
  const semClube = await cadastrar("tecnico");
  const deFora = await tecnicoDe(await criarClube());
  const operacoes: [Metodo, string, unknown?][] = [
    ["GET", `/jogos/${jogo}/escalacao`],
    ["POST", `/jogos/${jogo}/escalacao`, { atletaId: ana.id }],
    ["DELETE", `/jogos/${jogo}/escalacao/${ana.id}`],
  ];
  for (const [metodo, path, body] of operacoes) {
    assert.equal((await request(metodo, path, "", body)).status, 401, `${metodo} ${path} sem sessão`);
    for (const { cookie } of [ana, pendente, semClube, deFora]) assert.equal((await request(metodo, path, cookie, body)).status, 403, `${metodo} ${path}`);
    if (metodo !== "GET") {
      assert.equal((await request(metodo, path, presidente.cookie, body)).status, 403, `${metodo} ${path} presidente`);
      assert.equal((await request(metodo, path, tecnicoA.cookie, body, false)).status, 403, `${metodo} ${path} sem origem`);
    }
  }
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo } }), 0);
  assert.equal((await request("GET", "/jogos/nao-uuid/escalacao", tecnicoA.cookie)).status, 400);
  assert.equal((await request("GET", `/jogos/${randomUUID()}/escalacao`, presidente.cookie)).status, 404);

  const contrato = await (await request("GET", "/openapi.json")).json();
  assert.ok(contrato.paths["/jogos/{jogoId}/escalacao"]?.get);
  assert.ok(contrato.paths["/jogos/{jogoId}/escalacao"]?.post);
  assert.ok(contrato.paths["/jogos/{jogoId}/escalacao/{atletaId}"]?.delete);
});
