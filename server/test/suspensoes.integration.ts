import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { reduzirSuspensao, registrarCumprimentos } from "../dist/modules/suspensoes/suspensoes.js";

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
    await tx.authUser.create({ data: { id: authId, name: "Presidente das suspensões", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente das suspensões", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;
type Conta = { id: string; email: string; cookie: string };

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, aprovar = true, nome = "Pessoa Fictícia" }: { clubeId?: string; aprovar?: boolean; nome?: string } = {}): Promise<Conta> {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  if (aprovar) assert.equal((await request("POST", `/verificacoes/${id}/aprovacao`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function criarClube(nome: string) {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
async function campeonatoCom(clubesInscritos: string[], iniciar = true) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato das suspensões", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  if (iniciar) assert.equal((await request("POST", `/campeonatos/${id}/iniciar`, presidente.cookie)).status, 200);
  return id;
}
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string) {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: "2026-12-05T15:00", fusoHorario: "America/Recife" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}
/** Dois clubes inscritos num campeonato em andamento, com um atleta aprovado em cada. */
async function cenario({ iniciar = true } = {}) {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const [ana, bia] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: b, nome: "Bia" })];
  const campeonato = await campeonatoCom([a, b], iniciar);
  return { a, b, ana, bia, campeonato };
}

type Pessoa = { id: string; nomeCompleto: string };
type Suspensao = {
  id: string; campeonatoId: string; atleta: Pessoa; quantidadeJogos: number; quantidadeAtual: number; motivo: string; aplicadaPor: Pessoa; aplicadaEm: string;
  revogadaEm: string | null; revogadaPor: Pessoa | null; justificativaRevogacao: string | null; saldoEncerradoEm: string | null;
  situacao: "vigente" | "cumprida" | "revogada" | "saldo_encerrado"; jogosCumpridos: number; jogosRestantes: number;
  cumprimentos: { jogoId: string; registradoEm: string }[];
  reducoes: { id: string; quantidadeAnterior: number; novaQuantidade: number; justificativa: string | null; reduzidaPor: Pessoa | null; reduzidaEm: string; herdadaDeReducaoId: string | null }[];
};
const aplicar = (campeonato: string, atletaId: string, quantidadeJogos = 1, cookie = presidente.cookie) =>
  request("POST", `/campeonatos/${campeonato}/suspensoes`, cookie, { atletaId, quantidadeJogos, motivo: "Conduta antidesportiva" });
async function suspender(campeonato: string, atletaId: string, quantidadeJogos = 1): Promise<Suspensao> {
  const response = await aplicar(campeonato, atletaId, quantidadeJogos);
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}
const revogar = (campeonato: string, id: string, justificativa = "Recurso deferido pela associação") =>
  request("POST", `/campeonatos/${campeonato}/suspensoes/${id}/revogar`, presidente.cookie, { justificativa });
const reduzir = (campeonato: string, id: string, novaQuantidade: number, justificativa = "Recurso parcialmente deferido", cookie = presidente.cookie) =>
  request("POST", `/campeonatos/${campeonato}/suspensoes/${id}/reduzir`, cookie, { novaQuantidade, justificativa });
async function reduzida(campeonato: string, id: string, novaQuantidade: number, justificativa?: string) {
  const response = await reduzir(campeonato, id, novaQuantidade, justificativa);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<{ suspensao: Suspensao; alterado: boolean }>;
}
/** Espera até que alguma conexão aguarde um bloqueio mantido pela conexão `pid`. */
async function aguardarBloqueio(pid: number, mensagem: string) {
  const limite = Date.now() + 3_000;
  while (true) {
    const [{ esperando }] = await prisma.$queryRaw<{ esperando: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS esperando`;
    if (esperando) return;
    assert.ok(Date.now() < limite, mensagem);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function listar(campeonato: string, atletaId?: string): Promise<Suspensao[]> {
  const response = await request("GET", `/campeonatos/${campeonato}/suspensoes${atletaId ? `?atletaId=${atletaId}` : ""}`, presidente.cookie);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const consultar = async (campeonato: string, id: string) => (await listar(campeonato)).find(s => s.id === id)!;

const iniciarJogo = (id: string) => prisma.jogo.update({ where: { id }, data: { status: "em_andamento", iniciadoEm: new Date() } });
/** Encerramento do jogo (MAR-69): finaliza e registra os cumprimentos na mesma transação. */
async function finalizar(id: string) {
  return prisma.$transaction(async tx => {
    const jogo = await tx.jogo.findUniqueOrThrow({ where: { id }, select: { iniciadoEm: true } });
    await tx.jogo.update({ where: { id }, data: { status: "finalizado", iniciadoEm: jogo.iniciadoEm ?? new Date(), encerradoEm: new Date(), resultado: "normal" } });
    return registrarCumprimentos(tx, id);
  });
}
const cumprir = (id: string) => prisma.$transaction(tx => registrarCumprimentos(tx, id));
/** Credenciamento direto no banco; a operação da arbitragem é testada em credenciamento.integration.ts. */
async function credenciar(jogoId: string, atletaId: string, clubeId: string, numeroCamisa: number) {
  const [vinculo, carteirinha, jogo] = await Promise.all([
    prisma.vinculoClube.findFirstOrThrow({ where: { atletaId, fim: null } }),
    prisma.carteirinha.findUniqueOrThrow({ where: { atletaId } }),
    prisma.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: { inscricaoClubeA: { select: { id: true, clubeId: true } }, inscricaoClubeB: { select: { id: true } } } }),
  ]);
  const inscricaoClubeId = jogo.inscricaoClubeA.clubeId === clubeId ? jogo.inscricaoClubeA.id : jogo.inscricaoClubeB.id;
  await prisma.participacao.create({ data: { jogoId, inscricaoClubeId, vinculoClubeId: vinculo.id, atletaId, carteirinhaId: carteirinha.id, credenciadoEm: new Date(), numeroCamisa } });
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Remover jogos leva participações e cumprimentos; remover campeonatos leva as suspensões.
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

test("presidente aplica suspensão manual com responsável, data e motivo; validações e permissões", async () => {
  const { a, ana, campeonato } = await cenario({ iniciar: false });
  const aplicada = await suspender(campeonato, ana.id, 2);
  assert.equal(aplicada.situacao, "vigente");
  assert.deepEqual([aplicada.quantidadeJogos, aplicada.jogosCumpridos, aplicada.jogosRestantes], [2, 0, 2]);
  assert.deepEqual([aplicada.atleta.id, aplicada.aplicadaPor.id, aplicada.motivo, aplicada.revogadaEm, aplicada.saldoEncerradoEm], [ana.id, presidente.id, "Conduta antidesportiva", null, null]);
  assert.ok(aplicada.aplicadaEm);

  for (const corpo of [{ atletaId: ana.id, quantidadeJogos: 0, motivo: "x" }, { atletaId: ana.id, quantidadeJogos: 1.5, motivo: "x" },
    { atletaId: ana.id, quantidadeJogos: 1, motivo: "  " }, { atletaId: ana.id, quantidadeJogos: 1, motivo: "x", saldo: 0 }, { quantidadeJogos: 1, motivo: "x" }]) {
    assert.equal((await request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, corpo)).status, 400, JSON.stringify(corpo));
  }
  const tecnico = await cadastrar("tecnico");
  assert.equal((await aplicar(campeonato, ana.id, 1, tecnico.cookie)).status, 403);
  assert.equal((await aplicar(campeonato, ana.id, 1, ana.cookie)).status, 403);
  assert.equal((await request("GET", `/campeonatos/${campeonato}/suspensoes`, tecnico.cookie)).status, 403);
  assert.equal((await aplicar(campeonato, tecnico.id)).status, 404);
  assert.equal((await aplicar(campeonato, randomUUID())).status, 404);
  assert.equal((await aplicar(randomUUID(), ana.id)).status, 404);
  const pendente = await cadastrar("atleta", { clubeId: a, aprovar: false });
  assert.equal((await aplicar(campeonato, pendente.id)).status, 409);
  assert.equal((await request("GET", `/campeonatos/${campeonato}/suspensoes?outro=1`, presidente.cookie)).status, 400);

  // Conta desativada não impede a suspensão; atleta de clube não inscrito também pode ser suspenso.
  assert.equal((await request("POST", `/contas/${ana.id}/desativacao`, presidente.cookie, {})).status, 200);
  const fora = await cadastrar("atleta", { clubeId: await criarClube("Clube fora"), nome: "Fora" });
  await suspender(campeonato, ana.id);
  await suspender(campeonato, fora.id);
  assert.deepEqual((await listar(campeonato, fora.id)).map(s => s.atleta.id), [fora.id]);
  assert.equal((await listar(campeonato)).length, 3);

  // Dados da aplicação e exclusão são protegidos também no banco.
  await assert.rejects(prisma.suspensao.update({ where: { id: aplicada.id }, data: { quantidadeJogos: 1 } }));
  await assert.rejects(prisma.suspensao.delete({ where: { id: aplicada.id } }));
});

test("aplicações simultâneas coexistem e são cumpridas em paralelo, sem saldo negativo nem repetição", async () => {
  const { a, b, ana, bia, campeonato } = await cenario();
  const respostas = await Promise.all([aplicar(campeonato, ana.id, 1), aplicar(campeonato, ana.id, 2), aplicar(campeonato, bia.id, 1)]);
  assert.deepEqual(respostas.map(r => r.status), [201, 201, 201]);
  const [curta, longa, daBia] = await Promise.all(respostas.map(r => r.json() as Promise<Suspensao>));

  const jogo1 = await agendar(campeonato, a, b);
  await iniciarJogo(jogo1);
  // Cada jogo cumpre cada suspensão vigente uma vez, inclusive sem escalação ou credenciamento.
  assert.deepEqual(await finalizar(jogo1), [curta.id, longa.id, daBia.id].sort());
  assert.deepEqual(await cumprir(jogo1), []);
  assert.deepEqual([(await consultar(campeonato, curta.id)).situacao, (await consultar(campeonato, daBia.id)).situacao], ["cumprida", "cumprida"]);
  const parcial = await consultar(campeonato, longa.id);
  assert.deepEqual([parcial.situacao, parcial.jogosCumpridos, parcial.jogosRestantes, parcial.cumprimentos.map(c => c.jogoId)], ["vigente", 1, 1, [jogo1]]);

  // Repetição simultânea do encerramento registra uma vez só.
  const jogo2 = await agendar(campeonato, b, a);
  await iniciarJogo(jogo2);
  await prisma.jogo.update({ where: { id: jogo2 }, data: { status: "finalizado", encerradoEm: new Date(), resultado: "normal" } });
  const paralelas = await Promise.all([cumprir(jogo2), cumprir(jogo2), cumprir(jogo2)]);
  assert.deepEqual(paralelas.flat(), [longa.id]);
  assert.equal((await consultar(campeonato, longa.id)).situacao, "cumprida");

  // Saldo nunca negativo: jogo seguinte não registra nada, e o banco recusa forçar.
  const jogo3 = await agendar(campeonato, a, b);
  assert.deepEqual(await finalizar(jogo3), []);
  await assert.rejects(prisma.cumprimentoSuspensao.create({ data: { suspensaoId: longa.id, jogoId: jogo3, registradoEm: new Date() } }));
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: { in: [curta.id, longa.id, daBia.id] } } }), 4);
  await assert.rejects(prisma.cumprimentoSuspensao.deleteMany({ where: { suspensaoId: longa.id } }));
});

test("nova suspensão preserva jogo já credenciado; jogo em andamento sem credenciamento conta; jogo encerrado antes não", async () => {
  const { a, b, ana, bia, campeonato } = await cenario();
  const anterior = await agendar(campeonato, a, b);
  await iniciarJogo(anterior);
  await prisma.jogo.update({ where: { id: anterior }, data: { status: "finalizado", encerradoEm: new Date(), resultado: "normal" } });

  const credenciado = await agendar(campeonato, a, b);
  await credenciar(credenciado, ana.id, a, 7);
  const emAndamento = await agendar(campeonato, b, a);
  await iniciarJogo(emAndamento);

  const daAna = await suspender(campeonato, ana.id, 2);
  const daBia = await suspender(campeonato, bia.id, 1);
  // Jogo encerrado antes da aplicação não cumpre.
  assert.deepEqual(await cumprir(anterior), []);
  await assert.rejects(prisma.cumprimentoSuspensao.create({ data: { suspensaoId: daAna.id, jogoId: anterior, registradoEm: new Date() } }));

  // O jogo em que Ana já estava credenciada é preservado: não é consumido, mas cumpre a suspensão da Bia.
  await iniciarJogo(credenciado);
  assert.deepEqual(await finalizar(credenciado), [daBia.id]);
  await assert.rejects(prisma.cumprimentoSuspensao.create({ data: { suspensaoId: daAna.id, jogoId: credenciado, registradoEm: new Date() } }));
  assert.equal((await consultar(campeonato, daAna.id)).jogosRestantes, 2);

  // Jogo já em andamento na aplicação, sem credenciamento da Ana, conta (decisão de Marcus, MAR-66).
  assert.deepEqual(await finalizar(emAndamento), [daAna.id]);
  const final = await consultar(campeonato, daAna.id);
  assert.deepEqual([final.jogosCumpridos, final.jogosRestantes, final.cumprimentos.map(c => c.jogoId)], [1, 1, [emAndamento]]);

  // Jogo não finalizado nem de outro campeonato não cumpre.
  await assert.rejects(cumprir(await agendar(campeonato, a, b)));
});

test("suspensão afeta só o campeonato, e jogo de outro clube não a cumpre", async () => {
  const { a, ana, campeonato } = await cenario();
  const c = await criarClube("Clube C");
  const outro = await campeonatoCom([a, c]);
  const daAna = await suspender(campeonato, ana.id, 1);
  const noOutro = await agendar(outro, a, c);
  assert.deepEqual(await finalizar(noOutro), []);
  await assert.rejects(prisma.cumprimentoSuspensao.create({ data: { suspensaoId: daAna.id, jogoId: noOutro, registradoEm: new Date() } }));
  assert.equal((await consultar(campeonato, daAna.id)).situacao, "vigente");
});

test("revogação preserva aplicação e cumprimentos e é definitiva", async () => {
  const { a, b, ana, campeonato } = await cenario();
  const daAna = await suspender(campeonato, ana.id, 3);
  const jogo1 = await agendar(campeonato, a, b);
  assert.deepEqual(await finalizar(jogo1), [daAna.id]);

  const [r1, r2] = await Promise.all([revogar(campeonato, daAna.id), revogar(campeonato, daAna.id)]);
  assert.deepEqual([r1.status, r2.status], [200, 200]);
  const corpos = await Promise.all([r1.json(), r2.json()]) as { suspensao: Suspensao; alterado: boolean }[];
  assert.deepEqual(corpos.map(c => c.alterado).sort(), [false, true]);
  const revogada = corpos[0].suspensao;
  assert.deepEqual([revogada.situacao, revogada.revogadaPor?.id, revogada.quantidadeJogos, revogada.jogosCumpridos, revogada.jogosRestantes, revogada.cumprimentos.map(c => c.jogoId)],
    ["revogada", presidente.id, 3, 1, 0, [jogo1]]);
  assert.ok(revogada.revogadaEm);

  // Revogada não recebe novos jogos nem volta a valer.
  assert.deepEqual(await finalizar(await agendar(campeonato, a, b)), []);
  await assert.rejects(prisma.suspensao.update({ where: { id: daAna.id }, data: { revogadaEm: null, revogadaPorPresidenteId: null } }));

  // Cumprida não é revogada; suspensão inexistente ou de outro campeonato: 404.
  const cumprida = await suspender(campeonato, ana.id, 1);
  assert.deepEqual(await finalizar(await agendar(campeonato, a, b)), [cumprida.id]);
  assert.equal((await revogar(campeonato, cumprida.id)).status, 409);
  assert.equal((await revogar(campeonato, randomUUID())).status, 404);
  assert.equal((await revogar(await campeonatoCom([a, b], false), cumprida.id)).status, 404);
});

test("revogação aguarda o último cumprimento e recusa suspensão já cumprida", async () => {
  const { a, b, ana, campeonato } = await cenario();
  const suspensao = await suspender(campeonato, ana.id);
  const jogo = await agendar(campeonato, a, b);
  let liberar!: () => void;
  let informarPid!: (pid: number) => void;
  const liberacao = new Promise<void>(resolve => { liberar = resolve; });
  const cumprimentoRegistrado = new Promise<number>(resolve => { informarPid = resolve; });
  const encerramento = prisma.$transaction(async tx => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.jogo.update({ where: { id: jogo }, data: { status: "finalizado", iniciadoEm: new Date(), encerradoEm: new Date(), resultado: "normal" } });
    assert.deepEqual(await registrarCumprimentos(tx, jogo), [suspensao.id]);
    informarPid(pid);
    await liberacao;
  }, { timeout: 10_000 });

  const pid = await Promise.race([cumprimentoRegistrado, encerramento.then(() => { throw new Error("Encerramento sem barreira"); })]);
  const resposta = revogar(campeonato, suspensao.id);
  try {
    // Só confirma o cumprimento depois que a revogação estiver esperando pelo bloqueio real no banco.
    const limite = Date.now() + 3_000;
    while (true) {
      const [{ esperando }] = await prisma.$queryRaw<{ esperando: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS esperando`;
      if (esperando) break;
      assert.ok(Date.now() < limite, "Revogação deve aguardar o cumprimento em andamento");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    liberar();
    await encerramento;
  }
  assert.equal((await resposta).status, 409);
  const final = await consultar(campeonato, suspensao.id);
  assert.deepEqual([final.situacao, final.jogosCumpridos, final.revogadaEm], ["cumprida", 1, null]);
});

test("quantidade positiva acima de 100 jogos é aceita pela API e pelo banco", async () => {
  const { ana, campeonato } = await cenario();
  const suspensao = await suspender(campeonato, ana.id, 101);
  assert.deepEqual([suspensao.quantidadeJogos, suspensao.jogosRestantes], [101, 101]);
});

test("encerrar ou cancelar o campeonato encerra o saldo, distinto de cumprimento e revogação, sem transportar", async () => {
  for (const transicao of ["encerrar", "cancelar"] as const) {
    const { a, b, ana, bia, campeonato } = await cenario();
    const comSaldo = await suspender(campeonato, ana.id, 2);
    const cumprida = await suspender(campeonato, bia.id, 1);
    const revogada = await suspender(campeonato, bia.id, 5);
    assert.equal((await revogar(campeonato, revogada.id)).status, 200);
    assert.deepEqual(await finalizar(await agendar(campeonato, a, b)), [comSaldo.id, cumprida.id].sort());

    assert.equal((await request("POST", `/campeonatos/${campeonato}/${transicao}`, presidente.cookie)).status, 200);
    const finais = new Map((await listar(campeonato)).map(s => [s.id, s]));
    const encerrada = finais.get(comSaldo.id)!;
    assert.deepEqual([encerrada.situacao, encerrada.jogosCumpridos, encerrada.jogosRestantes, encerrada.revogadaEm], ["saldo_encerrado", 1, 0, null]);
    assert.ok(encerrada.saldoEncerradoEm);
    assert.deepEqual([finais.get(cumprida.id)!.situacao, finais.get(cumprida.id)!.saldoEncerradoEm], ["cumprida", null]);
    assert.deepEqual([finais.get(revogada.id)!.situacao, finais.get(revogada.id)!.saldoEncerradoEm], ["revogada", null]);

    // Repetir a transição não muda o registro; nada é aplicado ou revogado depois; outro campeonato não herda.
    assert.equal((await request("POST", `/campeonatos/${campeonato}/${transicao}`, presidente.cookie)).status, 200);
    assert.equal((await consultar(campeonato, comSaldo.id)).saldoEncerradoEm, encerrada.saldoEncerradoEm);
    assert.equal((await aplicar(campeonato, ana.id)).status, 409);
    assert.equal((await revogar(campeonato, comSaldo.id)).status, 409);
    assert.deepEqual(await listar(await campeonatoCom([a, b])), []);
  }
});

test("escalação sinaliza suspensão vigente sem impedir a escolha", async () => {
  const { a, b, ana, campeonato } = await cenario();
  const tecnico = await cadastrar("tecnico", { nome: "Técnico A" });
  assert.equal((await request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: tecnico.id })).status, 200);
  const daAna = await suspender(campeonato, ana.id, 1);
  const jogo = await agendar(campeonato, a, b);
  const proximo = await agendar(campeonato, a, b);

  type Escalacao = { clubes: { escalados: { atleta: Pessoa; suspensaoPendente: boolean }[]; atletasDoClube: (Pessoa & { suspensaoPendente: boolean })[] }[] };
  const escolha = await request("POST", `/jogos/${proximo}/escalacao`, tecnico.cookie, { atletaId: ana.id });
  assert.equal(escolha.status, 200, await escolha.clone().text());
  const escalacao = await escolha.json() as Escalacao;
  assert.deepEqual(escalacao.clubes[0].escalados.map(e => [e.atleta.id, e.suspensaoPendente]), [[ana.id, true]]);
  assert.deepEqual(escalacao.clubes[0].atletasDoClube.map(x => [x.id, x.suspensaoPendente]), [[ana.id, true]]);

  await iniciarJogo(jogo);
  assert.deepEqual(await finalizar(jogo), [daAna.id]);
  const depois = await (await request("GET", `/jogos/${proximo}/escalacao`, tecnico.cookie)).json() as Escalacao;
  assert.deepEqual(depois.clubes[0].escalados.map(e => e.suspensaoPendente), [false]);
});

test("revogação exige justificativa, registra presidente e data e mantém a justificativa original na repetição", async () => {
  const { ana, campeonato } = await cenario();
  const daAna = await suspender(campeonato, ana.id, 2);
  for (const corpo of [undefined, {}, { justificativa: "   " }, { justificativa: "x".repeat(501) }, { justificativa: "ok", outro: 1 }]) {
    assert.equal((await request("POST", `/campeonatos/${campeonato}/suspensoes/${daAna.id}/revogar`, presidente.cookie, corpo)).status, 400, JSON.stringify(corpo));
  }
  const tecnico = await cadastrar("tecnico");
  assert.equal((await request("POST", `/campeonatos/${campeonato}/suspensoes/${daAna.id}/revogar`, tecnico.cookie, { justificativa: "x" })).status, 403);

  const primeira = await revogar(campeonato, daAna.id, "  Recurso deferido  ");
  assert.equal(primeira.status, 200);
  const { suspensao, alterado } = await primeira.json() as { suspensao: Suspensao; alterado: boolean };
  assert.deepEqual([alterado, suspensao.situacao, suspensao.justificativaRevogacao, suspensao.revogadaPor?.id], [true, "revogada", "Recurso deferido", presidente.id]);
  assert.ok(suspensao.revogadaEm);
  const repeticao = await (await revogar(campeonato, daAna.id, "Outra justificativa")).json() as { suspensao: Suspensao; alterado: boolean };
  assert.deepEqual([repeticao.alterado, repeticao.suspensao.justificativaRevogacao], [false, "Recurso deferido"]);

  // No banco: revogar sem justificativa é recusado e a justificativa registrada não muda.
  const outra = await suspender(campeonato, ana.id, 1);
  await assert.rejects(prisma.suspensao.update({ where: { id: outra.id }, data: { revogadaEm: new Date(), revogadaPorPresidenteId: presidente.id } }));
  await assert.rejects(prisma.suspensao.update({ where: { id: daAna.id }, data: { justificativaRevogacao: "Alterada" } }));
  await assert.rejects(prisma.suspensao.update({ where: { id: outra.id }, data: { justificativaRevogacao: "Sem revogação" } }));
});

test("redução define novo total, preserva original, histórico e cumprimentos; saldo nunca negativo", async () => {
  const { a, b, ana, bia, campeonato } = await cenario();
  const daAna = await suspender(campeonato, ana.id, 5);
  const jogos = [await agendar(campeonato, a, b), await agendar(campeonato, b, a)];
  for (const jogo of jogos) assert.deepEqual(await finalizar(jogo), [daAna.id]);

  // 5 jogos, 2 cumpridos, reduzida para 3: falta 1.
  const tres = await reduzida(campeonato, daAna.id, 3, "  Recurso parcialmente deferido  ");
  assert.equal(tres.alterado, true);
  assert.deepEqual([tres.suspensao.quantidadeJogos, tres.suspensao.quantidadeAtual, tres.suspensao.jogosCumpridos, tres.suspensao.jogosRestantes, tres.suspensao.situacao],
    [5, 3, 2, 1, "vigente"]);
  const [decisao] = tres.suspensao.reducoes;
  assert.deepEqual([decisao.quantidadeAnterior, decisao.novaQuantidade, decisao.justificativa, decisao.reduzidaPor?.id, decisao.herdadaDeReducaoId],
    [5, 3, "Recurso parcialmente deferido", presidente.id, null]);
  assert.ok(decisao.reduzidaEm);
  // Repetir o total já definido por redução devolve alterado: false sem nova decisão; aumentar é recusado.
  const repeticao = await reduzida(campeonato, daAna.id, 3);
  assert.deepEqual([repeticao.alterado, repeticao.suspensao.reducoes.length], [false, 1]);
  assert.equal((await reduzir(campeonato, daAna.id, 4)).status, 409);

  // Reduzida para 1: saldo zero, sem apagar cumprimentos nem compensar ausências.
  const um = (await reduzida(campeonato, daAna.id, 1, "Nova decisão")).suspensao;
  assert.deepEqual([um.quantidadeJogos, um.quantidadeAtual, um.jogosCumpridos, um.jogosRestantes, um.situacao, um.cumprimentos.map(c => c.jogoId).sort()],
    [5, 1, 2, 0, "cumprida", [...jogos].sort()]);
  assert.deepEqual(um.reducoes.map(r => [r.quantidadeAnterior, r.novaQuantidade]), [[5, 3], [3, 1]]);
  // Cumprida não é reduzida nem revogada; o próximo jogo não registra cumprimento e Ana volta a ser credenciada.
  assert.equal((await reduzir(campeonato, daAna.id, 0)).status, 409);
  assert.equal((await revogar(campeonato, daAna.id)).status, 409);
  const proximo = await agendar(campeonato, a, b);
  await credenciar(proximo, ana.id, a, 9);
  assert.deepEqual(await finalizar(proximo), []);

  // Reduzida para 0 sem cumprimento: libera a suspensão, e o credenciamento volta a ser aceito pelo banco.
  const daBia = await suspender(campeonato, bia.id, 2);
  const semJogo = await agendar(campeonato, a, b);
  await assert.rejects(credenciar(semJogo, bia.id, b, 4));
  const zero = (await reduzida(campeonato, daBia.id, 0)).suspensao;
  assert.deepEqual([zero.quantidadeAtual, zero.jogosCumpridos, zero.jogosRestantes, zero.situacao], [0, 0, 0, "cumprida"]);
  await credenciar(semJogo, bia.id, b, 4);
});

test("redução: validações, permissões, estados recusados e proteção no banco", async () => {
  const { a, b, ana, bia, campeonato } = await cenario();
  const daAna = await suspender(campeonato, ana.id, 3);
  for (const corpo of [{}, { novaQuantidade: 1 }, { novaQuantidade: -1, justificativa: "x" }, { novaQuantidade: 1.5, justificativa: "x" },
    { novaQuantidade: "1", justificativa: "x" }, { novaQuantidade: 1, justificativa: " " }, { novaQuantidade: 1, justificativa: "x", outro: 1 }]) {
    assert.equal((await request("POST", `/campeonatos/${campeonato}/suspensoes/${daAna.id}/reduzir`, presidente.cookie, corpo)).status, 400, JSON.stringify(corpo));
  }
  const tecnico = await cadastrar("tecnico");
  assert.equal((await reduzir(campeonato, daAna.id, 1, "x", tecnico.cookie)).status, 403);
  assert.equal((await reduzir(campeonato, daAna.id, 1, "x", ana.cookie)).status, 403);
  assert.equal((await reduzir(campeonato, randomUUID(), 1)).status, 404);
  assert.equal((await reduzir(await campeonatoCom([a, b], false), daAna.id, 1)).status, 404);
  assert.equal((await reduzir(campeonato, daAna.id, 3)).status, 409);

  // Revogada não é reduzida, e a reduzida pode ser revogada depois, preservando a redução.
  const revogada = await suspender(campeonato, bia.id, 2);
  await reduzida(campeonato, revogada.id, 1);
  const final = (await (await revogar(campeonato, revogada.id)).json() as { suspensao: Suspensao }).suspensao;
  assert.deepEqual([final.situacao, final.quantidadeAtual, final.reducoes.length], ["revogada", 1, 1]);
  assert.equal((await reduzir(campeonato, revogada.id, 0)).status, 409);

  // Banco: total não muda sem decisão registrada, não aumenta e a decisão é imutável.
  await assert.rejects(prisma.suspensao.update({ where: { id: daAna.id }, data: { quantidadeReduzida: 1 } }));
  await assert.rejects(prisma.reducaoSuspensao.create({ data: { id: randomUUID(), suspensaoId: daAna.id, quantidadeAnterior: 3, novaQuantidade: 2, reduzidaEm: new Date() } }));
  await assert.rejects(prisma.reducaoSuspensao.create({ data: { id: randomUUID(), suspensaoId: daAna.id, quantidadeAnterior: 2, novaQuantidade: 1, justificativa: "x", reduzidaPorPresidenteId: presidente.id, reduzidaEm: new Date() } }));
  const [decisao] = (await reduzida(campeonato, daAna.id, 2)).suspensao.reducoes;
  await assert.rejects(prisma.suspensao.update({ where: { id: daAna.id }, data: { quantidadeReduzida: 3 } }));
  await assert.rejects(prisma.reducaoSuspensao.update({ where: { id: decisao.id }, data: { justificativa: "Alterada" } }));
  await assert.rejects(prisma.reducaoSuspensao.delete({ where: { id: decisao.id } }));

  // Saldo encerrado com o campeonato não é reduzido.
  assert.equal((await request("POST", `/campeonatos/${campeonato}/encerrar`, presidente.cookie)).status, 200);
  assert.equal((await reduzir(campeonato, daAna.id, 1)).status, 409);
});

test("banco recusa no commit a decisão de redução sem o total da suspensão atualizado", async () => {
  const { ana, campeonato } = await cenario();
  const daAna = await suspender(campeonato, ana.id, 3);
  await assert.rejects(prisma.$transaction(tx => tx.reducaoSuspensao.create({ data: {
    id: randomUUID(), suspensaoId: daAna.id, quantidadeAnterior: 3, novaQuantidade: 1, justificativa: "Decisão órfã",
    reduzidaPorPresidenteId: presidente.id, reduzidaEm: new Date(),
  } })), /total da suspensão atualizado/);
  const consultada = await (await request("GET", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie)).json() as Suspensao[];
  const semReducao = consultada.find(s => s.id === daAna.id)!;
  assert.deepEqual([semReducao.quantidadeAtual, semReducao.reducoes, semReducao.situacao], [3, [], "vigente"]);
  assert.equal(await prisma.reducaoSuspensao.count({ where: { suspensaoId: daAna.id } }), 0);
});

test("redução aguarda o cumprimento em andamento e o cumprimento aguarda a redução", async () => {
  const { a, b, ana, campeonato } = await cenario();
  // Cumprimento primeiro: a redução enxerga o jogo recém-cumprido e o saldo fica zero, sem negativo.
  const suspensao = await suspender(campeonato, ana.id, 3);
  assert.deepEqual(await finalizar(await agendar(campeonato, a, b)), [suspensao.id]);
  const jogo = await agendar(campeonato, b, a);
  let liberar!: () => void;
  let informarPid!: (pid: number) => void;
  const liberacao = new Promise<void>(resolve => { liberar = resolve; });
  const registrado = new Promise<number>(resolve => { informarPid = resolve; });
  const encerramento = prisma.$transaction(async tx => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.jogo.update({ where: { id: jogo }, data: { status: "finalizado", iniciadoEm: new Date(), encerradoEm: new Date(), resultado: "normal" } });
    assert.deepEqual(await registrarCumprimentos(tx, jogo), [suspensao.id]);
    informarPid(pid);
    await liberacao;
  }, { timeout: 10_000 });
  const pid = await Promise.race([registrado, encerramento.then(() => { throw new Error("Encerramento sem barreira"); })]);
  const resposta = reduzir(campeonato, suspensao.id, 1);
  try {
    await aguardarBloqueio(pid, "Redução deve aguardar o cumprimento em andamento");
  } finally {
    liberar();
    await encerramento;
  }
  const depois = await (await resposta).json() as { suspensao: Suspensao };
  assert.deepEqual([depois.suspensao.quantidadeAtual, depois.suspensao.jogosCumpridos, depois.suspensao.jogosRestantes, depois.suspensao.situacao], [1, 2, 0, "cumprida"]);

  // Redução primeiro: o cumprimento concorrente aguarda e não ultrapassa o novo total.
  const outra = await suspender(campeonato, ana.id, 3);
  assert.deepEqual(await finalizar(await agendar(campeonato, a, b)), [outra.id]);
  const seguinte = await agendar(campeonato, a, b);
  await prisma.jogo.update({ where: { id: seguinte }, data: { status: "finalizado", iniciadoEm: new Date(), encerradoEm: new Date(), resultado: "normal" } });
  let liberarReducao!: () => void;
  let informarReducao!: (pid: number) => void;
  const fim = new Promise<void>(resolve => { liberarReducao = resolve; });
  const reduzidaPid = new Promise<number>(resolve => { informarReducao = resolve; });
  const reducao = prisma.$transaction(async tx => {
    const [{ pid: atual }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await reduzirSuspensao(tx, campeonato, outra.id, presidente.id, { novaQuantidade: 1, justificativa: "Decisão concorrente" });
    informarReducao(atual);
    await fim;
  }, { timeout: 10_000 });
  const pidReducao = await Promise.race([reduzidaPid, reducao.then(() => { throw new Error("Redução sem barreira"); })]);
  const cumprimento = cumprir(seguinte);
  try {
    await aguardarBloqueio(pidReducao, "Cumprimento deve aguardar a redução em andamento");
  } finally {
    liberarReducao();
    await reducao;
  }
  assert.deepEqual(await cumprimento, []);
  const final = await consultar(campeonato, outra.id);
  assert.deepEqual([final.quantidadeAtual, final.jogosCumpridos, final.situacao], [1, 1, "cumprida"]);
});
