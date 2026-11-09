import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { Client } from "pg";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { reconciliarSuspensoesAutomaticas } from "../dist/modules/suspensoes/suspensoes.js";
import { revalidarArbitragem } from "../dist/modules/arbitragem/acesso.js";
import { credenciar } from "../dist/modules/participacoes/credenciamento.js";
import { encerrarJogo } from "../dist/modules/jogos/ciclo.js";
import { corrigirPeloPresidente } from "../dist/modules/resultados/lancamentos.js";
import { transicionarCampeonato } from "../dist/modules/campeonatos/campeonatos.js";

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
    await tx.authUser.create({ data: { id: authId, name: "Presidente das automáticas", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente das automáticas", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
let presidente: Awaited<ReturnType<typeof criarPresidente>>;

async function cadastrarAtleta(clubeId: string, nome: string) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil: "atleta", clubeId });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  assert.equal((await request("POST", `/verificacoes/${id}/aprovacao`, presidente.cookie, {})).status, 200);
  return id;
}
async function criarClube(nome: string) {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
const dataLocal = (fuso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function ok<T>(response: Promise<Response>, status = 200): Promise<T> {
  const resolvida = await response;
  assert.equal(resolvida.status, status, await resolvida.clone().text());
  return resolvida.json();
}
async function recusa(response: Promise<Response>, status: number, mensagem?: RegExp) {
  const resolvida = await response;
  const texto = await resolvida.text();
  assert.equal(resolvida.status, status, texto);
  if (mensagem) assert.match(JSON.parse(texto).message, mensagem);
}

type Pessoa = { id: string; nomeCompleto: string };
type Suspensao = {
  id: string; campeonatoId: string; origem: "manual" | "automatica"; regra: string | null; jogoOrigemId: string | null; atleta: Pessoa; quantidadeJogos: number;
  motivo: string; aplicadaPor: Pessoa | null; aplicadaEm: string; revogadaEm: string | null; saldoEncerradoEm: string | null; anuladaEm: string | null;
  situacao: string; jogosCumpridos: number; jogosRestantes: number; cumprimentos: { jogoId: string }[]; quantidadeAtual: number; reducoes: Reducao[];
};
type Reducao = { id: string; quantidadeAnterior: number; novaQuantidade: number; justificativa: string | null; reduzidaPor: Pessoa | null; herdadaDeReducaoId: string | null };
type Lancamento = { id: string; tipo: string; relatorioDisciplinar: boolean | null; anuladoEm: string | null };
type Correcao = { lancamento: Lancamento; alterado: boolean; suspensoesAutomaticas: { criadas: string[]; anuladas: string[] } };

/** Campeonato em andamento com os clubes A (Ana, Carla) e B (Bruno). */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const [ana, carla, bruno] = [await cadastrarAtleta(a, "Ana"), await cadastrarAtleta(a, "Carla"), await cadastrarAtleta(b, "Bruno")];
  const criado = await ok<{ id: string }>(request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato das automáticas", edicao: "2026", categoria: "Adulto" }), 201);
  const campeonato = criado.id;
  campeonatos.push(campeonato);
  for (const clubeId of [a, b]) assert.equal((await request("POST", `/campeonatos/${campeonato}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  assert.equal((await request("POST", `/campeonatos/${campeonato}/iniciar`, presidente.cookie)).status, 200);

  /** Jogo de hoje com arbitragem por senha; `credenciar` devolve a participação. */
  async function jogo() {
    const agendado = await ok<{ id: string }>(request("POST", `/campeonatos/${campeonato}/jogos`, presidente.cookie, {
      clubeAId: a, clubeBId: b, inicioPrevisto: `${dataLocal("America/Recife")}T12:00`, fusoHorario: "America/Recife",
    }), 201);
    const id = agendado.id;
    const senha = (await ok<{ senha: string }>(request("GET", `/jogos/${id}/arbitragem/senha`, presidente.cookie))).senha;
    throttler.onApplicationShutdown();
    const entrada = await request("POST", `/arbitragem/jogos/${id}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
    assert.equal(entrada.status, 201, await entrada.clone().text());
    const arbitro = entrada.headers.getSetCookie().find(c => c.startsWith(`handebol.arbitragem.${id}=`))!.split(";")[0];
    let camisa = 1;
    return {
      id,
      token: decodeURIComponent(arbitro.split("=")[1]),
      credenciamento: (atletaId: string) => request("POST", `/arbitragem/jogos/${id}/credenciamentos`, arbitro, { atletaId, numeroCamisa: camisa++ }),
      async credenciar(atletaId: string) {
        return (await ok<{ participacao: { participacaoId: string } }>(this.credenciamento(atletaId))).participacao.participacaoId;
      },
      iniciar: () => ok(request("POST", `/arbitragem/jogos/${id}/inicio`, arbitro)),
      lancamento: (participacaoId: string, tipo: string, extra: object = {}) =>
        request("POST", `/arbitragem/jogos/${id}/lancamentos`, arbitro, { operacaoId: randomUUID(), tipo, participacaoId, ...extra }),
      async lancar(participacaoId: string, tipo: string, extra: object = {}) {
        return (await ok<{ lancamento: Lancamento }>(this.lancamento(participacaoId, tipo, extra))).lancamento;
      },
      encerrar: () => ok<{ alterado: boolean }>(request("POST", `/arbitragem/jogos/${id}/encerramento`, arbitro, { resultado: "normal", vencedorInscricaoId: null })),
    };
  }
  /** Jogo realizado e encerrado sem ocorrências, com os atletas informados credenciados. */
  async function jogoSemOcorrencias(...atletas: string[]) {
    const j = await jogo();
    for (const atleta of atletas) await j.credenciar(atleta);
    await j.iniciar();
    await j.encerrar();
    return j.id;
  }
  const listar = () => ok<Suspensao[]>(request("GET", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie));
  return { a, b, ana, carla, bruno, campeonato, jogo, jogoSemOcorrencias, listar };
}

const corrigir = (jogoId: string, lancamentoId: string, body: object) =>
  ok<Correcao>(request("POST", `/jogos/${jogoId}/lancamentos/${lancamentoId}/correcao`, presidente.cookie, body));
const anular = (jogoId: string, lancamentoId: string) =>
  ok<Correcao>(request("POST", `/jogos/${jogoId}/lancamentos/${lancamentoId}/anulacao`, presidente.cookie, { operacaoId: randomUUID() }));

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Jogos levam lançamentos, participações, cumprimentos e suspensões automáticas; campeonatos, as manuais.
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

test("amarelos em três jogos, três exclusões e vermelho sem relatório não geram suspensão", async () => {
  const { ana, bruno, jogo, listar } = await cenario();
  for (let i = 0; i < 3; i++) {
    const j = await jogo();
    const [pAna, pBruno] = [await j.credenciar(ana), await j.credenciar(bruno)];
    await j.iniciar();
    await j.lancar(pAna, "temp_cartaoAmarelo");
    if (i === 2) {
      for (let e = 0; e < 3; e++) await j.lancar(pBruno, "temp_exclusaoDoisMinutos");
      // Vermelho sem o campo: desqualificação sem relatório (não se infere o azul).
      assert.equal((await j.lancar(pBruno, "temp_cartaoVermelho")).relatorioDisciplinar, false);
      assert.equal((await j.lancar(pAna, "temp_cartaoVermelho", { relatorioDisciplinar: false })).relatorioDisciplinar, false);
      assert.equal((await j.lancar(pAna, "temp_gol")).relatorioDisciplinar, null);
      // Relatório só existe no vermelho.
      await recusa(j.lancamento(pAna, "temp_gol", { relatorioDisciplinar: true }), 400);
      await recusa(j.lancamento(pBruno, "temp_exclusaoDoisMinutos", { relatorioDisciplinar: false }), 400);
      await recusa(j.lancamento(pBruno, "temp_cartaoVermelho", { relatorioDisciplinar: "sim" }), 400);
    }
    await j.encerrar();
  }
  assert.deepEqual(await listar(), []);
  // A partida seguinte não é impedida.
  const proximo = await jogo();
  await proximo.credenciar(ana);
  await proximo.credenciar(bruno);
});

test("vermelho com relatório gera uma suspensão de um jogo; o jogo de origem não cumpre e a repetição não duplica", async () => {
  const { ana, carla, bruno, campeonato, jogo, jogoSemOcorrencias, listar } = await cenario();
  const origem = await jogo();
  const [pAna, pBruno] = [await origem.credenciar(ana), await origem.credenciar(bruno)];
  await origem.iniciar();
  // Terceira exclusão seguida de vermelho e azul: a mesma desqualificação, registrada duas vezes por engano.
  for (let e = 0; e < 3; e++) await origem.lancar(pAna, "temp_exclusaoDoisMinutos");
  assert.equal((await origem.lancar(pAna, "temp_cartaoVermelho", { relatorioDisciplinar: true })).relatorioDisciplinar, true);
  await origem.lancar(pAna, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  await origem.lancar(pBruno, "temp_cartaoVermelho");
  assert.deepEqual(await listar(), [], "nada é gerado antes do encerramento");
  await origem.encerrar();
  assert.equal((await origem.encerrar()).alterado, false);

  const [suspensao, ...demais] = await listar();
  assert.deepEqual(demais, []);
  assert.deepEqual(
    [suspensao.origem, suspensao.regra, suspensao.jogoOrigemId, suspensao.atleta.id, suspensao.quantidadeJogos, suspensao.aplicadaPor, suspensao.anuladaEm],
    ["automatica", "desqualificacao_com_relatorio", origem.id, ana, 1, null, null]);
  assert.deepEqual([suspensao.situacao, suspensao.jogosCumpridos, suspensao.jogosRestantes], ["vigente", 0, 1]);
  assert.match(suspensao.motivo, /relatório disciplinar/);

  // Reconciliações repetidas e concorrentes não duplicam.
  const paralelas = await Promise.all([1, 2, 3].map(() => prisma.$transaction(tx => reconciliarSuspensoesAutomaticas(tx, origem.id))));
  assert.deepEqual(paralelas, [1, 2, 3].map(() => ({ criadas: [], anuladas: [] })));
  assert.equal((await listar()).length, 1);

  // Próximo jogo: Ana impedida; o jogo cumpre a suspensão mesmo sem ela.
  const segundo = await jogo();
  await recusa(segundo.credenciamento(ana), 409, /suspensão a cumprir/);
  await segundo.credenciar(carla);
  await segundo.iniciar();
  await segundo.encerrar();
  const cumprida = (await listar())[0];
  assert.deepEqual([cumprida.situacao, cumprida.cumprimentos.map(c => c.jogoId)], ["cumprida", [segundo.id]]);
  // Sem acumulação nem progressão: ela volta a jogar normalmente.
  await jogoSemOcorrencias(ana);
  assert.deepEqual((await listar()).map(s => [s.id, s.situacao, s.campeonatoId ?? campeonato]), [[suspensao.id, "cumprida", campeonato]]);
});

test("correção do presidente recalcula: libera só o saldo restante, gera nova a partir dela e preserva jogos passados", async () => {
  const { ana, carla, bruno, campeonato, jogo, jogoSemOcorrencias, listar } = await cenario();
  const origem = await jogo();
  const [pAna, pCarla] = [await origem.credenciar(ana), await origem.credenciar(carla)];
  await origem.credenciar(bruno);
  await origem.iniciar();
  const vermelho = await origem.lancar(pAna, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  await origem.encerrar();
  const [primeira] = await listar();

  // Sem relatório: anula a automática, sem apagar o histórico.
  const operacaoId = randomUUID();
  const semRelatorio = await corrigir(origem.id, vermelho.id, { operacaoId, tipo: "temp_cartaoVermelho", participacaoId: pAna, relatorioDisciplinar: false });
  assert.deepEqual([semRelatorio.alterado, semRelatorio.lancamento.relatorioDisciplinar, semRelatorio.suspensoesAutomaticas], [true, false, { criadas: [], anuladas: [primeira.id] }]);
  const reenvio = await corrigir(origem.id, vermelho.id, { operacaoId, tipo: "temp_cartaoVermelho", participacaoId: pAna, relatorioDisciplinar: false });
  assert.deepEqual([reenvio.alterado, reenvio.suspensoesAutomaticas], [false, { criadas: [], anuladas: [] }]);
  const anulada = (await listar()).find(s => s.id === primeira.id)!;
  assert.deepEqual([anulada.situacao, anulada.jogosCumpridos, anulada.jogosRestantes, anulada.revogadaEm], ["anulada", 0, 0, null]);
  assert.ok(anulada.anuladaEm);
  await recusa(request("POST", `/campeonatos/${campeonato}/suspensoes/${primeira.id}/revogar`, presidente.cookie, { justificativa: "Recurso deferido" }), 409, /anulada/);

  // Ana volta a ser credenciada no jogo seguinte, antes da nova correção.
  const segundo = await jogo();
  await segundo.credenciar(ana);

  // O relatório volta, agora atribuído à Carla: Carla recebe nova suspensão; Ana segue sem.
  const paraCarla = await corrigir(origem.id, semRelatorio.lancamento.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pCarla, relatorioDisciplinar: true });
  assert.equal(paraCarla.suspensoesAutomaticas.criadas.length, 1);
  // E volta também para Ana (vermelho próprio, com relatório): nova suspensão a partir de agora.
  const outroVermelho = await corrigir(origem.id, paraCarla.lancamento.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pAna, relatorioDisciplinar: true });
  assert.deepEqual(outroVermelho.suspensoesAutomaticas.anuladas, paraCarla.suspensoesAutomaticas.criadas);
  const [nova] = outroVermelho.suspensoesAutomaticas.criadas;
  assert.ok(nova && nova !== primeira.id);

  // O segundo jogo, em que Ana já estava credenciada, é preservado e não cumpre a nova; o terceiro cumpre.
  await segundo.iniciar();
  await segundo.encerrar();
  assert.deepEqual([(await listar()).find(s => s.id === nova)!.situacao, (await listar()).find(s => s.id === nova)!.jogosCumpridos], ["vigente", 0]);
  const terceiro = await jogoSemOcorrencias(bruno);
  const cumprida = (await listar()).find(s => s.id === nova)!;
  assert.deepEqual([cumprida.situacao, cumprida.cumprimentos.map(c => c.jogoId)], ["cumprida", [terceiro]]);

  // Anular a ocorrência depois do cumprimento: registra a anulação, mantém o jogo cumprido e não compensa nada.
  const anulacao = await anular(origem.id, outroVermelho.lancamento.id);
  assert.deepEqual(anulacao.suspensoesAutomaticas, { criadas: [], anuladas: [nova] });
  const depois = (await listar()).find(s => s.id === nova)!;
  assert.deepEqual([depois.situacao, depois.jogosCumpridos, depois.cumprimentos.map(c => c.jogoId)], ["anulada", 1, [terceiro]]);
  assert.deepEqual((await listar()).map(s => s.situacao).sort(), ["anulada", "anulada", "anulada"]);
});

test("paralelismo com a manual, revogação e término do saldo com o campeonato", async () => {
  const { ana, bruno, campeonato, jogo, jogoSemOcorrencias, listar } = await cenario();
  const manual = await ok<Suspensao>(request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, { atletaId: ana, quantidadeJogos: 3, motivo: "Conduta" }), 201);
  const origem = await jogo();
  const pBruno = await origem.credenciar(bruno);
  await origem.iniciar();
  const vermelho = await origem.lancar(pBruno, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  await origem.encerrar();
  const automatica = (await listar()).find(s => s.origem === "automatica")!;
  assert.deepEqual(automatica.atleta.id, bruno);
  assert.deepEqual((await listar()).find(s => s.id === manual.id)!.jogosCumpridos, 1, "o jogo de origem cumpre a manual de outro atleta");

  // Revogada pelo presidente: a correção posterior não a altera nem gera outra.
  assert.equal((await request("POST", `/campeonatos/${campeonato}/suspensoes/${automatica.id}/revogar`, presidente.cookie, { justificativa: "Recurso deferido" })).status, 200);
  const semRelatorio = await corrigir(origem.id, vermelho.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pBruno, relatorioDisciplinar: false });
  assert.deepEqual(semRelatorio.suspensoesAutomaticas, { criadas: [], anuladas: [] });
  const comRelatorio = await corrigir(origem.id, semRelatorio.lancamento.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pBruno, relatorioDisciplinar: true });
  assert.deepEqual(comRelatorio.suspensoesAutomaticas, { criadas: [], anuladas: [] });
  assert.equal((await listar()).find(s => s.id === automatica.id)!.situacao, "revogada");

  // Nova automática do Bruno em outro jogo, em paralelo com a manual da Ana: cada jogo conta uma vez para cada uma.
  const segundo = await jogo();
  const pBrunoSegundo = await segundo.credenciar(bruno);
  await segundo.iniciar();
  await segundo.lancar(pBrunoSegundo, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  await segundo.encerrar();
  const terceiro = await jogoSemOcorrencias();
  const finais = await listar();
  const novaDoBruno = finais.find(s => s.jogoOrigemId === segundo.id)!;
  assert.deepEqual([novaDoBruno.situacao, novaDoBruno.cumprimentos.map(c => c.jogoId)], ["cumprida", [terceiro]]);
  const daAna = finais.find(s => s.id === manual.id)!;
  assert.deepEqual([daAna.situacao, daAna.cumprimentos.map(c => c.jogoId).sort()], ["cumprida", [origem.id, segundo.id, terceiro].sort()]);

  // Saldo encerrado com o campeonato; correção posterior não anula nem gera.
  const quarto = await jogo();
  const pBrunoQuarto = await quarto.credenciar(bruno);
  await quarto.iniciar();
  const ultimo = await quarto.lancar(pBrunoQuarto, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  await quarto.encerrar();
  assert.equal((await request("POST", `/campeonatos/${campeonato}/encerrar`, presidente.cookie)).status, 200);
  const encerrada = (await listar()).find(s => s.jogoOrigemId === quarto.id)!;
  assert.deepEqual([encerrada.situacao, encerrada.jogosCumpridos], ["saldo_encerrado", 0]);
  const tardia = await corrigir(quarto.id, ultimo.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pBrunoQuarto, relatorioDisciplinar: false });
  assert.deepEqual(tardia.suspensoesAutomaticas, { criadas: [], anuladas: [] });
  const restaurada = await corrigir(quarto.id, tardia.lancamento.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pBrunoQuarto, relatorioDisciplinar: true });
  assert.deepEqual(restaurada.suspensoesAutomaticas, { criadas: [], anuladas: [] });
  assert.equal((await listar()).filter(s => s.jogoOrigemId === quarto.id).length, 1);
});

test("restrições do banco: relatório só no vermelho e imutável, origem consistente, sem duplicar e sem cumprir na origem", async () => {
  const { ana, bruno, jogo, listar } = await cenario();
  const origem = await jogo();
  const pAna = await origem.credenciar(ana);
  await origem.credenciar(bruno);
  await origem.iniciar();
  const vermelho = await origem.lancar(pAna, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  const rejeita = (promessa: Promise<unknown>) => assert.rejects(promessa);
  await rejeita(prisma.$executeRaw`
    INSERT INTO "LancamentoJogo" (id, "operacaoId", "jogoId", "participacaoId", tipo, "relatorioDisciplinar", valor, "registradoEm")
    VALUES (gen_random_uuid(), gen_random_uuid(), ${origem.id}::uuid, ${pAna}::uuid, 'temp_gol', true, 1, now())`);
  await rejeita(prisma.$executeRaw`
    INSERT INTO "LancamentoJogo" (id, "operacaoId", "jogoId", "participacaoId", tipo, valor, "registradoEm")
    VALUES (gen_random_uuid(), gen_random_uuid(), ${origem.id}::uuid, ${pAna}::uuid, 'temp_cartaoVermelho', 1, now())`);
  await rejeita(prisma.$executeRaw`UPDATE "LancamentoJogo" SET "relatorioDisciplinar" = false WHERE id = ${vermelho.id}::uuid`);
  await rejeita(prisma.$executeRaw`
    UPDATE "LancamentoJogo" SET "relatorioDisciplinar" = false, "anuladoEm" = now(), "anulacaoOperacaoId" = gen_random_uuid() WHERE id = ${vermelho.id}::uuid`);
  await origem.encerrar();

  const [automatica] = await listar();
  const campeonatoId = (await prisma.jogo.findUniqueOrThrow({ where: { id: origem.id } })).campeonatoId;
  await rejeita(prisma.$executeRaw`
    INSERT INTO "Suspensao" (id, "atletaId", "campeonatoId", origem, "jogoOrigemId", regra, "quantidadeJogos", motivo, "aplicadaEm")
    VALUES (gen_random_uuid(), ${ana}::uuid, ${campeonatoId}::uuid, 'automatica', ${origem.id}::uuid, 'desqualificacao_com_relatorio', 1, 'Duplicada', now())`);
  await rejeita(prisma.$executeRaw`
    INSERT INTO "Suspensao" (id, "atletaId", "campeonatoId", origem, "quantidadeJogos", motivo, "aplicadaEm")
    VALUES (gen_random_uuid(), ${bruno}::uuid, ${campeonatoId}::uuid, 'automatica', 1, 'Sem jogo de origem', now())`);
  await rejeita(prisma.$executeRaw`
    INSERT INTO "Suspensao" (id, "atletaId", "campeonatoId", origem, "jogoOrigemId", regra, "quantidadeJogos", motivo, "aplicadaPorPresidenteId", "aplicadaEm")
    VALUES (gen_random_uuid(), ${bruno}::uuid, ${campeonatoId}::uuid, 'manual', ${origem.id}::uuid, 'desqualificacao_com_relatorio', 1, 'Manual com origem', ${presidente.id}::uuid, now())`);
  await rejeita(prisma.$executeRaw`
    INSERT INTO "CumprimentoSuspensao" ("suspensaoId", "jogoId", "registradoEm") VALUES (${automatica.id}::uuid, ${origem.id}::uuid, now())`);
  await rejeita(prisma.$executeRaw`UPDATE "Suspensao" SET "jogoOrigemId" = NULL, regra = NULL, origem = 'manual' WHERE id = ${automatica.id}::uuid`);
  await rejeita(prisma.$executeRaw`UPDATE "Suspensao" SET "anuladaEm" = now(), "revogadaEm" = now(), "revogadaPorPresidenteId" = ${presidente.id}::uuid WHERE id = ${automatica.id}::uuid`);
  await prisma.$executeRaw`UPDATE "Suspensao" SET "anuladaEm" = now() WHERE id = ${automatica.id}::uuid`;
  await rejeita(prisma.$executeRaw`UPDATE "Suspensao" SET "anuladaEm" = NULL WHERE id = ${automatica.id}::uuid`);
  assert.equal((await listar())[0].situacao, "anulada");
});


/** A terceira transação retém uma suspensão até as duas operações concorrentes chegarem a um bloqueio real. */
async function concorrerComSuspensaoBloqueada(suspensaoId: string, operacoes: ((tx: Parameters<typeof encerrarJogo>[0]) => Promise<unknown>)[]) {
  const resultados: Promise<unknown>[] = [];
  await prisma.$transaction(async bloqueio => {
    await bloqueio.$queryRaw`SELECT id FROM "Suspensao" WHERE id = ${suspensaoId}::uuid FOR UPDATE`;
    for (const operacao of operacoes) {
      let conectou!: (pid: number) => void;
      const conectado = new Promise<number>(resolve => { conectou = resolve; });
      let terminou = false;
      resultados.push(prisma.$transaction(async tx => {
        const [conexao] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        conectou(conexao.pid);
        return operacao(tx);
      }, { timeout: 15_000 }).then(valor => ({ valor }), erro => ({ erro })).finally(() => { terminou = true; }));
      const pid = await conectado;
      const limite = Date.now() + 5_000;
      while (true) {
        const [estado] = await prisma.$queryRaw<{ aguardando: boolean }[]>`
          SELECT wait_event_type = 'Lock' AS aguardando FROM pg_stat_activity WHERE pid = ${pid}`;
        if (estado?.aguardando) break;
        assert.equal(terminou, false, "a operação deve aguardar a suspensão ou a outra transação");
        assert.ok(Date.now() < limite, "a operação não chegou ao bloqueio esperado");
        await setTimeout(10);
      }
    }
  }, { timeout: 15_000 });
  const respostas = await Promise.all(resultados) as ({ valor?: unknown; erro?: unknown })[];
  for (const resposta of respostas) assert.equal(resposta.erro, undefined, String(resposta.erro));
}

test("encerramentos de jogos distintos com vermelho e atletas dos mesmos clubes não entram em deadlock", async () => {
  const { ana, carla, campeonato, jogo, listar } = await cenario();
  const jogos = [await jogo(), await jogo()];
  for (const j of jogos) {
    const participacaoId = await j.credenciar(ana);
    await j.iniciar();
    await j.lancar(participacaoId, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  }
  const manual = await ok<Suspensao>(request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, {
    atletaId: carla, quantidadeJogos: 3, motivo: "Suspensão para sincronizar os encerramentos",
  }), 201);
  await concorrerComSuspensaoBloqueada(manual.id, jogos.map(j => tx => encerrarJogo(tx, j.id, j.token, {
    resultado: "normal", vencedorInscricaoId: null,
  })));
  assert.equal(await prisma.jogo.count({ where: { id: { in: jogos.map(j => j.id) }, status: "finalizado" } }), 2);
  const suspensoes = await listar();
  assert.equal(suspensoes.filter(s => s.origem === "automatica" && s.atleta.id === ana).length, 2);
  assert.equal(suspensoes.find(s => s.id === manual.id)!.jogosCumpridos, 2);
});

test("correção que transfere o relatório e encerramento do campeonato respeitam a mesma ordem de bloqueios", async () => {
  const { ana, bruno, campeonato, jogo, listar } = await cenario();
  const origem = await jogo();
  const pAna = await origem.credenciar(ana);
  const pBruno = await origem.credenciar(bruno);
  await origem.iniciar();
  const vermelho = await origem.lancar(pAna, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  await origem.encerrar();
  const [automatica] = await listar();
  await concorrerComSuspensaoBloqueada(automatica.id, [
    tx => corrigirPeloPresidente(tx, origem.id, vermelho.id, {
      operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pBruno, relatorioDisciplinar: true,
    }),
    tx => transicionarCampeonato(tx, campeonato, "encerrar"),
  ]);
  const finais = await listar();
  assert.equal(finais.find(s => s.id === automatica.id)!.situacao, "anulada");
  assert.equal(finais.find(s => s.atleta.id === bruno)!.situacao, "saldo_encerrado");
});

test("migração preserva vermelhos legados válidos e anulados e restaura a proteção de imutabilidade", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `mig_automatica_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}", public`);
    // Tabelas isoladas: sem alterar dados nem o histórico Prisma do banco compartilhado pelo runner.
    for (const tabela of ["Jogo", "Suspensao", "LancamentoJogo"]) {
      await client.query(`CREATE TABLE "${tabela}" (LIKE public."${tabela}" INCLUDING ALL)`);
    }
    await client.query(`ALTER TABLE "LancamentoJogo" DROP COLUMN "relatorioDisciplinar" CASCADE;
      ALTER TABLE "Suspensao" DROP COLUMN origem CASCADE, DROP COLUMN regra CASCADE,
        DROP COLUMN "jogoOrigemId" CASCADE, DROP COLUMN "anuladaEm" CASCADE`);
    const ids = [randomUUID(), randomUUID()];
    await client.query(`INSERT INTO "LancamentoJogo"
      (id, "operacaoId", "jogoId", "participacaoId", tipo, valor, "registradoEm", "anuladoEm", "anulacaoOperacaoId")
      VALUES ($1, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'temp_cartaoVermelho', 1, now(), NULL, NULL),
        ($2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'temp_cartaoVermelho', 1, now(), now(), gen_random_uuid())`, ids);
    const anteriores = (await client.query('SELECT * FROM "LancamentoJogo" ORDER BY id')).rows;
    const funcao = (await client.query("SELECT pg_get_functiondef('public.validar_lancamento()'::regprocedure) AS ddl")).rows[0].ddl as string;
    await client.query(funcao.replace('public.validar_lancamento()', `"${schema}".validar_lancamento()`));
    await client.query(`CREATE TRIGGER "LancamentoJogo_validar" BEFORE INSERT OR UPDATE OR DELETE ON "LancamentoJogo"
      FOR EACH ROW EXECUTE FUNCTION validar_lancamento()`);
    await client.query(await readFile(new URL("../prisma/migrations/20261109100000_suspensao_automatica/migration.sql", import.meta.url), "utf8"));
    const posteriores = (await client.query('SELECT * FROM "LancamentoJogo" ORDER BY id')).rows;
    assert.deepEqual(posteriores.map(({ relatorioDisciplinar, ...dados }) => {
      assert.equal(relatorioDisciplinar, false);
      return dados;
    }), anteriores);
    const trigger = (await client.query(`SELECT tgenabled FROM pg_trigger
      WHERE tgrelid = '"LancamentoJogo"'::regclass AND tgname = 'LancamentoJogo_validar'`)).rows[0];
    assert.equal(trigger.tgenabled, "O");
    for (const id of ids) {
      await assert.rejects(client.query('UPDATE "LancamentoJogo" SET valor = 2 WHERE id = $1', [id]), /só pode ser anulado/);
    }
  } finally {
    await client.query("ROLLBACK");
    await client.query(`SET search_path TO public; DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});


async function tokenDesignado(jogoId: string, usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { authId: true } });
  const { email } = await prisma.authUser.findUniqueOrThrow({ where: { id: usuario.authId }, select: { email: true } });
  assert.equal((await request("POST", `/jogos/${jogoId}/arbitragens`, presidente.cookie, { usuarioId })).status, 201);
  const entrada = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/designacao`, await login(email), {});
  assert.equal(entrada.status, 201, await entrada.clone().text());
  return decodeURIComponent(entrada.headers.getSetCookie().find(c => c.startsWith(`handebol.arbitragem.${jogoId}=`))!.split(";")[0].split("=")[1]);
}

test("árbitros designados que jogam pelos clubes do outro encerramento não disputam bloqueio exclusivo de conta", async () => {
  for (const comRelatorio of [false, true]) {
    const a = await cenario();
    const b = await cenario();
    const jogos = [await a.jogo(), await b.jogo()];
    const tokens = [await tokenDesignado(jogos[0].id, b.ana), await tokenDesignado(jogos[1].id, a.ana)];
    for (const [indice, j] of jogos.entries()) {
      const participacaoId = await j.credenciar(indice === 0 ? a.ana : b.ana);
      await j.iniciar();
      if (comRelatorio) await j.lancar(participacaoId, "temp_cartaoVermelho", { relatorioDisciplinar: true });
    }
    let chegaram = 0;
    let liberar!: () => void;
    const ambosAutorizados = new Promise<void>(resolve => { liberar = resolve; });
    const resultados = await Promise.allSettled(jogos.map((j, indice) => prisma.$transaction(async tx => {
      // Ambos mantêm a conta designada em SHARE antes de disputar atletas: reproduz a inversão anterior.
      await revalidarArbitragem(tx, j.id, tokens[indice]);
      if (++chegaram === 2) liberar();
      await ambosAutorizados;
      return encerrarJogo(tx, j.id, tokens[indice], { resultado: "normal", vencedorInscricaoId: null });
    }, { timeout: 15_000 })));
    for (const resultado of resultados) {
      assert.equal(resultado.status, "fulfilled", resultado.status === "rejected" ? String(resultado.reason) : "");
    }
    assert.equal(await prisma.jogo.count({ where: { id: { in: jogos.map(j => j.id) }, status: "finalizado" } }), 2);
    assert.equal((await a.listar()).length + (await b.listar()).length, comRelatorio ? 2 : 0);
  }
});

/** Mantém a primeira operação sem commit até a segunda confirmar espera no bloqueio consultivo, sem depender de pausas fixas. */
async function disputarGate(primeira: (tx: Parameters<typeof encerrarJogo>[0]) => Promise<unknown>, segunda: (tx: Parameters<typeof encerrarJogo>[0]) => Promise<unknown>) {
  let segundaOperacao!: Promise<{ valor?: unknown; erro?: unknown }>;
  await prisma.$transaction(async tx => {
    await primeira(tx);
    let conectou!: (pid: number) => void;
    const conectado = new Promise<number>(resolve => { conectou = resolve; });
    let terminou = false;
    segundaOperacao = prisma.$transaction(async concorrente => {
      const [conexao] = await concorrente.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      conectou(conexao.pid);
      return segunda(concorrente);
    }, { timeout: 15_000 }).then(valor => ({ valor }), erro => ({ erro })).finally(() => { terminou = true; });
    const pid = await conectado;
    const limite = Date.now() + 5_000;
    while (true) {
      const [estado] = await prisma.$queryRaw<{ aguardando: boolean }[]>`
        SELECT wait_event = 'advisory' AS aguardando FROM pg_stat_activity WHERE pid = ${pid}`;
      if (estado?.aguardando) break;
      assert.equal(terminou, false, "a segunda operação deve aguardar a geração/credenciamento concorrente");
      assert.ok(Date.now() < limite, "a segunda operação não aguardou o bloqueio consultivo");
      await setTimeout(10);
    }
  }, { timeout: 15_000 });
  return segundaOperacao;
}

test("geração automática e credenciamento concorrentes usam o bloqueio consultivo nos dois sentidos", async () => {
  for (const credenciarPrimeiro of [false, true]) {
    const { ana, jogo, listar } = await cenario();
    const origem = await jogo();
    const proximo = await jogo();
    const participacaoId = await origem.credenciar(ana);
    await origem.iniciar();
    await origem.lancar(participacaoId, "temp_cartaoVermelho", { relatorioDisciplinar: true });
    const gerar = (tx: Parameters<typeof encerrarJogo>[0]) => encerrarJogo(tx, origem.id, origem.token, { resultado: "normal", vencedorInscricaoId: null });
    const credenciamento = (tx: Parameters<typeof encerrarJogo>[0]) => credenciar(tx, proximo.id, proximo.token, { atletaId: ana, numeroCamisa: 7 });
    const resultado = await disputarGate(credenciarPrimeiro ? credenciamento : gerar, credenciarPrimeiro ? gerar : credenciamento);
    if (credenciarPrimeiro) {
      assert.equal(resultado.erro, undefined, String(resultado.erro));
      assert.equal(await prisma.participacao.count({ where: { jogoId: proximo.id, atletaId: ana, credenciadoEm: { not: null } } }), 1);
      await proximo.iniciar();
      await proximo.encerrar();
      assert.equal((await listar())[0].jogosCumpridos, 0, "o credenciamento anterior à geração é preservado e não cumpre");
    } else {
      assert.ok(resultado.erro instanceof Error);
      assert.match(resultado.erro.message, /suspensão a cumprir/);
      assert.equal(await prisma.participacao.count({ where: { jogoId: proximo.id, atletaId: ana, credenciadoEm: { not: null } } }), 0);
    }
  }
});

test("encerramento concorrente vê a automática aplicada antes de seu horário e registra o cumprimento", async () => {
  const { ana, jogo, listar } = await cenario();
  const origem = await jogo();
  const proximo = await jogo();
  const participacaoId = await origem.credenciar(ana);
  await origem.iniciar();
  await proximo.iniciar();
  await origem.lancar(participacaoId, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  const resultado = await disputarGate(
    tx => encerrarJogo(tx, origem.id, origem.token, { resultado: "normal", vencedorInscricaoId: null }),
    tx => encerrarJogo(tx, proximo.id, proximo.token, { resultado: "normal", vencedorInscricaoId: null }),
  );
  assert.equal(resultado.erro, undefined, String(resultado.erro));
  assert.deepEqual((await listar())[0].cumprimentos.map(c => c.jogoId), [proximo.id]);
});


test("INSERT direto de credenciamento aguarda a geração pelo trigger e recusa a suspensão confirmada", async () => {
  const { ana, jogo } = await cenario();
  const origem = await jogo();
  const proximo = await jogo();
  const participacaoId = await origem.credenciar(ana);
  await origem.iniciar();
  await origem.lancar(participacaoId, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  const vinculo = await prisma.vinculoClube.findFirstOrThrow({ where: { atletaId: ana, fim: null }, select: { id: true } });
  const carteirinha = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: ana }, select: { id: true } });
  const { inscricaoClubeAId } = await prisma.jogo.findUniqueOrThrow({ where: { id: proximo.id }, select: { inscricaoClubeAId: true } });
  const resultado = await disputarGate(
    tx => encerrarJogo(tx, origem.id, origem.token, { resultado: "normal", vencedorInscricaoId: null }),
    tx => tx.$executeRaw`
      INSERT INTO "Participacao" (id, "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", "numeroCamisa")
      VALUES (gen_random_uuid(), ${proximo.id}::uuid, ${inscricaoClubeAId}::uuid, ${vinculo.id}::uuid, ${ana}::uuid, ${carteirinha.id}::uuid, now(), 7)`,
  );
  assert.ok(resultado.erro instanceof Error);
  assert.match(resultado.erro.message, /23514/);
  assert.equal(await prisma.participacao.count({ where: { jogoId: proximo.id, atletaId: ana } }), 0);
});

test("redução da automática: recálculo não aumenta, anulação preserva a decisão e a recriada herda o menor total", async () => {
  const { ana, carla, bruno, campeonato, jogo, listar } = await cenario();
  const origem = await jogo();
  const [pAna, pCarla] = [await origem.credenciar(ana), await origem.credenciar(carla)];
  await origem.credenciar(bruno);
  await origem.iniciar();
  const vermelho = await origem.lancar(pAna, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  await origem.encerrar();
  const [automatica] = await listar();
  type Decisao = { suspensao: Suspensao; alterado: boolean };
  const reduzida = await ok<Decisao>(request("POST", `/campeonatos/${campeonato}/suspensoes/${automatica.id}/reduzir`, presidente.cookie,
    { novaQuantidade: 0, justificativa: "Relatório disciplinar reavaliado" }));
  assert.deepEqual([reduzida.alterado, reduzida.suspensao.quantidadeJogos, reduzida.suspensao.quantidadeAtual, reduzida.suspensao.situacao], [true, 1, 0, "cumprida"]);
  const [decisao] = reduzida.suspensao.reducoes;
  assert.deepEqual([decisao.reduzidaPor?.id, decisao.justificativa], [presidente.id, "Relatório disciplinar reavaliado"]);
  // Ana volta a ser credenciada no jogo seguinte.
  await (await jogo()).credenciar(ana);

  // Recálculo com a ocorrência mantida não altera o total reduzido.
  assert.deepEqual(await prisma.$transaction(tx => reconciliarSuspensoesAutomaticas(tx, origem.id)), { criadas: [], anuladas: [] });
  assert.equal((await listar()).find(s => s.id === automatica.id)!.quantidadeAtual, 0);

  // Retirar a ocorrência anula a automática, preservando a punição original e a decisão.
  const semRelatorio = await corrigir(origem.id, vermelho.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pAna, relatorioDisciplinar: false });
  assert.deepEqual(semRelatorio.suspensoesAutomaticas, { criadas: [], anuladas: [automatica.id] });
  const anulada = (await listar()).find(s => s.id === automatica.id)!;
  assert.deepEqual([anulada.situacao, anulada.quantidadeJogos, anulada.quantidadeAtual, anulada.reducoes.map(r => r.id)], ["anulada", 1, 0, [decisao.id]]);

  // Ocorrência atribuída à Carla: suspensão integral, pois a decisão era sobre a Ana.
  const paraCarla = await corrigir(origem.id, semRelatorio.lancamento.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pCarla, relatorioDisciplinar: true });
  const [daCarla] = paraCarla.suspensoesAutomaticas.criadas;
  const carlaSuspensa = (await listar()).find(s => s.id === daCarla)!;
  assert.deepEqual([carlaSuspensa.quantidadeAtual, carlaSuspensa.situacao, carlaSuspensa.reducoes], [1, "vigente", []]);

  // De volta à Ana: a nova automática herda o total reduzido, sem presidente nem justificativa próprios.
  const paraAna = await corrigir(origem.id, paraCarla.lancamento.id, { operacaoId: randomUUID(), tipo: "temp_cartaoVermelho", participacaoId: pAna, relatorioDisciplinar: true });
  assert.deepEqual(paraAna.suspensoesAutomaticas.anuladas, [daCarla]);
  const [nova] = paraAna.suspensoesAutomaticas.criadas;
  const herdeira = (await listar()).find(s => s.id === nova)!;
  assert.deepEqual([herdeira.quantidadeJogos, herdeira.quantidadeAtual, herdeira.situacao, herdeira.jogosRestantes], [1, 0, "cumprida", 0]);
  assert.deepEqual(herdeira.reducoes.map(r => [r.quantidadeAnterior, r.novaQuantidade, r.justificativa, r.reduzidaPor, r.herdadaDeReducaoId]),
    [[1, 0, null, null, decisao.id]]);
  await (await jogo()).credenciar(ana);

  // A herança exige automática anterior anulada do mesmo atleta/jogo/regra também no banco.
  await assert.rejects(prisma.reducaoSuspensao.create({ data: {
    id: randomUUID(), suspensaoId: daCarla, quantidadeAnterior: 1, novaQuantidade: 0, herdadaDeReducaoId: decisao.id, reduzidaEm: new Date(),
  } }));
});
