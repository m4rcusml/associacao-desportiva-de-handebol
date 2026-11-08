import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";

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
    await tx.authUser.create({ data: { id: authId, name: "Presidente de jogos", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente de jogos", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, aprovar = true, nome = "Pessoa Fictícia" }: { clubeId?: string; aprovar?: boolean; nome?: string } = {}) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const { usuario } = await response.json();
  const id = usuario.id as string;
  if (aprovar) assert.equal((await request("POST", `/verificacoes/${id}/aprovacao`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function tecnicoDoClube(clubeId: string) {
  const tecnico = await cadastrar("tecnico");
  const response = await request("PUT", `/clubes/${clubeId}/tecnico`, presidente.cookie, { tecnicoId: tecnico.id });
  assert.equal(response.status, 200, await response.clone().text());
  return tecnico;
}
async function criarClube(nome = "Clube de jogos") {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
type Inscricao = { id: string; clube: { id: string } };
async function campeonatoComClubes(quantidade = 2) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato de jogos", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  campeonatos.push(id);
  const ids: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    const clubeId = await criarClube(`Clube ${i}`);
    assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
    ids.push(clubeId);
  }
  const inscricoes: Inscricao[] = (await (await request("GET", `/campeonatos/${id}`, presidente.cookie)).json()).inscricoes;
  return { id: id as string, clubes: ids, inscricoes };
}

type Arbitragem = { id: string; tipo: string; nomeCompleto: string; usuario: { id: string; nomeCompleto: string; perfil: string } | null; designadoPorPresidenteId: string; designadoEm: string };
type Jogo = { id: string; status: string; fusoHorario: string; local: string | null; inicioPrevistoEm: string; inicioPrevistoLocal: string; iniciadoEm: null; encerradoEm: null; clubeA: { inscricaoId: string; clube: { id: string } }; clubeB: { inscricaoId: string; clube: { id: string } }; arbitragens: Arbitragem[] };
const agendar = (campeonatoId: string, body: Record<string, unknown>, cookie = presidente.cookie) => request("POST", `/campeonatos/${campeonatoId}/jogos`, cookie, body);
const padrao = (clubeAId: string, clubeBId: string) => ({ clubeAId, clubeBId, inicioPrevisto: "2026-12-05T19:00", fusoHorario: "America/Recife" });
async function jogoAgendado(campeonato: Awaited<ReturnType<typeof campeonatoComClubes>>): Promise<Jogo> {
  const response = await agendar(campeonato.id, padrao(campeonato.clubes[0], campeonato.clubes[1]));
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}
const designar = (jogoId: string, body: unknown, cookie = presidente.cookie) => request("POST", `/jogos/${jogoId}/arbitragens`, cookie, body);
const consultarJogo = async (jogoId: string): Promise<Jogo> => (await request("GET", `/jogos/${jogoId}`, presidente.cookie)).json();

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Designações saem em cascata com o jogo; inscrições, com o campeonato.
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

test("presidente agenda jogo com hora local e fuso IANA; agendar não inicia o jogo", async () => {
  const campeonato = await campeonatoComClubes(3);
  const [a, b, c] = campeonato.clubes;
  // 23h30 em São Paulo já é o dia seguinte em UTC: o dia do jogo segue o fuso do local.
  const response = await agendar(campeonato.id, { clubeAId: a.toUpperCase(), clubeBId: b, inicioPrevisto: "2026-12-05T23:30", fusoHorario: "America/Sao_Paulo", local: "  Ginásio Fictício  " });
  assert.equal(response.status, 201, await response.clone().text());
  const jogo: Jogo = await response.json();
  assert.equal(jogo.status, "agendado");
  assert.equal(jogo.inicioPrevistoEm, "2026-12-06T02:30:00.000Z");
  assert.equal(jogo.inicioPrevistoLocal, "2026-12-05T23:30");
  assert.equal(jogo.fusoHorario, "America/Sao_Paulo");
  assert.equal(jogo.local, "Ginásio Fictício");
  assert.deepEqual([jogo.iniciadoEm, jogo.encerradoEm, jogo.arbitragens], [null, null, []]);
  assert.deepEqual([jogo.clubeA.clube.id, jogo.clubeB.clube.id], [a, b]);
  assert.equal(jogo.clubeA.inscricaoId, campeonato.inscricoes.find(i => i.clube.id === a)!.id);
  assert.equal(await prisma.jogo.count({ where: { id: jogo.id, criadoPorPresidenteId: presidente.id } }), 1);

  // Outro fuso, sem local; a mesma hora local vira outro instante.
  const recife: Jogo = await (await agendar(campeonato.id, { ...padrao(c, a), inicioPrevisto: "2026-12-01T10:00" })).json();
  assert.deepEqual([recife.inicioPrevistoEm, recife.inicioPrevistoLocal, recife.local], ["2026-12-01T13:00:00.000Z", "2026-12-01T10:00", null]);
  // Os mesmos clubes podem ter mais de um jogo no campeonato.
  assert.equal((await agendar(campeonato.id, padrao(b, a))).status, 201);

  const lista: Jogo[] = await (await request("GET", `/campeonatos/${campeonato.id}/jogos`, presidente.cookie)).json();
  assert.equal(lista.length, 3);
  assert.equal(lista[0].id, recife.id, "ordenada pelo início previsto");
  assert.deepEqual(await consultarJogo(jogo.id.toUpperCase()), jogo);
  assert.equal((await request("GET", `/jogos/${randomUUID()}`, presidente.cookie)).status, 404);
  assert.equal((await request("GET", "/jogos/nao-uuid", presidente.cookie)).status, 400);
  assert.equal((await request("GET", `/campeonatos/${randomUUID()}/jogos`, presidente.cookie)).status, 404);
  assert.deepEqual((await (await request("GET", `/campeonatos/${campeonato.id}`, presidente.cookie)).json()).jogos, { agendado: 3, em_andamento: 0, finalizado: 0, cancelado: 0 });
});

test("agendamento recusa dados inválidos, fuso desconhecido, hora inexistente e clubes fora do campeonato", async () => {
  const campeonato = await campeonatoComClubes(2);
  const [a, b] = campeonato.clubes;
  const outro = await campeonatoComClubes(2);
  const valido = padrao(a, b);
  for (const body of [{}, { ...valido, clubeBId: a }, { ...valido, clubeAId: "nao-uuid" }, { ...valido, inicioPrevisto: "05/12/2026 19:00" },
    { ...valido, inicioPrevisto: "2026-12-05T19:00-03:00" }, { ...valido, inicioPrevisto: "2026-12-05T19:00:00Z" }, { ...valido, inicioPrevisto: "2026-02-30T19:00" },
    { ...valido, inicioPrevisto: "2026-12-05T25:00" }, { ...valido, fusoHorario: "+03:00" }, { ...valido, fusoHorario: "Mars/Base" }, { ...valido, fusoHorario: "" },
    { ...valido, fusoHorario: "America/Recife/Centro" }, { ...valido, status: "em_andamento" }, { ...valido, iniciadoEm: new Date().toISOString() },
    { ...valido, inscricaoClubeAId: campeonato.inscricoes[0].id }, { ...valido, local: "" },
    // Horário pulado e repetido na mudança de horário de verão de Nova York.
    { ...valido, fusoHorario: "America/New_York", inicioPrevisto: "2026-03-08T02:30" }, { ...valido, fusoHorario: "America/New_York", inicioPrevisto: "2026-11-01T01:30" }]) {
    assert.equal((await agendar(campeonato.id, body)).status, 400, JSON.stringify(body));
  }
  // Clube de outro campeonato ou sem inscrição: 409; campeonato inexistente: 404.
  assert.equal((await agendar(campeonato.id, padrao(a, outro.clubes[0]))).status, 409);
  assert.equal((await agendar(campeonato.id, padrao(await criarClube(), b))).status, 409);
  assert.equal((await agendar(randomUUID(), valido)).status, 404);
  assert.equal(await prisma.jogo.count({ where: { campeonatoId: campeonato.id } }), 0);

  // Campeonato em andamento recebe jogos; encerrado e cancelado, não.
  assert.equal((await request("POST", `/campeonatos/${campeonato.id}/iniciar`, presidente.cookie)).status, 200);
  assert.equal((await agendar(campeonato.id, valido)).status, 201);
  assert.equal((await request("POST", `/campeonatos/${outro.id}/cancelar`, presidente.cookie)).status, 200);
  assert.equal((await agendar(outro.id, padrao(outro.clubes[0], outro.clubes[1]))).status, 409);
});

test("designação de árbitros cadastrados e externos, única por conta e sem vínculo com os clubes do jogo", async () => {
  const campeonato = await campeonatoComClubes(2);
  const [a, b] = campeonato.clubes;
  const jogo = await jogoAgendado(campeonato);
  const neutro = await criarClube("Clube neutro");
  const atleta = await cadastrar("atleta", { clubeId: neutro, nome: "Atleta Árbitra" });
  const tecnico = await tecnicoDoClube(neutro);
  const tecnicoSemClube = await cadastrar("tecnico", { nome: "Técnico sem clube" });

  const externo = await designar(jogo.id, { nomeCompleto: "  Pessoa Externa  " });
  assert.equal(externo.status, 201, await externo.clone().text());
  const corpo: Jogo = await externo.json();
  assert.equal(corpo.arbitragens.length, 1);
  assert.deepEqual({ ...corpo.arbitragens[0], id: undefined, designadoEm: undefined }, {
    id: undefined, designadoEm: undefined, tipo: "externo", nomeCompleto: "Pessoa Externa", usuario: null, designadoPorPresidenteId: presidente.id,
  });
  // Externos não são identificados pelo nome: o mesmo nome pode ser designado novamente.
  assert.equal((await designar(jogo.id, { nomeCompleto: "Pessoa Externa" })).status, 201);

  for (const pessoa of [atleta, tecnico, tecnicoSemClube]) assert.equal((await designar(jogo.id.toUpperCase(), { usuarioId: pessoa.id.toUpperCase() })).status, 201);
  const detalhe = await consultarJogo(jogo.id);
  assert.equal(detalhe.arbitragens.length, 5);
  const daAtleta = detalhe.arbitragens.find(x => x.usuario?.id === atleta.id)!;
  assert.deepEqual([daAtleta.tipo, daAtleta.nomeCompleto, daAtleta.usuario!.perfil], ["cadastrado", "Atleta Árbitra", "atleta"]);
  // O nome exibido acompanha a conta (MAR-59).
  await prisma.usuario.update({ where: { id: atleta.id }, data: { nomeCompleto: "Atleta Renomeada" } });
  assert.equal((await consultarJogo(jogo.id)).arbitragens.find(x => x.usuario?.id === atleta.id)!.nomeCompleto, "Atleta Renomeada");

  // Conta já designada, de clube do jogo, presidente, pendente, desativada ou inexistente.
  assert.equal((await designar(jogo.id, { usuarioId: atleta.id })).status, 409);
  assert.equal((await designar(jogo.id, { usuarioId: (await cadastrar("atleta", { clubeId: a })).id })).status, 409);
  assert.equal((await designar(jogo.id, { usuarioId: (await tecnicoDoClube(b)).id })).status, 409);
  assert.equal((await designar(jogo.id, { usuarioId: (await criarPresidente()).id })).status, 409);
  assert.equal((await designar(jogo.id, { usuarioId: (await cadastrar("tecnico", { aprovar: false })).id })).status, 409);
  assert.equal((await designar(jogo.id, { usuarioId: (await cadastrar("atleta", { clubeId: neutro, aprovar: false })).id })).status, 409);
  const desativado = await cadastrar("tecnico");
  assert.equal((await request("POST", `/contas/${desativado.id}/desativacao`, presidente.cookie, {})).status, 200);
  assert.equal((await designar(jogo.id, { usuarioId: desativado.id })).status, 409);
  assert.equal((await designar(jogo.id, { usuarioId: randomUUID() })).status, 404);
  assert.equal((await designar(randomUUID(), { nomeCompleto: "Pessoa Externa" })).status, 404);
  for (const body of [{}, { usuarioId: atleta.id, nomeCompleto: "Ambos" }, { usuarioId: "nao-uuid" }, { nomeCompleto: "X" }, { nomeCompleto: "Pessoa", designadoPorPresidenteId: presidente.id }]) {
    assert.equal((await designar(jogo.id, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await consultarJogo(jogo.id)).arbitragens.length, 5);

  // A mesma conta pode arbitrar outro jogo.
  const outroJogo = await jogoAgendado(campeonato);
  assert.equal((await designar(outroJogo.id, { usuarioId: atleta.id })).status, 201);

  // Retirada: some da lista e libera nova designação; designação de outro jogo não é retirada por este.
  const retirada = await request("DELETE", `/jogos/${jogo.id}/arbitragens/${daAtleta.id.toUpperCase()}`, presidente.cookie);
  assert.equal(retirada.status, 200, await retirada.clone().text());
  assert.equal((await retirada.json()).arbitragens.some((x: Arbitragem) => x.id === daAtleta.id), false);
  assert.equal((await request("DELETE", `/jogos/${jogo.id}/arbitragens/${daAtleta.id}`, presidente.cookie)).status, 404);
  const deOutro = (await consultarJogo(outroJogo.id)).arbitragens[0].id;
  assert.equal((await request("DELETE", `/jogos/${jogo.id}/arbitragens/${deOutro}`, presidente.cookie)).status, 404);
  assert.equal((await designar(jogo.id, { usuarioId: atleta.id })).status, 201);
});

test("arbitragem só muda com jogo agendado ou em andamento", async () => {
  const campeonato = await campeonatoComClubes(2);
  const [emAndamento, finalizado, cancelado] = [await jogoAgendado(campeonato), await jogoAgendado(campeonato), await jogoAgendado(campeonato)];
  const designados = await Promise.all([finalizado, cancelado].map(async jogo => (await (await designar(jogo.id, { nomeCompleto: "Pessoa Designada" })).json() as Jogo).arbitragens[0].id));
  // Início e encerramento do jogo vêm na MAR-69: fixtures diretas.
  await prisma.jogo.update({ where: { id: emAndamento.id }, data: { status: "em_andamento", iniciadoEm: new Date() } });
  await prisma.jogo.update({ where: { id: finalizado.id }, data: { status: "finalizado", iniciadoEm: new Date(Date.now() - 3_600_000), encerradoEm: new Date() } });
  await prisma.jogo.update({ where: { id: cancelado.id }, data: { status: "cancelado" } });

  assert.equal((await designar(emAndamento.id, { nomeCompleto: "Pessoa Atrasada" })).status, 201);
  for (const [jogo, arbitragemId] of [[finalizado, designados[0]], [cancelado, designados[1]]] as const) {
    assert.equal((await designar(jogo.id, { nomeCompleto: "Pessoa Tardia" })).status, 409);
    assert.equal((await request("DELETE", `/jogos/${jogo.id}/arbitragens/${arbitragemId}`, presidente.cookie)).status, 409);
    assert.equal((await consultarJogo(jogo.id)).arbitragens.length, 1, "designação preservada no histórico");
  }
});

test("restrições do banco protegem fuso, clubes do jogo e designações independentemente da aplicação", async () => {
  const campeonato = await campeonatoComClubes(3);
  const [ia, ib, ic] = campeonato.inscricoes.map(i => i.id);
  const base = { campeonatoId: campeonato.id, inscricaoClubeAId: ia, inscricaoClubeBId: ib, criadoPorPresidenteId: presidente.id };
  for (const fusoHorario of ["+03:00", "Mars/Base", "America/Recife/Centro", "UTC+3"]) {
    await assert.rejects(prisma.jogo.create({ data: { ...base, fusoHorario } }), fusoHorario);
  }
  const jogo = await prisma.jogo.create({ data: { ...base, fusoHorario: "America/Recife" } });
  await assert.rejects(prisma.jogo.update({ where: { id: jogo.id }, data: { fusoHorario: "Mars/Base" } }));
  await assert.rejects(prisma.jogo.update({ where: { id: jogo.id }, data: { inscricaoClubeBId: ic } }));
  await assert.rejects(prisma.jogo.update({ where: { id: jogo.id }, data: { criadoPorPresidenteId: (await criarPresidente()).id } }));
  await prisma.jogo.update({ where: { id: jogo.id }, data: { local: "Ginásio Corrigido" } });

  const neutro = await criarClube("Clube neutro do banco");
  const tecnico = await tecnicoDoClube(neutro);
  const designacao = { jogoId: jogo.id, designadoPorPresidenteId: presidente.id, designadoEm: new Date() };
  // Identificação: conta ou nome, nunca ambos/nenhum; conta só por designação; presidente não é designado.
  await assert.rejects(prisma.arbitragem.create({ data: { ...designacao, usuarioId: tecnico.id, nomeCompleto: "Ambos" } }));
  await assert.rejects(prisma.arbitragem.create({ data: designacao }));
  await assert.rejects(prisma.arbitragem.create({ data: { ...designacao, nomeCompleto: " " } }));
  await assert.rejects(prisma.arbitragem.create({ data: { jogoId: jogo.id, usuarioId: tecnico.id } }));
  await assert.rejects(prisma.arbitragem.create({ data: { ...designacao, nomeCompleto: "Sem data", designadoEm: null } }));
  await assert.rejects(prisma.arbitragem.create({ data: { ...designacao, usuarioId: presidente.id } }));
  // Registro sem designação (entrada por senha, MAR-65) só identifica pelo nome.
  await prisma.arbitragem.create({ data: { jogoId: jogo.id, nomeCompleto: "Entrada por senha" } });

  const arbitragem = await prisma.arbitragem.create({ data: { ...designacao, usuarioId: tecnico.id } });
  await assert.rejects(prisma.arbitragem.create({ data: { ...designacao, usuarioId: tecnico.id } }), { code: "P2002" });
  for (const data of [{ usuarioId: null, nomeCompleto: "Trocado" }, { designadoEm: new Date(0) }, { jogoId: (await prisma.jogo.create({ data: { ...base, fusoHorario: "UTC" } })).id }]) {
    await assert.rejects(prisma.arbitragem.update({ where: { id: arbitragem.id }, data }), JSON.stringify(data));
  }
  // Jogo terminado não recebe nem perde designações.
  await prisma.jogo.update({ where: { id: jogo.id }, data: { status: "cancelado" } });
  await assert.rejects(prisma.arbitragem.create({ data: { ...designacao, nomeCompleto: "Tardia" } }));
  await assert.rejects(prisma.arbitragem.delete({ where: { id: arbitragem.id } }));
  assert.equal(await prisma.arbitragem.count({ where: { jogoId: jogo.id } }), 2);
});

test("operações concorrentes: designação única e agendamento/designação contra transições", async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const campeonato = await campeonatoComClubes(2);
    const jogo = await jogoAgendado(campeonato);
    const tecnico = await tecnicoDoClube(await criarClube(`Clube neutro ${rodada}`));
    const designacoes = await Promise.all([1, 2, 3].map(() => designar(jogo.id, { usuarioId: tecnico.id })));
    assert.deepEqual(designacoes.map(r => r.status).sort(), [201, 409, 409]);
    assert.equal(await prisma.arbitragem.count({ where: { jogoId: jogo.id } }), 1);

    // Agendar enquanto o campeonato é cancelado: nunca jogo agendado em campeonato cancelado.
    const [agendamento, cancelamento] = await Promise.all([
      agendar(campeonato.id, padrao(campeonato.clubes[0], campeonato.clubes[1])),
      request("POST", `/campeonatos/${campeonato.id}/cancelar`, presidente.cookie),
    ]);
    assert.equal(cancelamento.status, 200, await cancelamento.clone().text());
    assert.ok([201, 409].includes(agendamento.status), String(agendamento.status));
    assert.equal(await prisma.jogo.count({ where: { campeonatoId: campeonato.id, status: "agendado" } }), 0);

    // Designar enquanto o campeonato cancela o jogo: designação concluída antes ou recusada depois.
    const outro = await campeonatoComClubes(2);
    const alvo = await jogoAgendado(outro);
    const [designacao, cancelou] = await Promise.all([
      designar(alvo.id, { nomeCompleto: "Pessoa Concorrente" }),
      request("POST", `/campeonatos/${outro.id}/cancelar`, presidente.cookie),
    ]);
    assert.equal(cancelou.status, 200);
    assert.ok([201, 409].includes(designacao.status), String(designacao.status));
    const final = await consultarJogo(alvo.id);
    assert.equal(final.status, "cancelado");
    assert.equal(final.arbitragens.length, designacao.status === 201 ? 1 : 0);
  }
});

test("somente presidente ativo agenda, consulta e designa; contrato OpenAPI publica as rotas", async () => {
  const campeonato = await campeonatoComClubes(2);
  const jogo = await jogoAgendado(campeonato);
  const designado = (await (await designar(jogo.id, { nomeCompleto: "Pessoa Designada" })).json() as Jogo).arbitragens[0].id;
  const neutro = await criarClube("Clube dos curiosos");
  const tecnico = await tecnicoDoClube(neutro);
  const atleta = await cadastrar("atleta", { clubeId: neutro });
  // Designação não concede acesso administrativo ao jogo.
  assert.equal((await designar(jogo.id, { usuarioId: tecnico.id })).status, 201);

  const operacoes: [Metodo, string, unknown?][] = [
    ["GET", `/campeonatos/${campeonato.id}/jogos`],
    ["POST", `/campeonatos/${campeonato.id}/jogos`, padrao(campeonato.clubes[0], campeonato.clubes[1])],
    ["GET", `/jogos/${jogo.id}`],
    ["POST", `/jogos/${jogo.id}/arbitragens`, { nomeCompleto: "Pessoa Indevida" }],
    ["DELETE", `/jogos/${jogo.id}/arbitragens/${designado}`],
  ];
  for (const [metodo, path, body] of operacoes) {
    assert.equal((await request(metodo, path, "", body)).status, 401, `${metodo} ${path} sem sessão`);
    for (const { cookie } of [tecnico, atleta]) assert.equal((await request(metodo, path, cookie, body)).status, 403, `${metodo} ${path}`);
    if (metodo !== "GET") assert.equal((await request(metodo, path, presidente.cookie, body, false)).status, 403, `${metodo} ${path} sem origem`);
  }
  const desativado = await criarPresidente();
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  for (const [metodo, path, body] of operacoes) assert.equal((await request(metodo, path, desativado.cookie, body)).status, 401);

  assert.equal(await prisma.jogo.count({ where: { campeonatoId: campeonato.id } }), 1);
  assert.deepEqual((await consultarJogo(jogo.id)).arbitragens.map(a => a.nomeCompleto).sort(), ["Pessoa Designada", "Pessoa Fictícia"]);

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const [path, metodo] of [["/campeonatos/{campeonatoId}/jogos", "get"], ["/campeonatos/{campeonatoId}/jogos", "post"], ["/jogos/{jogoId}", "get"],
    ["/jogos/{jogoId}/arbitragens", "post"], ["/jogos/{jogoId}/arbitragens/{arbitragemId}", "delete"]]) {
    assert.ok(contrato.paths[path]?.[metodo], `${metodo} ${path}`);
  }
});
