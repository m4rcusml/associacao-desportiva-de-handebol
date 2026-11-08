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

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
    await tx.authUser.create({ data: { id: authId, name: "Presidente de campeonatos", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente de campeonatos", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
async function cadastrar(perfil: "atleta" | "tecnico", clubeId?: string) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: "Pessoa Fictícia", email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const { usuario } = await response.json();
  return { id: usuario.id as string, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;
type Campeonato = { id: string; inicio: string | null; fim: string | null; status: string; inscricoes: { id: string; clube: { id: string } }[]; jogos: Record<string, number> };

async function criarClube(nome = "Clube de campeonato") {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
async function criarCampeonato(body: Record<string, unknown> = {}): Promise<Campeonato> {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato Fictício", edicao: "2026", categoria: "Sub-17", ...body });
  assert.equal(response.status, 201, await response.clone().text());
  const campeonato = await response.json();
  campeonatos.push(campeonato.id);
  return campeonato;
}
const inscrever = (campeonatoId: string, clubeId: string, cookie = presidente.cookie) => request("POST", `/campeonatos/${campeonatoId}/inscricoes`, cookie, { clubeId });
const transicao = (campeonatoId: string, acao: "iniciar" | "encerrar" | "cancelar", cookie = presidente.cookie) => request("POST", `/campeonatos/${campeonatoId}/${acao}`, cookie);
const consultar = async (campeonatoId: string): Promise<Campeonato> => (await request("GET", `/campeonatos/${campeonatoId}`, presidente.cookie)).json();
async function comInscricoes(quantidade: number) {
  const campeonato = await criarCampeonato();
  for (let i = 0; i < quantidade; i++) assert.equal((await inscrever(campeonato.id, await criarClube(`Clube inscrito ${i}`))).status, 201);
  return consultar(campeonato.id);
}
/** Fixture direta: o agendamento de jogos pela API fica na MAR-62. */
function criarJogo(campeonatoId: string, inscricaoA: string, inscricaoB: string, dados: { status?: "agendado" | "em_andamento" | "finalizado" | "cancelado"; iniciadoEm?: Date; encerradoEm?: Date } = {}) {
  return prisma.jogo.create({ data: { campeonatoId, inscricaoClubeAId: inscricaoA, inscricaoClubeBId: inscricaoB, fusoHorario: "America/Recife", criadoPorPresidenteId: presidente.id, ...dados } });
}
const finalizado = () => ({ status: "finalizado" as const, iniciadoEm: new Date(Date.now() - 3_600_000), encerradoEm: new Date() });
const emAndamento = () => ({ status: "em_andamento" as const, iniciadoEm: new Date() });

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    await tx.jogo.deleteMany({ where: { campeonatoId: { in: campeonatos } } });
    // Inscrições saem em cascata com o próprio campeonato.
    await tx.campeonato.deleteMany({ where: { id: { in: campeonatos } } });
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = (await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id);
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

test("presidente cria, lista e consulta campeonatos com campos mínimos e datas informativas", async () => {
  const campeonato = await criarCampeonato({ nome: "  Copa Fictícia  ", inicio: "2026-12-01", fim: "2026-12-20" });
  assert.deepEqual({ ...campeonato, id: undefined }, {
    id: undefined, nome: "Copa Fictícia", edicao: "2026", categoria: "Sub-17", inicio: "2026-12-01", fim: "2026-12-20",
    status: "planejado", criadoPorPresidenteId: presidente.id, inscricoes: [], jogos: { agendado: 0, em_andamento: 0, finalizado: 0, cancelado: 0 },
  });
  // Datas são opcionais; nome/edição não identificam o campeonato (homônimo permitido).
  const semDatas = await criarCampeonato({ nome: "Copa Fictícia" });
  assert.equal(semDatas.inicio, null);
  assert.equal(semDatas.fim, null);
  // Datas passadas não mudam o status: continua planejado.
  const passado = await criarCampeonato({ inicio: "2020-01-01", fim: "2020-01-02" });
  assert.equal(passado.status, "planejado");

  const lista = await (await request("GET", "/campeonatos", presidente.cookie)).json() as { id: string }[];
  assert.deepEqual(lista.find(c => c.id === campeonato.id), { id: campeonato.id, nome: "Copa Fictícia", edicao: "2026", categoria: "Sub-17", inicio: "2026-12-01", fim: "2026-12-20", status: "planejado", inscricoes: 0 });
  const consulta = await request("GET", `/campeonatos/${campeonato.id.toUpperCase()}`, presidente.cookie);
  assert.equal(consulta.status, 200);
  assert.deepEqual(await consulta.json(), campeonato);

  const validos = { nome: "Válido", edicao: "2026", categoria: "Adulto" };
  for (const body of [{}, { ...validos, nome: "X" }, { ...validos, edicao: " " }, { ...validos, categoria: "" }, { nome: "Válido", edicao: "2026" },
    { ...validos, status: "em_andamento" }, { ...validos, criadoPorPresidenteId: randomUUID() }, { ...validos, idadeMinima: 15 },
    { ...validos, inicio: "2026-13-01" }, { ...validos, inicio: "01/12/2026" }, { ...validos, inicio: "2026-12-10", fim: "2026-12-09" }]) {
    assert.equal((await request("POST", "/campeonatos", presidente.cookie, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await request("GET", `/campeonatos/${randomUUID()}`, presidente.cookie)).status, 404);
  assert.equal((await request("GET", "/campeonatos/nao-uuid", presidente.cookie)).status, 400);
  // Não há exclusão de campeonatos.
  assert.equal((await request("DELETE", `/campeonatos/${campeonato.id}`, presidente.cookie)).status, 404);
});

test("inscrição única por clube e campeonato; retirada somente sem jogos", async () => {
  const campeonato = await criarCampeonato();
  const [a, b, c] = [await criarClube("Clube A"), await criarClube("Clube B"), await criarClube("Clube C")];
  const inscrito = await inscrever(campeonato.id, a.toUpperCase());
  assert.equal(inscrito.status, 201, await inscrito.clone().text());
  const detalhe = await inscrito.json() as Campeonato & { inscricoes: { incluidaPorPresidenteId: string; clube: { nome: string } }[] };
  assert.equal(detalhe.inscricoes.length, 1);
  assert.equal(detalhe.inscricoes[0].clube.id, a);
  assert.equal(detalhe.inscricoes[0].clube.nome, "Clube A");
  assert.equal(detalhe.inscricoes[0].incluidaPorPresidenteId, presidente.id);

  assert.equal((await inscrever(campeonato.id, a)).status, 409);
  assert.equal((await inscrever(campeonato.id, randomUUID())).status, 404);
  assert.equal((await inscrever(randomUUID(), b)).status, 404);
  for (const body of [{}, { clubeId: "nao-uuid" }, { clubeId: b, campeonatoId: campeonato.id }]) {
    assert.equal((await request("POST", `/campeonatos/${campeonato.id}/inscricoes`, presidente.cookie, body)).status, 400);
  }
  // O mesmo clube pode se inscrever em outro campeonato.
  const outro = await criarCampeonato();
  assert.equal((await inscrever(outro.id, a)).status, 201);

  assert.equal((await inscrever(campeonato.id, b)).status, 201);
  const comC = await (await inscrever(campeonato.id, c)).json() as Campeonato;
  const [ia, ib, ic] = [a, b, c].map(id => comC.inscricoes.find(i => i.clube.id === id)!.id);
  await criarJogo(campeonato.id, ia, ib);

  // Inscrição com jogo não sai; sem jogo, sai e o clube continua existindo.
  assert.equal((await request("DELETE", `/campeonatos/${campeonato.id}/inscricoes/${ia}`, presidente.cookie)).status, 409);
  const retirada = await request("DELETE", `/campeonatos/${campeonato.id}/inscricoes/${ic.toUpperCase()}`, presidente.cookie);
  assert.equal(retirada.status, 200, await retirada.clone().text());
  assert.deepEqual((await retirada.json()).inscricoes.map((i: { id: string }) => i.id).sort(), [ia, ib].sort());
  assert.equal(await prisma.clube.count({ where: { id: c } }), 1);
  assert.equal((await request("DELETE", `/campeonatos/${campeonato.id}/inscricoes/${ic}`, presidente.cookie)).status, 404);
  // Inscrição de outro campeonato não é retirada por este.
  const inscricaoOutro = (await consultar(outro.id)).inscricoes[0].id;
  assert.equal((await request("DELETE", `/campeonatos/${campeonato.id}/inscricoes/${inscricaoOutro}`, presidente.cookie)).status, 404);
  assert.equal(await prisma.inscricaoClube.count({ where: { id: inscricaoOutro } }), 1);
  // Retirada já liberada permite inscrever de novo enquanto planejado.
  assert.equal((await inscrever(campeonato.id, c)).status, 201);
});

test("ciclo: iniciar exige dois clubes, encerrar exige jogos concluídos; repetição não repete efeitos", async () => {
  const campeonato = await comInscricoes(1);
  assert.equal((await transicao(campeonato.id, "iniciar")).status, 409);
  assert.equal((await transicao(campeonato.id, "encerrar")).status, 409);
  assert.equal((await inscrever(campeonato.id, await criarClube())).status, 201);
  const [ia, ib] = (await consultar(campeonato.id)).inscricoes.map(i => i.id);

  const iniciado = await transicao(campeonato.id, "iniciar");
  assert.equal(iniciado.status, 200, await iniciado.clone().text());
  const corpo = await iniciado.json();
  assert.equal(corpo.alterado, true);
  assert.equal(corpo.campeonato.status, "em_andamento");
  const repetido = await (await transicao(campeonato.id, "iniciar")).json();
  assert.deepEqual(repetido, { ...corpo, alterado: false });

  // Inscrições ficam fixas após o início.
  assert.equal((await inscrever(campeonato.id, await criarClube())).status, 409);
  assert.equal((await request("DELETE", `/campeonatos/${campeonato.id}/inscricoes/${ia}`, presidente.cookie)).status, 409);

  const jogos = [await criarJogo(campeonato.id, ia, ib), await criarJogo(campeonato.id, ib, ia, emAndamento()), await criarJogo(campeonato.id, ia, ib, { status: "cancelado" })];
  assert.equal((await transicao(campeonato.id, "encerrar")).status, 409);
  await prisma.jogo.update({ where: { id: jogos[0].id }, data: finalizado() });
  assert.equal((await transicao(campeonato.id, "encerrar")).status, 409);
  await prisma.jogo.update({ where: { id: jogos[1].id }, data: { status: "finalizado", encerradoEm: new Date() } });

  const encerrado = await (await transicao(campeonato.id, "encerrar")).json();
  assert.equal(encerrado.alterado, true);
  assert.equal(encerrado.campeonato.status, "encerrado");
  assert.deepEqual(encerrado.campeonato.jogos, { agendado: 0, em_andamento: 0, finalizado: 2, cancelado: 1 });
  assert.equal((await (await transicao(campeonato.id, "encerrar")).json()).alterado, false);
  // Encerrado é final: não reinicia nem cancela; inscrições e jogos preservados.
  assert.equal((await transicao(campeonato.id, "iniciar")).status, 409);
  assert.equal((await transicao(campeonato.id, "cancelar")).status, 409);
  assert.equal((await consultar(campeonato.id)).inscricoes.length, 2);
  assert.equal(await prisma.jogo.count({ where: { campeonatoId: campeonato.id } }), 3);
});

test("cancelar exige nenhum jogo em andamento e cancela os agendados na mesma transação", async () => {
  // Planejado pode ser cancelado diretamente.
  const planejado = await comInscricoes(2);
  const [pa, pb] = planejado.inscricoes.map(i => i.id);
  await criarJogo(planejado.id, pa, pb);
  const cancelado = await (await transicao(planejado.id, "cancelar")).json();
  assert.equal(cancelado.alterado, true);
  assert.equal(cancelado.campeonato.status, "cancelado");
  assert.deepEqual(cancelado.campeonato.jogos, { agendado: 0, em_andamento: 0, finalizado: 0, cancelado: 1 });
  assert.equal((await (await transicao(planejado.id, "cancelar")).json()).alterado, false);
  for (const acao of ["iniciar", "encerrar"] as const) assert.equal((await transicao(planejado.id, acao)).status, 409);
  assert.equal((await inscrever(planejado.id, await criarClube())).status, 409);

  // Em andamento: jogo em andamento impede; após finalizá-lo, cancela agendados e preserva finalizados.
  const campeonato = await comInscricoes(2);
  const [ia, ib] = campeonato.inscricoes.map(i => i.id);
  assert.equal((await transicao(campeonato.id, "iniciar")).status, 200);
  const emJogo = await criarJogo(campeonato.id, ia, ib, emAndamento());
  const agendados = [await criarJogo(campeonato.id, ia, ib), await criarJogo(campeonato.id, ib, ia)];
  assert.equal((await transicao(campeonato.id, "cancelar")).status, 409);
  assert.equal(await prisma.jogo.count({ where: { campeonatoId: campeonato.id, status: "agendado" } }), 2);
  await prisma.jogo.update({ where: { id: emJogo.id }, data: { status: "finalizado", encerradoEm: new Date() } });
  const resultado = await (await transicao(campeonato.id, "cancelar")).json();
  assert.equal(resultado.campeonato.status, "cancelado");
  assert.deepEqual(resultado.campeonato.jogos, { agendado: 0, em_andamento: 0, finalizado: 1, cancelado: 2 });
  for (const jogo of agendados) assert.equal((await prisma.jogo.findUniqueOrThrow({ where: { id: jogo.id } })).status, "cancelado");
});

test("restrições do banco protegem campeonato, inscrições e jogos independentemente da aplicação", async () => {
  const campeonato = await comInscricoes(2);
  const [ia, ib] = campeonato.inscricoes.map(i => i.id);
  const outro = await comInscricoes(2);
  const estranha = outro.inscricoes[0].id;

  // RN-022: clubes distintos e inscritos no próprio campeonato.
  await assert.rejects(criarJogo(campeonato.id, ia, ia));
  await assert.rejects(criarJogo(campeonato.id, ia, estranha));
  await assert.rejects(criarJogo(outro.id, ia, estranha));
  // Horários coerentes com o status.
  await assert.rejects(criarJogo(campeonato.id, ia, ib, { iniciadoEm: new Date() }));
  await assert.rejects(criarJogo(campeonato.id, ia, ib, { status: "em_andamento" }));
  await assert.rejects(criarJogo(campeonato.id, ia, ib, { status: "finalizado" }));
  await assert.rejects(prisma.jogo.create({ data: { campeonatoId: campeonato.id, inscricaoClubeAId: ia, inscricaoClubeBId: ib, fusoHorario: " ", criadoPorPresidenteId: presidente.id } }));

  // Inscrição duplicada, alterada ou de outro clube no lugar.
  await assert.rejects(prisma.inscricaoClube.create({ data: { campeonatoId: campeonato.id, clubeId: campeonato.inscricoes[0].clube.id, incluidaPorPresidenteId: presidente.id } }), { code: "P2002" });
  await assert.rejects(prisma.inscricaoClube.update({ where: { id: ia }, data: { clubeId: await criarClube() } }));
  // Campeonato nasce planejado, com campos e período válidos.
  for (const dados of [{ status: "em_andamento" as const }, { nome: " " }, { inicio: new Date("2026-12-10"), fim: new Date("2026-12-09") }]) {
    await assert.rejects(prisma.campeonato.create({ data: { nome: "Direto", edicao: "1", categoria: "Livre", criadoPorPresidenteId: presidente.id, ...dados } }), JSON.stringify(dados));
  }

  // Transições inválidas ou sem pré-condição são recusadas pelo trigger.
  await assert.rejects(prisma.campeonato.update({ where: { id: campeonato.id }, data: { status: "encerrado" } }));
  const umClube = await comInscricoes(1);
  await assert.rejects(prisma.campeonato.update({ where: { id: umClube.id }, data: { status: "em_andamento" } }));
  await prisma.campeonato.update({ where: { id: campeonato.id }, data: { status: "em_andamento" } });
  await assert.rejects(prisma.campeonato.update({ where: { id: campeonato.id }, data: { status: "planejado" } }));
  // Inscrições não entram nem saem com o campeonato em andamento.
  await assert.rejects(prisma.inscricaoClube.create({ data: { campeonatoId: campeonato.id, clubeId: await criarClube(), incluidaPorPresidenteId: presidente.id } }));
  await assert.rejects(prisma.inscricaoClube.delete({ where: { id: ia } }));
  // Jogo agendado impede encerrar e cancelar diretamente.
  const jogo = await criarJogo(campeonato.id, ia, ib);
  await assert.rejects(prisma.campeonato.update({ where: { id: campeonato.id }, data: { status: "encerrado" } }));
  await assert.rejects(prisma.campeonato.update({ where: { id: campeonato.id }, data: { status: "cancelado" } }));
  await assert.rejects(prisma.jogo.update({ where: { id: jogo.id }, data: { campeonatoId: outro.id } }));
  await prisma.jogo.update({ where: { id: jogo.id }, data: { status: "cancelado" } });
  await prisma.campeonato.update({ where: { id: campeonato.id }, data: { status: "encerrado" } });
  // Encerrado não muda e não recebe nem reativa jogos.
  await assert.rejects(prisma.campeonato.update({ where: { id: campeonato.id }, data: { nome: "Renomeado" } }));
  await assert.rejects(prisma.campeonato.update({ where: { id: campeonato.id }, data: { status: "cancelado" } }));
  await assert.rejects(criarJogo(campeonato.id, ia, ib));
  await assert.rejects(prisma.jogo.update({ where: { id: jogo.id }, data: { status: "agendado" } }));
  // Encerrado preserva inscrições.
  await assert.rejects(prisma.inscricaoClube.delete({ where: { id: ib } }));
  assert.equal(await prisma.inscricaoClube.count({ where: { campeonatoId: campeonato.id } }), 2);
});

test("operações concorrentes no mesmo campeonato não repetem efeitos nem violam pré-condições", async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    // Inscrições simultâneas do mesmo clube: exatamente uma.
    const campeonato = await criarCampeonato();
    const clube = await criarClube(`Clube concorrente ${rodada}`);
    const inscricoes = await Promise.all([1, 2, 3].map(() => inscrever(campeonato.id, clube)));
    assert.deepEqual(inscricoes.map(r => r.status).sort(), [201, 409, 409]);
    assert.equal(await prisma.inscricaoClube.count({ where: { campeonatoId: campeonato.id } }), 1);

    // Inícios simultâneos: todos respondem 200, só um aplica a transição.
    assert.equal((await inscrever(campeonato.id, await criarClube())).status, 201);
    const inicios = await Promise.all([1, 2, 3].map(() => transicao(campeonato.id, "iniciar")));
    assert.deepEqual(inicios.map(r => r.status), [200, 200, 200]);
    const alterados = await Promise.all(inicios.map(async r => (await r.json()).alterado));
    assert.deepEqual(alterados.sort(), [false, false, true]);

    // Encerrar e cancelar ao mesmo tempo: exatamente um prevalece.
    const fim = await Promise.all([transicao(campeonato.id, "encerrar"), transicao(campeonato.id, "cancelar")]);
    assert.deepEqual(fim.map(r => r.status).sort(), [200, 409]);
    const final = (await consultar(campeonato.id)).status;
    assert.equal(final, fim[0].status === 200 ? "encerrado" : "cancelado");

    // Iniciar com dois clubes enquanto um é retirado: nunca em andamento com menos de dois.
    const disputado = await comInscricoes(2);
    const [retirada, inicio] = await Promise.all([
      request("DELETE", `/campeonatos/${disputado.id}/inscricoes/${disputado.inscricoes[0].id}`, presidente.cookie),
      transicao(disputado.id, "iniciar"),
    ]);
    assert.deepEqual([retirada.status, inicio.status].sort(), [200, 409]);
    const estado = await consultar(disputado.id);
    assert.equal(estado.status, inicio.status === 200 ? "em_andamento" : "planejado");
    assert.equal(estado.inscricoes.length, inicio.status === 200 ? 2 : 1);

    // Jogo criado enquanto o campeonato é encerrado: nunca encerrado com jogo agendado.
    const comJogos = await comInscricoes(2);
    const [ja, jb] = comJogos.inscricoes.map(i => i.id);
    assert.equal((await transicao(comJogos.id, "iniciar")).status, 200);
    const [novoJogo, encerramento] = await Promise.allSettled([criarJogo(comJogos.id, ja, jb), transicao(comJogos.id, "encerrar")]);
    const encerrou = encerramento.status === "fulfilled" && encerramento.value.status === 200;
    assert.notEqual(novoJogo.status === "fulfilled", encerrou, "exatamente um entre criar jogo e encerrar conclui");
    const situacao = await consultar(comJogos.id);
    assert.equal(situacao.status, encerrou ? "encerrado" : "em_andamento");
    assert.equal(situacao.jogos.agendado, encerrou ? 0 : 1);
  }
});

test("somente presidente ativo opera campeonatos; contrato OpenAPI publica as rotas", async () => {
  const campeonato = await comInscricoes(2);
  const clube = await criarClube("Clube do técnico");
  const tecnico = await cadastrar("tecnico");
  await prisma.tecnico.update({ where: { usuarioId: tecnico.id }, data: { statusVerificacao: "aprovado", verificadoPorPresidenteId: presidente.id, verificadoEm: new Date(), clubeId: clube } });
  const atleta = await cadastrar("atleta", clube);

  const operacoes: [Metodo, string, unknown?][] = [
    ["GET", "/campeonatos"],
    ["GET", `/campeonatos/${campeonato.id}`],
    ["POST", "/campeonatos", { nome: "Indevido", edicao: "1", categoria: "Livre" }],
    ["POST", `/campeonatos/${campeonato.id}/inscricoes`, { clubeId: clube }],
    ["DELETE", `/campeonatos/${campeonato.id}/inscricoes/${campeonato.inscricoes[0].id}`],
    ["POST", `/campeonatos/${campeonato.id}/iniciar`],
    ["POST", `/campeonatos/${campeonato.id}/encerrar`],
    ["POST", `/campeonatos/${campeonato.id}/cancelar`],
  ];
  for (const [metodo, path, body] of operacoes) {
    assert.equal((await request(metodo, path, "", body)).status, 401, `${metodo} ${path} sem sessão`);
    for (const { cookie } of [tecnico, atleta]) assert.equal((await request(metodo, path, cookie, body)).status, 403, `${metodo} ${path}`);
    if (metodo !== "GET") assert.equal((await request(metodo, path, presidente.cookie, body, false)).status, 403, `${metodo} ${path} sem origem`);
  }
  const desativado = await criarPresidente();
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  for (const [metodo, path, body] of operacoes) assert.equal((await request(metodo, path, desativado.cookie, body)).status, 401);

  const estado = await consultar(campeonato.id);
  assert.equal(estado.status, "planejado");
  assert.equal(estado.inscricoes.length, 2);
  assert.equal(await prisma.campeonato.count({ where: { nome: "Indevido" } }), 0);

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const [path, metodo] of [["/campeonatos", "get"], ["/campeonatos", "post"], ["/campeonatos/{campeonatoId}", "get"], ["/campeonatos/{campeonatoId}/inscricoes", "post"],
    ["/campeonatos/{campeonatoId}/inscricoes/{inscricaoId}", "delete"], ["/campeonatos/{campeonatoId}/iniciar", "post"], ["/campeonatos/{campeonatoId}/encerrar", "post"], ["/campeonatos/{campeonatoId}/cancelar", "post"]]) {
    assert.ok(contrato.paths[path]?.[metodo], `${metodo} ${path}`);
  }
});
