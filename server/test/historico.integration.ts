import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { ForbiddenException } from "@nestjs/common";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { AutorizacaoService } from "../dist/modules/autorizacao/autorizacao.service.js";
import { consultarHistoricoDoAtleta } from "../dist/modules/resultados/historico.js";

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
type Conta = { id: string; email: string; cookie: string };
async function criarPresidente(): Promise<Conta> {
  const email = novoEmail();
  const authId = randomUUID();
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente do histórico", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente do histórico", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
let presidente: Conta;

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, nome = "Pessoa Fictícia", aprovar = true }: { clubeId?: string; nome?: string; aprovar?: boolean } = {}): Promise<Conta> {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
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
async function tecnicoDe(clubeId: string, nome: string) {
  const tecnico = await cadastrar("tecnico", { nome });
  const response = await request("PUT", `/clubes/${clubeId}/tecnico`, presidente.cookie, { tecnicoId: tecnico.id });
  assert.equal(response.status, 200, await response.clone().text());
  return tecnico;
}
async function campeonatoCom(clubesInscritos: string[], nome: string) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome, edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  return id;
}
const dataLocal = (fuso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string, hora = "12:00") {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: `${dataLocal("America/Recife")}T${hora}`, fusoHorario: "America/Recife" });
  assert.equal(response.status, 201, await response.clone().text());
  const jogo = await response.json() as { id: string; clubeA: { inscricaoId: string }; clubeB: { inscricaoId: string } };
  return { id: jogo.id, inscricaoA: jogo.clubeA.inscricaoId, inscricaoB: jogo.clubeB.inscricaoId };
}
async function arbitrar(jogoId: string) {
  const senha = (await (await request("GET", `/jogos/${jogoId}/arbitragem/senha`, presidente.cookie)).json()).senha as string;
  throttler.onApplicationShutdown();
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
  assert.equal(response.status, 201, await response.clone().text());
  return response.headers.getSetCookie().find(c => c.startsWith(`handebol.arbitragem.${jogoId}=`))!.split(";")[0];
}

async function ok<T>(response: Promise<Response>): Promise<T> {
  const resolvida = await response;
  assert.equal(resolvida.status, 200, await resolvida.clone().text());
  return resolvida.json() as Promise<T>;
}
async function status(response: Promise<Response>, esperado: number) {
  const resolvida = await response;
  assert.equal(resolvida.status, esperado, await resolvida.text());
}
const escalar = async (jogo: string, atletaId: string, cookie: string) => assert.equal((await request("POST", `/jogos/${jogo}/escalacao`, cookie, { atletaId })).status, 200);
const credenciar = async (jogo: string, arbitro: string, atletaId: string, numeroCamisa: number) =>
  (await ok<{ participacao: { participacaoId: string } }>(request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, arbitro, { atletaId, numeroCamisa }))).participacao.participacaoId;
const entrar = (jogo: string, arbitro: string, atletaId: string) => ok(request("POST", `/arbitragem/jogos/${jogo}/credenciamentos/${atletaId}/entrada`, arbitro));
const iniciar = (jogo: string, arbitro: string) => ok(request("POST", `/arbitragem/jogos/${jogo}/inicio`, arbitro));
const encerrar = (jogo: string, arbitro: string, resultado: string, vencedorInscricaoId: string | null) =>
  ok(request("POST", `/arbitragem/jogos/${jogo}/encerramento`, arbitro, { resultado, vencedorInscricaoId }));
const lancar = async (jogo: string, arbitro: string, participacaoId: string, tipo = "temp_gol", extra: object = {}) =>
  (await ok<{ lancamento: { id: string } }>(request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, arbitro, { operacaoId: randomUUID(), tipo, participacaoId, ...extra }))).lancamento.id;

type Metricas = { temp_gols: number; temp_cartoesAmarelos: number; temp_exclusoesDoisMinutos: number; temp_cartoesVermelhos: number };
type Situacao = { participacaoId: string; numeroCamisa: number | null; escalado: boolean; credenciado: boolean; entrouEmQuadra: boolean; metricas: Metricas | null };
type ResumoJogo = { id: string; status: string; resultado: string | null; vencedorInscricaoId: string | null; invalidadoEm: string | null; interrompido: boolean; campeonato: { id: string } };
type ClubeNoJogo = { inscricaoId: string; clube: { id: string; nome: string } };
type Desempenho = {
  jogo: ResumoJogo;
  placar: { clubeA: ClubeNoJogo; temp_placarClubeA: number; clubeB: ClubeNoJogo; temp_placarClubeB: number } | null;
  participacoes: (Situacao & { inscricaoId: string; atleta: { id: string; nomeCompleto: string } })[];
};
type Historico = {
  atleta: { id: string; nomeCompleto: string; clubeAtual: { id: string; nome: string } | null };
  totais: Metricas & { participacoes: { escaladas: number; credenciadas: number; comEntradaEmQuadra: number } };
  jogos: (Situacao & { jogo: ResumoJogo; clube: ClubeNoJogo; adversario: ClubeNoJogo; placar: { clube: number; adversario: number } | null })[];
};
const desempenho = (jogo: string, cookie: string) => request("GET", `/jogos/${jogo}/desempenho`, cookie);
const historico = (atletaId: string, cookie: string) => request("GET", `/atletas/${atletaId}/historico`, cookie);
const metricas = (m: Metricas | null) => m && [m.temp_gols, m.temp_cartoesAmarelos, m.temp_exclusoesDoisMinutos, m.temp_cartoesVermelhos];
const etapas = (s: Situacao) => [s.escalado, s.credenciado, s.entrouEmQuadra];

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
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

test("métricas do jogo somam lançamentos válidos, distinguem etapas e separam vencedor do placar; acesso por clube", async () => {
  const [a, b, c] = [await criarClube("Clube A"), await criarClube("Clube B"), await criarClube("Clube C")];
  const [tecnicoA, tecnicoB, tecnicoC] = [await tecnicoDe(a, "Técnico A"), await tecnicoDe(b, "Técnico B"), await tecnicoDe(c, "Técnico C")];
  const [ana, carla, dani, bruno] = [
    await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" }),
    await cadastrar("atleta", { clubeId: a, nome: "Dani" }), await cadastrar("atleta", { clubeId: b, nome: "Bruno" }),
  ];
  const campeonato = await campeonatoCom([a, b], "Campeonato das métricas");
  const jogo = await agendar(campeonato, a, b);

  // Antes do início: escalação sem métricas e placar nulo.
  await escalar(jogo.id, ana.id, tecnicoA.cookie);
  await escalar(jogo.id, carla.id, tecnicoA.cookie);
  const antes = await ok<Desempenho>(desempenho(jogo.id, tecnicoA.cookie));
  assert.equal(antes.placar, null);
  assert.deepEqual(antes.participacoes.map(p => [p.atleta.nomeCompleto, ...etapas(p), p.metricas]), [["Ana", true, false, false, null], ["Carla", true, false, false, null]]);

  const arbitro = await arbitrar(jogo.id);
  const pAna = await credenciar(jogo.id, arbitro, ana.id, 7);
  const pDani = await credenciar(jogo.id, arbitro, dani.id, 8); // credenciada sem escalação e sem entrada
  const pBruno = await credenciar(jogo.id, arbitro, bruno.id, 9);
  await iniciar(jogo.id, arbitro);
  await entrar(jogo.id, arbitro, ana.id);
  await entrar(jogo.id, arbitro, bruno.id);
  await lancar(jogo.id, arbitro, pAna);
  const golAnulado = await lancar(jogo.id, arbitro, pAna);
  const golCorrigido = await lancar(jogo.id, arbitro, pAna);
  await lancar(jogo.id, arbitro, pAna, "temp_cartaoAmarelo");
  await lancar(jogo.id, arbitro, pBruno);
  await lancar(jogo.id, arbitro, pBruno, "temp_exclusaoDoisMinutos");
  await lancar(jogo.id, arbitro, pBruno, "temp_cartaoVermelho", { relatorioDisciplinar: true });
  assert.equal((await request("POST", `/arbitragem/jogos/${jogo.id}/lancamentos/${golAnulado}/anulacao`, arbitro, { operacaoId: randomUUID() })).status, 200);

  // Abandono com vencedor B apesar do placar 2 x 1 para A: o vencedor não deriva do placar.
  await encerrar(jogo.id, arbitro, "abandono", jogo.inscricaoB);
  // Após o encerramento o presidente corrige um gol de Ana para Dani, do mesmo clube: totais mudam, placar não.
  assert.equal((await request("POST", `/jogos/${jogo.id}/lancamentos/${golCorrigido}/correcao`, presidente.cookie, { operacaoId: randomUUID(), tipo: "temp_gol", participacaoId: pDani })).status, 200);

  const visto = await ok<Desempenho>(desempenho(jogo.id.toUpperCase(), presidente.cookie));
  assert.deepEqual([visto.jogo.status, visto.jogo.resultado, visto.jogo.vencedorInscricaoId, visto.jogo.invalidadoEm, visto.jogo.interrompido], ["finalizado", "abandono", jogo.inscricaoB, null, false]);
  assert.deepEqual([visto.placar?.temp_placarClubeA, visto.placar?.temp_placarClubeB], [2, 1], "gol anulado fora do placar");
  assert.deepEqual(visto.participacoes.map(p => [p.atleta.nomeCompleto, p.numeroCamisa, ...etapas(p), metricas(p.metricas)]), [
    ["Ana", 7, true, true, true, [1, 1, 0, 0]],
    ["Dani", 8, false, true, false, [1, 0, 0, 0]],
    ["Carla", null, true, false, false, null],
    ["Bruno", 9, false, true, true, [1, 0, 1, 1]],
  ], "clube A antes do B; vermelho com azul conta uma desqualificação");
  assert.ok(!JSON.stringify(visto).includes("@example.invalid"), "sem e-mail");

  // Técnicos dos dois clubes veem o jogo inteiro; de outro clube, atleta, sem sessão e inexistente são recusados.
  assert.deepEqual(await ok<Desempenho>(desempenho(jogo.id, tecnicoA.cookie)), visto);
  assert.deepEqual(await ok<Desempenho>(desempenho(jogo.id, tecnicoB.cookie)), visto);
  await status(desempenho(jogo.id, tecnicoC.cookie), 403);
  await status(desempenho(jogo.id, ana.cookie), 403);
  await status(desempenho(jogo.id, ""), 401);
  await status(desempenho(randomUUID(), tecnicoA.cookie), 403);
  await status(desempenho(randomUUID(), presidente.cookie), 404);
  await status(desempenho("nao-e-uuid", presidente.cookie), 400);

  // O técnico substituído deixa de consultar; o novo técnico do clube passa a consultar.
  const novoTecnico = await cadastrar("tecnico", { nome: "Técnico novo" });
  assert.equal((await request("PUT", `/clubes/${c}/tecnico`, presidente.cookie, { tecnicoId: novoTecnico.id, substituirTecnicoId: tecnicoC.id })).status, 200);
  assert.equal((await request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: tecnicoC.id, substituirTecnicoId: tecnicoA.id })).status, 200);
  await status(desempenho(jogo.id, tecnicoA.cookie), 403);
  await ok(desempenho(jogo.id, tecnicoC.cookie));
});

test("histórico preserva o clube de cada jogo após transferência, soma jogos excepcionais e invalidados e restringe o acesso", async () => {
  const [a, b] = [await criarClube("Clube Origem"), await criarClube("Clube Destino")];
  const [tecnicoA, tecnicoB] = [await tecnicoDe(a, "Técnico Origem"), await tecnicoDe(b, "Técnico Destino")];
  const [ana, bruno] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: b, nome: "Bruno" })];
  const pendente = await cadastrar("atleta", { clubeId: a, nome: "Pendente", aprovar: false });

  // Jogo 1: Ana pelo clube de origem, 2 gols válidos e 1 anulado; jogo encerrado normalmente.
  const campeonato1 = await campeonatoCom([a, b], "Primeiro campeonato");
  const j1 = await agendar(campeonato1, a, b, "10:00");
  const arbitro1 = await arbitrar(j1.id);
  const pAna1 = await credenciar(j1.id, arbitro1, ana.id, 10);
  const pBruno1 = await credenciar(j1.id, arbitro1, bruno.id, 4);
  await iniciar(j1.id, arbitro1);
  await entrar(j1.id, arbitro1, ana.id);
  await lancar(j1.id, arbitro1, pAna1);
  await lancar(j1.id, arbitro1, pAna1);
  const anulado = await lancar(j1.id, arbitro1, pAna1);
  await lancar(j1.id, arbitro1, pBruno1);
  await encerrar(j1.id, arbitro1, "normal", j1.inscricaoA);
  assert.equal((await request("POST", `/jogos/${j1.id}/lancamentos/${anulado}/anulacao`, presidente.cookie, { operacaoId: randomUUID() })).status, 200);

  // Transferência e jogo 2 pelo clube de destino: amarelo e um gol; o jogo é interrompido definitivamente e invalidado.
  assert.equal((await request("POST", `/atletas/${ana.id}/transferencia`, presidente.cookie, { clubeAtualId: a, clubeDestinoId: b })).status, 200);
  const campeonato2 = await campeonatoCom([a, b], "Segundo campeonato");
  const j2 = await agendar(campeonato2, a, b, "14:00");
  await escalar(j2.id, ana.id, tecnicoB.cookie);
  const arbitro2 = await arbitrar(j2.id);
  const pAna2 = await credenciar(j2.id, arbitro2, ana.id, 11);
  await iniciar(j2.id, arbitro2);
  await lancar(j2.id, arbitro2, pAna2);
  await lancar(j2.id, arbitro2, pAna2, "temp_cartaoAmarelo");
  await encerrar(j2.id, arbitro2, "interrompido", null);
  assert.equal((await request("POST", `/jogos/${j2.id}/invalidacao`, presidente.cookie, { motivo: "Atleta irregular no adversário" })).status, 200);

  // Jogo 3: escalada e ainda agendado, sem credenciamento.
  const j3 = await agendar(campeonato2, b, a, "18:00");
  await escalar(j3.id, ana.id, tecnicoB.cookie);

  const proprio = await ok<Historico>(historico(ana.id, ana.cookie));
  assert.deepEqual(proprio.atleta, { id: ana.id, nomeCompleto: "Ana", clubeAtual: { id: b, nome: "Clube Destino" } });
  const porJogo = Object.fromEntries(proprio.jogos.map(j => [j.jogo.id, [j.clube.clube.id, j.adversario.clube.id, j.placar && [j.placar.clube, j.placar.adversario], j.numeroCamisa, ...etapas(j), metricas(j.metricas)]]));
  assert.deepEqual(porJogo, {
    [j3.id]: [b, a, null, null, true, false, false, null],
    [j2.id]: [b, a, [1, 0], 11, true, true, false, [1, 1, 0, 0]],
    [j1.id]: [a, b, [2, 1], 10, false, true, true, [2, 0, 0, 0]],
  }, "clube do jogo 1 preservado após a transferência");
  const ordem = proprio.jogos.map(j => j.jogo.id);
  assert.equal(ordem.length, 3);
  assert.ok(ordem.indexOf(j2.id) < ordem.indexOf(j1.id), "jogo mais recente primeiro");
  const [jogo1, jogo2] = [proprio.jogos.find(j => j.jogo.id === j1.id)!, proprio.jogos.find(j => j.jogo.id === j2.id)!];
  assert.deepEqual([jogo2.jogo.resultado, jogo2.jogo.vencedorInscricaoId, Boolean(jogo2.jogo.invalidadoEm)], ["interrompido", null, true]);
  assert.deepEqual([jogo1.jogo.vencedorInscricaoId, jogo1.jogo.invalidadoEm], [j1.inscricaoA, null]);
  assert.deepEqual(proprio.totais, {
    participacoes: { escaladas: 2, credenciadas: 2, comEntradaEmQuadra: 1 },
    temp_gols: 3, temp_cartoesAmarelos: 1, temp_exclusoesDoisMinutos: 0, temp_cartoesVermelhos: 0,
  }, "invalidado conta; anulado não");
  assert.ok(!JSON.stringify(proprio).includes("@example.invalid"), "sem e-mail");

  // Presidente e técnico do clube atual veem o histórico completo, inclusive pelo clube anterior.
  assert.deepEqual(await ok<Historico>(historico(ana.id.toUpperCase(), presidente.cookie)), proprio);
  assert.deepEqual(await ok<Historico>(historico(ana.id, tecnicoB.cookie)), proprio);
  // Técnico do clube anterior, outro atleta, sem aprovação ou sem sessão: recusados.
  await status(historico(ana.id, tecnicoA.cookie), 403);
  await status(historico(ana.id, bruno.cookie), 403);
  await status(historico(pendente.id, pendente.cookie), 403);
  await status(historico(ana.id, ""), 401);
  await status(historico(randomUUID(), tecnicoB.cookie), 403);
  await status(historico(randomUUID(), presidente.cookie), 404);
  await status(historico(tecnicoB.id, presidente.cookie), 404);
  await status(historico("nao-e-uuid", presidente.cookie), 400);

  // Atleta sem jogos: histórico vazio com totais zerados.
  const vazio = await ok<Historico>(historico(pendente.id, presidente.cookie));
  assert.deepEqual([vazio.jogos, vazio.totais.temp_gols, vazio.totais.participacoes.credenciadas], [[], 0, 0]);
});

test("histórico com ID de técnico é recusado sem disputar o bloqueio de uma substituição concorrente", async () => {
  const clubeId = await criarClube("Clube do bloqueio do histórico");
  const atual = await tecnicoDe(clubeId, "Técnico atual");
  const novo = await cadastrar("tecnico", { nome: "Técnico substituto" });

  await prisma.$transaction(async substituicao => {
    // A substituição bloqueia as contas dos técnicos; a consulta inválida não deve tentar bloqueá-las.
    await substituicao.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${novo.id}::uuid FOR UPDATE`;
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
      const ator = await app.get(AutorizacaoService).revalidar(tx, { usuarioId: atual.id }, { aprovado: true });
      return consultarHistoricoDoAtleta(tx, ator, novo.id);
    }), ForbiddenException);
  });
  await status(historico(novo.id, atual.cookie), 403);
  await status(historico(novo.id, presidente.cookie), 404);
});

test("contrato OpenAPI inclui as consultas de resultados e histórico", async () => {
  const contrato = await ok<{ paths: Record<string, { get?: unknown }> }>(request("GET", "/openapi.json"));
  assert.ok(contrato.paths["/jogos/{jogoId}/desempenho"]?.get);
  assert.ok(contrato.paths["/atletas/{atletaId}/historico"]?.get);
});
