import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { anularPelaArbitragem, corrigirPelaArbitragem } from "../dist/modules/resultados/lancamentos.js";

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
    await tx.authUser.create({ data: { id: authId, name: "Presidente das correções", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente das correções", perfil: "presidente", presidente: { create: {} } } });
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
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato das correções", edicao: "2026", categoria: "Adulto" });
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
async function suspender(campeonato: string, atletaId: string, quantidadeJogos: number) {
  const response = await request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, { atletaId, quantidadeJogos, motivo: "Conduta antidesportiva" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}

type Pessoa = { id: string; nomeCompleto: string };
type Lancamento = {
  id: string; operacaoId: string; tipo: string; valor: number; registradoEm: string; participacaoId: string; inscricaoId: string; atleta: Pessoa; numeroCamisa: number;
  substituiLancamentoId: string | null; anuladoEm: string | null; substituidoPorId: string | null;
};
type Placar = { temp_placarClubeA: number; temp_placarClubeB: number };
type Registro = { lancamento: Lancamento; alterado: boolean; placar: Placar };
type Correcao = Registro & { anulado: Lancamento };
type Conflito = { message: string; lancamento: Lancamento; substituto: Lancamento | null };
type Desempenho = { atleta: Pessoa; temp_gols: number; temp_cartoesAmarelos: number; temp_exclusoesDoisMinutos: number; temp_cartoesVermelhos: number };
type Registros = { jogo: { id: string; status: string }; placar: Placar | null; desempenho: Desempenho[]; lancamentos: Lancamento[] };

async function ok<T = Registro>(response: Promise<Response>): Promise<T> {
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
const PRESIDENCIA = "/jogos";
const credenciar = async (jogo: string, cookie: string, atletaId: string, numeroCamisa: number) =>
  (await ok<{ participacao: { participacaoId: string } }>(request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, cookie, { atletaId, numeroCamisa }))).participacao.participacaoId;
const iniciar = (jogo: string, cookie: string) => ok(request("POST", `/arbitragem/jogos/${jogo}/inicio`, cookie));
const encerrar = (jogo: string, cookie: string) => ok(request("POST", `/arbitragem/jogos/${jogo}/encerramento`, cookie));
const lancamento = (participacaoId: string, tipo = "temp_gol", operacaoId: string = randomUUID()) => ({ operacaoId, tipo, participacaoId });
const lancar = async (jogo: string, cookie: string, participacaoId: string, tipo = "temp_gol") =>
  (await ok(request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, cookie, lancamento(participacaoId, tipo)))).lancamento;
const corrigir = (jogo: string, cookie: string, id: string, body: unknown, rota = ARBITRAGEM) => request("POST", `${rota}/${jogo}/lancamentos/${id}/correcao`, cookie, body);
const anular = (jogo: string, cookie: string, id: string, operacaoId: string = randomUUID(), rota = ARBITRAGEM) => request("POST", `${rota}/${jogo}/lancamentos/${id}/anulacao`, cookie, { operacaoId });
const registros = (jogo: string, cookie: string, rota = ARBITRAGEM) => ok<Registros>(request("GET", `${rota}/${jogo}/lancamentos`, cookie));
const resumo = (r: Pick<Registros, "placar" | "desempenho">) => ({
  placar: r.placar && [r.placar.temp_placarClubeA, r.placar.temp_placarClubeB],
  desempenho: Object.fromEntries(r.desempenho.map(d => [d.atleta.nomeCompleto, [d.temp_gols, d.temp_cartoesAmarelos, d.temp_exclusoesDoisMinutos, d.temp_cartoesVermelhos]])),
});
const placarDe = (r: { placar: Placar | null }) => [r.placar?.temp_placarClubeA, r.placar?.temp_placarClubeB];

/** Dois clubes inscritos, Ana (A) e Bruno (B) credenciados, Carla (A) sem credenciamento, arbitragem por senha. */
async function cenario({ iniciado = true } = {}) {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo);
  const [ana, bruno, carla] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: b, nome: "Bruno" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" })];
  const pAna = await credenciar(jogo, arbitro, ana.id, 7);
  const pBruno = await credenciar(jogo, arbitro, bruno.id, 9);
  if (iniciado) await iniciar(jogo, arbitro);
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

test("arbitragem corrige atleta e tipo, encadeia correções e anula durante o jogo, preservando o histórico", async () => {
  const { jogo, arbitro, pAna, pBruno } = await cenario();
  const golAna = await lancar(jogo, arbitro, pAna);
  const amareloBruno = await lancar(jogo, arbitro, pBruno, "temp_cartaoAmarelo");
  const golBruno = await lancar(jogo, arbitro, pBruno);

  // O gol era do Bruno: anula o original e cria o substituto na mesma operação.
  const c1 = await ok<Correcao>(corrigir(jogo.toUpperCase(), arbitro, golAna.id.toUpperCase(), lancamento(pBruno.toUpperCase())));
  assert.equal(c1.alterado, true);
  assert.deepEqual([c1.lancamento.tipo, c1.lancamento.atleta.nomeCompleto, c1.lancamento.valor, c1.lancamento.substituiLancamentoId, c1.lancamento.anuladoEm], ["temp_gol", "Bruno", 1, golAna.id, null]);
  assert.deepEqual([c1.anulado.id, c1.anulado.tipo, c1.anulado.atleta.nomeCompleto, c1.anulado.substituidoPorId], [golAna.id, "temp_gol", "Ana", c1.lancamento.id], "original preservado");
  assert.ok(c1.anulado.anuladoEm);
  assert.deepEqual(placarDe(c1), [0, 2]);

  // Tipo corrigido: o amarelo era exclusão de dois minutos.
  const c2 = await ok<Correcao>(corrigir(jogo, arbitro, amareloBruno.id, lancamento(pBruno, "temp_exclusaoDoisMinutos")));
  assert.deepEqual([c2.lancamento.tipo, c2.anulado.tipo], ["temp_exclusaoDoisMinutos", "temp_cartaoAmarelo"]);

  // Cadeia: o substituto vigente também pode ser corrigido; o gol volta para Ana.
  const c3 = await ok<Correcao>(corrigir(jogo, arbitro, c1.lancamento.id, lancamento(pAna)));
  assert.deepEqual([c3.lancamento.substituiLancamentoId, c3.anulado.id, ...placarDe(c3)], [c1.lancamento.id, c1.lancamento.id, 1, 1]);

  // Exclusão lógica: o gol do Bruno deixa de contar, mas continua registrado.
  const a1 = await ok(anular(jogo, arbitro, golBruno.id));
  assert.deepEqual([a1.alterado, a1.lancamento.id, a1.lancamento.substituidoPorId, ...placarDe(a1)], [true, golBruno.id, null, 1, 0]);
  assert.ok(a1.lancamento.anuladoEm);

  const atual = await registros(jogo, arbitro);
  assert.deepEqual(resumo(atual), { placar: [1, 0], desempenho: { Ana: [1, 0, 0, 0], Bruno: [0, 0, 1, 0] } });
  assert.equal(atual.lancamentos.length, 6, "três originais e três substitutos, nada apagado");
  assert.deepEqual(new Set(atual.lancamentos.filter(l => l.anuladoEm).map(l => l.id)), new Set([golAna.id, amareloBruno.id, c1.lancamento.id, golBruno.id]));
  assert.deepEqual(atual.lancamentos.find(l => l.id === c1.lancamento.id), { ...c1.lancamento, anuladoEm: atual.lancamentos.find(l => l.id === c1.lancamento.id)!.anuladoEm, substituidoPorId: c3.lancamento.id }, "consulta preserva o contrato");
  const original = atual.lancamentos.find(l => l.id === golAna.id)!;
  assert.deepEqual([original.operacaoId, original.tipo, original.participacaoId, original.registradoEm], [golAna.operacaoId, "temp_gol", pAna, golAna.registradoEm]);

  // Correção sem mudança, lançamento de outro jogo ou inexistente e participação inexistente.
  await recusa(corrigir(jogo, arbitro, c3.lancamento.id, lancamento(pAna)), 400, /alterar o tipo ou o atleta/);
  await recusa(corrigir(jogo, arbitro, randomUUID(), lancamento(pAna, "temp_cartaoAmarelo")), 404, /Lançamento não encontrado/);
  await recusa(anular(jogo, arbitro, randomUUID()), 404, /Lançamento não encontrado/);
  await recusa(corrigir(jogo, arbitro, c3.lancamento.id, lancamento(randomUUID())), 404, /Participação não encontrada/);
  for (const body of [{}, { ...lancamento(pBruno), valor: 2 }, { ...lancamento(pBruno), tipo: "gol" }]) await recusa(corrigir(jogo, arbitro, c3.lancamento.id, body), 400);
  for (const body of [{}, { operacaoId: "x" }, { operacaoId: randomUUID(), motivo: "erro" }]) await recusa(request("POST", `${ARBITRAGEM}/${jogo}/lancamentos/${c3.lancamento.id}/anulacao`, arbitro, body), 400);
  await recusa(corrigir(jogo, arbitro, "nao-uuid", lancamento(pAna)), 400);

  // Lançamento já corrigido ou anulado: conflito com o registro atualizado, sem sobrescrever.
  const conflito = await recusa(corrigir(jogo, arbitro, golAna.id, lancamento(pAna, "temp_cartaoVermelho")), 409, /já foi corrigido ou anulado/) as Conflito;
  assert.deepEqual([conflito.lancamento.id, conflito.lancamento.substituidoPorId, conflito.substituto?.id], [golAna.id, c1.lancamento.id, c1.lancamento.id]);
  const anulado = await recusa(anular(jogo, arbitro, golBruno.id), 409, /já foi corrigido ou anulado/) as Conflito;
  assert.deepEqual([anulado.lancamento.id, anulado.substituto], [golBruno.id, null]);
  assert.deepEqual(resumo(await registros(jogo, arbitro)), resumo(atual));
});

test("banco repete as regras: só anula uma vez, não apaga, substituto exige anulação pela mesma operação", async () => {
  const { jogo, arbitro, pAna, pBruno } = await cenario();
  const gol = await lancar(jogo, arbitro, pAna);
  const outro = await lancar(jogo, arbitro, pAna);
  const anulado = (await ok(anular(jogo, arbitro, outro.id))).lancamento;
  const atualizar = (id: string, data: Record<string, unknown>) => prisma.lancamentoJogo.update({ where: { id }, data });

  await assert.rejects(atualizar(gol.id, { tipo: "temp_cartaoAmarelo" }), "dados não mudam");
  await assert.rejects(atualizar(gol.id, { anuladoEm: new Date() }), "anulação exige a operação");
  await assert.rejects(atualizar(gol.id, { anuladoEm: new Date(), anulacaoOperacaoId: randomUUID(), participacaoId: pBruno }), "anulação não muda dados");
  await assert.rejects(atualizar(anulado.id, { anuladoEm: new Date(), anulacaoOperacaoId: randomUUID() }), "anula uma vez");
  await assert.rejects(prisma.lancamentoJogo.delete({ where: { id: anulado.id } }), "não apaga");

  const criar = (data: Record<string, unknown>) => prisma.lancamentoJogo.create({ data: { operacaoId: randomUUID(), jogoId: jogo, participacaoId: pBruno, tipo: "temp_gol", registradoEm: new Date(), ...data } });
  await assert.rejects(criar({ anuladoEm: new Date(), anulacaoOperacaoId: randomUUID() }), "não nasce anulado");
  await assert.rejects(criar({ substituiLancamentoId: gol.id }), "substitui só lançamento anulado");
  await assert.rejects(criar({ substituiLancamentoId: anulado.id }), "anulado por outra operação (anulação simples)");
  const operacaoId = randomUUID();
  await atualizar(gol.id, { anuladoEm: new Date(), anulacaoOperacaoId: operacaoId });
  await assert.rejects(criar({ substituiLancamentoId: gol.id, participacaoId: randomUUID(), operacaoId }), "participação credenciada do jogo");
  await criar({ substituiLancamentoId: gol.id, operacaoId });
  await assert.rejects(criar({ substituiLancamentoId: gol.id, operacaoId }), "cada lançamento é substituído uma vez");
  assert.deepEqual(resumo(await registros(jogo, arbitro)).placar, [0, 1]);
});

test("correções e anulações simultâneas do mesmo lançamento: a primeira prevalece, as demais recebem o registro atualizado", async () => {
  const { jogo, arbitro, pAna, pBruno } = await cenario();
  const outroDispositivo = await arbitrar(jogo);
  const gol = await lancar(jogo, arbitro, pAna);
  const respostas = await Promise.all([
    corrigir(jogo, arbitro, gol.id, lancamento(pBruno)),
    corrigir(jogo, outroDispositivo, gol.id, lancamento(pAna, "temp_cartaoAmarelo")),
    anular(jogo, arbitro, gol.id),
    anular(jogo, outroDispositivo, gol.id),
    corrigir(jogo, outroDispositivo, gol.id, lancamento(pBruno, "temp_cartaoVermelho")),
  ]);
  assert.deepEqual(respostas.map(r => r.status).sort(), [200, 409, 409, 409, 409]);
  for (const r of respostas.filter(r => r.status === 409)) {
    const corpo = await r.json() as Conflito;
    assert.equal(corpo.lancamento.id, gol.id);
    assert.ok(corpo.lancamento.anuladoEm);
  }
  assert.ok(await prisma.lancamentoJogo.count({ where: { substituiLancamentoId: gol.id } }) <= 1);
  const estado = await registros(jogo, arbitro);
  const vigentes = estado.lancamentos.filter(l => !l.anuladoEm);
  assert.ok(vigentes.length <= 1);
  assert.deepEqual(resumo(estado).placar, [vigentes.filter(l => l.tipo === "temp_gol" && l.participacaoId === pAna).length, vigentes.filter(l => l.tipo === "temp_gol" && l.participacaoId === pBruno).length]);

  // A mesma correção e a mesma anulação enviadas em paralelo gravam uma vez.
  const golParalelo = await lancar(jogo, arbitro, pAna);
  const correcao = lancamento(pBruno);
  const repetidas = await Promise.all(Array.from({ length: 5 }, (_, i) => corrigir(jogo, i % 2 ? arbitro : outroDispositivo, golParalelo.id, correcao)));
  assert.deepEqual(repetidas.map(r => r.status), [200, 200, 200, 200, 200]);
  const corpos = await Promise.all(repetidas.map(r => r.json() as Promise<Correcao>));
  assert.deepEqual(corpos.map(c => c.alterado).sort(), [false, false, false, false, true]);
  assert.equal(new Set(corpos.map(c => c.lancamento.id)).size, 1);
  assert.equal(await prisma.lancamentoJogo.count({ where: { substituiLancamentoId: golParalelo.id } }), 1);

  const golAnulado = await lancar(jogo, arbitro, pAna);
  const operacaoId = randomUUID();
  const anulacoes = await Promise.all(Array.from({ length: 5 }, (_, i) => anular(jogo, i % 2 ? arbitro : outroDispositivo, golAnulado.id, operacaoId)));
  assert.deepEqual(anulacoes.map(r => r.status), [200, 200, 200, 200, 200]);
  assert.deepEqual((await Promise.all(anulacoes.map(r => r.json() as Promise<Registro>))).map(r => r.alterado).sort(), [false, false, false, false, true]);
});

test("reenvio da mesma correção ou anulação não duplica; identificador de outra operação é conflito", async () => {
  const { jogo, arbitro, pAna, pBruno } = await cenario();
  const gol = await lancar(jogo, arbitro, pAna);
  const outroGol = await lancar(jogo, arbitro, pAna);
  const operacaoId = randomUUID();
  const primeira = await ok<Correcao>(corrigir(jogo, arbitro, gol.id, lancamento(pAna, "temp_cartaoAmarelo", operacaoId)));
  const reenvio = await ok<Correcao>(corrigir(jogo, arbitro, gol.id, lancamento(pAna, "temp_cartaoAmarelo", operacaoId.toUpperCase())));
  assert.deepEqual([reenvio.alterado, reenvio.lancamento.id, reenvio.anulado.id, reenvio.anulado.anuladoEm], [false, primeira.lancamento.id, gol.id, primeira.anulado.anuladoEm]);
  await recusa(corrigir(jogo, arbitro, gol.id, lancamento(pBruno, "temp_cartaoAmarelo", operacaoId)), 409, /operacaoId já usado/);
  await recusa(corrigir(jogo, arbitro, outroGol.id, lancamento(pAna, "temp_cartaoAmarelo", operacaoId)), 409, /operacaoId já usado/);
  await recusa(anular(jogo, arbitro, outroGol.id, operacaoId), 409, /operacaoId já usado/);
  await recusa(request("POST", `${ARBITRAGEM}/${jogo}/lancamentos`, arbitro, lancamento(pAna, "temp_cartaoAmarelo", operacaoId)), 409, /operacaoId já usado/);

  const anulacao = randomUUID();
  const anulado = await ok(anular(jogo, arbitro, outroGol.id, anulacao));
  const repetida = await ok(anular(jogo, arbitro, outroGol.id, anulacao));
  assert.deepEqual([anulado.alterado, repetida.alterado, repetida.lancamento.anuladoEm], [true, false, anulado.lancamento.anuladoEm]);
  const terceiro = await lancar(jogo, arbitro, pBruno);
  await recusa(anular(jogo, arbitro, terceiro.id, anulacao), 409, /operacaoId já usado/);
  await recusa(corrigir(jogo, arbitro, terceiro.id, lancamento(pAna, "temp_gol", anulacao)), 409, /operacaoId já usado/);
  await recusa(request("POST", `${ARBITRAGEM}/${jogo}/lancamentos`, arbitro, lancamento(pAna, "temp_gol", anulacao)), 409, /operacaoId já usado/);
  await recusa(anular(jogo, arbitro, terceiro.id, gol.operacaoId), 409, /operacaoId já usado/);
  assert.deepEqual(resumo(await registros(jogo, arbitro)).placar, [0, 1]);
});

test("falha na transação desfaz a correção e a anulação por inteiro", async () => {
  const { jogo, arbitro, pAna, pBruno } = await cenario();
  const gol = await lancar(jogo, arbitro, pAna);
  const token = decodeURIComponent(arbitro.split("=")[1]);
  const operacaoId = randomUUID();
  await assert.rejects(prisma.$transaction(async tx => {
    const resultado = await corrigirPelaArbitragem(tx, jogo, token, gol.id, { operacaoId, tipo: "temp_gol", participacaoId: pBruno });
    assert.deepEqual(placarDe(resultado), [0, 1], "dentro da transação o placar já reflete a correção");
    throw new Error("falha depois de gravar");
  }), /falha depois de gravar/);
  await assert.rejects(prisma.$transaction(async tx => {
    await anularPelaArbitragem(tx, jogo, token, gol.id, { operacaoId: randomUUID() });
    throw new Error("falha depois de anular");
  }), /falha depois de anular/);
  const registro = await prisma.lancamentoJogo.findUniqueOrThrow({ where: { id: gol.id } });
  assert.deepEqual([registro.anuladoEm, registro.anulacaoOperacaoId, await prisma.lancamentoJogo.count({ where: { operacaoId } })], [null, null, 0]);
  assert.deepEqual(resumo(await registros(jogo, arbitro)).placar, [1, 0]);
  // A mesma correção pode ser reenviada depois da falha.
  assert.equal((await ok<Correcao>(corrigir(jogo, arbitro, gol.id, lancamento(pBruno, "temp_gol", operacaoId)))).alterado, true);
});

test("após o encerramento somente o presidente corrige ou anula, sem reabrir a arbitragem nem repetir o cumprimento", async () => {
  const { campeonato, a, b, jogo, arbitro, ana, carla, pAna, pBruno } = await cenario();
  const suspensao = await suspender(campeonato, carla.id, 2);
  const gol1 = await lancar(jogo, arbitro, pAna);
  const gol2 = await lancar(jogo, arbitro, pAna);
  const amarelo = await lancar(jogo, arbitro, pBruno, "temp_cartaoAmarelo");

  // Durante o jogo, quem corrige é a arbitragem.
  await recusa(corrigir(jogo, presidente.cookie, gol1.id, lancamento(pBruno), PRESIDENCIA), 409, /somente após o encerramento/);
  await recusa(anular(jogo, presidente.cookie, gol1.id, randomUUID(), PRESIDENCIA), 409, /somente após o encerramento/);
  assert.equal((await registros(jogo, presidente.cookie, PRESIDENCIA)).jogo.status, "em_andamento");

  await encerrar(jogo, arbitro);
  const encerrado = await prisma.jogo.findUniqueOrThrow({ where: { id: jogo }, select: { encerradoEm: true } });
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensao } }), 1);
  for (const resposta of [await corrigir(jogo, arbitro, gol1.id, lancamento(pBruno)), await anular(jogo, arbitro, gol1.id)]) {
    assert.ok([401, 403].includes(resposta.status), `arbitragem não corrige após o encerramento (${resposta.status})`);
  }

  const correcao = await ok<Correcao>(corrigir(jogo.toUpperCase(), presidente.cookie, gol1.id.toUpperCase(), lancamento(pBruno), PRESIDENCIA));
  assert.deepEqual([correcao.alterado, correcao.lancamento.atleta.nomeCompleto, correcao.anulado.id, ...placarDe(correcao)], [true, "Bruno", gol1.id, 1, 1]);
  const anulacao = await ok(anular(jogo, presidente.cookie, amarelo.id, randomUUID(), PRESIDENCIA));
  assert.ok(anulacao.lancamento.anuladoEm);
  const estado = await registros(jogo, presidente.cookie, PRESIDENCIA);
  assert.deepEqual([estado.jogo.status, resumo(estado)], ["finalizado", { placar: [1, 1], desempenho: { Ana: [1, 0, 0, 0], Bruno: [1, 0, 0, 0] } }]);

  // Encerramento, cumprimento e revogação da arbitragem permanecem como estavam.
  const depois = await prisma.jogo.findUniqueOrThrow({ where: { id: jogo }, select: { status: true, encerradoEm: true } });
  assert.deepEqual(depois, { status: "finalizado", encerradoEm: encerrado.encerradoEm });
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensao } }), 1);
  assert.equal(await prisma.sessaoArbitragem.count({ where: { arbitragem: { jogoId: jogo }, revogadaEm: null } }), 0);

  // Presidente não inclui lançamento novo; o banco também recusa a inclusão no jogo finalizado.
  await recusa(request("POST", `${PRESIDENCIA}/${jogo}/lancamentos`, presidente.cookie, lancamento(pAna)), 404);
  await assert.rejects(prisma.lancamentoJogo.create({ data: { operacaoId: randomUUID(), jogoId: jogo, participacaoId: pAna, tipo: "temp_gol", registradoEm: new Date() } }));

  // Correções simultâneas do presidente: a primeira prevalece.
  const paralelas = await Promise.all([corrigir(jogo, presidente.cookie, gol2.id, lancamento(pBruno), PRESIDENCIA), anular(jogo, presidente.cookie, gol2.id, randomUUID(), PRESIDENCIA)]);
  assert.deepEqual(paralelas.map(r => r.status).sort(), [200, 409]);

  // Somente presidente; jogo e lançamento precisam existir e corresponder.
  for (const [cookie, status] of [["", 401], [ana.cookie, 403]] as const) {
    await recusa(request("GET", `${PRESIDENCIA}/${jogo}/lancamentos`, cookie), status);
    await recusa(corrigir(jogo, cookie, gol1.id, lancamento(pAna, "temp_cartaoAmarelo"), PRESIDENCIA), status);
    await recusa(anular(jogo, cookie, gol1.id, randomUUID(), PRESIDENCIA), status);
  }
  await recusa(request("GET", `${PRESIDENCIA}/${randomUUID()}/lancamentos`, presidente.cookie), 404);
  await recusa(anular(randomUUID(), presidente.cookie, gol1.id, randomUUID(), PRESIDENCIA), 404);
  const outroJogo = await agendar(campeonato, b, a);
  await recusa(anular(outroJogo, presidente.cookie, correcao.lancamento.id, randomUUID(), PRESIDENCIA), 409, /somente após o encerramento/);
  await recusa(anular(jogo, presidente.cookie, randomUUID(), randomUUID(), PRESIDENCIA), 404, /Lançamento não encontrado/);

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const rota of ["/arbitragem/jogos/{jogoId}/lancamentos/{lancamentoId}/correcao", "/arbitragem/jogos/{jogoId}/lancamentos/{lancamentoId}/anulacao",
    "/jogos/{jogoId}/lancamentos/{lancamentoId}/correcao", "/jogos/{jogoId}/lancamentos/{lancamentoId}/anulacao"]) {
    assert.ok(contrato.paths[rota]?.post, rota);
  }
  assert.ok(contrato.paths["/jogos/{jogoId}/lancamentos"]?.get);
});
