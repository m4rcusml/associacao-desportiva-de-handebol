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
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato das correções administrativas", edicao: "2026", categoria: "Adulto" });
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

type Pessoa = { id: string; nomeCompleto: string };
type Participacao = {
  participacaoId: string; inscricaoId: string; atleta: Pessoa; numeroCamisa: number; credenciadoEm: string; entrouEmQuadraEm: string | null; escalado: boolean;
  entradaAnulada: { anuladaEm: string; presidenteId: string } | null; registroAdministrativo: { presidenteId: string; irregularidades: string[] } | null;
};
type Alteracao = {
  id: string; tipo: string; atleta: Pessoa; credenciadoEm: string; numeroCamisaAnterior: number; numeroCamisaNova: number | null; registradaEm: string;
  entrouEmQuadraEm: string | null; entradaAnulada: { anuladaEm: string; presidenteId: string } | null;
  registroAdministrativo: { presidenteId: string; irregularidades: string[] } | null; presidenteId: string | null;
};
type Registro = { participacao: Participacao; alterado: boolean };
type Estorno = { estorno: Alteracao; alterado: boolean };
type Placar = { placarClubeA: number; placarClubeB: number };
type Lancamento = { id: string; participacaoId: string; anuladoEm: string | null; substituidoPorId: string | null };

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
const entrar = (jogo: string, cookie: string, atletaId: string) => ok(request("POST", `${ARBITRAGEM}/${jogo}/credenciamentos/${atletaId}/entrada`, cookie));
const iniciar = (jogo: string, cookie: string) => ok(request("POST", `${ARBITRAGEM}/${jogo}/inicio`, cookie));
const encerrar = (jogo: string, cookie: string) => ok(request("POST", `${ARBITRAGEM}/${jogo}/encerramento`, cookie, { resultado: "normal", vencedorInscricaoId: null }));
const lancar = async (jogo: string, cookie: string, participacaoId: string, tipo = "gol", relatorioDisciplinar?: boolean) =>
  (await ok<{ lancamento: Lancamento }>(request("POST", `${ARBITRAGEM}/${jogo}/lancamentos`, cookie,
    { operacaoId: randomUUID(), tipo, participacaoId, ...(relatorioDisciplinar === undefined ? {} : { relatorioDisciplinar }) }))).lancamento;
const PRESIDENCIA = (jogo: string) => `/jogos/${jogo}/credenciamentos`;
const registrar = (jogo: string, atletaId: string, numeroCamisa: number, entrouEmQuadra = true, cookie = presidente.cookie) =>
  request("POST", `${PRESIDENCIA(jogo)}/administrativos`, cookie, { atletaId, numeroCamisa, entrouEmQuadra });
const anularEntrada = (jogo: string, atletaId: string, cookie = presidente.cookie) => request("POST", `${PRESIDENCIA(jogo)}/${atletaId}/entrada/anulacao`, cookie);
const estornar = (jogo: string, atletaId: string, numeroCamisa: number, cookie = presidente.cookie) =>
  request("POST", `${PRESIDENCIA(jogo)}/${atletaId}/estorno`, cookie, { numeroCamisa });
const transferir = (jogo: string, lancamentoId: string, participacaoId: string, tipo = "gol", relatorioDisciplinar?: boolean) =>
  ok<{ lancamento: Lancamento; placar: Placar; suspensoesAutomaticas: { criadas: string[]; anuladas: string[] } }>(
    request("POST", `/jogos/${jogo}/lancamentos/${lancamentoId}/correcao`, presidente.cookie,
      { operacaoId: randomUUID(), tipo, participacaoId, ...(relatorioDisciplinar === undefined ? {} : { relatorioDisciplinar }) }));
const anularLancamento = (jogo: string, lancamentoId: string) =>
  ok<{ placar: Placar }>(request("POST", `/jogos/${jogo}/lancamentos/${lancamentoId}/anulacao`, presidente.cookie, { operacaoId: randomUUID() }));
const placar = async (jogo: string) => {
  const { placarClubeA, placarClubeB } = (await ok<{ placar: Placar }>(request("GET", `/jogos/${jogo}/lancamentos`, presidente.cookie))).placar;
  return [placarClubeA, placarClubeB];
};
type Situacao = { atleta?: Pessoa; jogo?: { id: string }; credenciado: boolean; entrouEmQuadra: boolean; entradaAnulada: boolean; registroAdministrativo: boolean; irregularidades: string[]; metricas: { gols: number } | null };
const historico = (atletaId: string) => ok<{ totais: { participacoes: { credenciadas: number; comEntradaEmQuadra: number }; gols: number }; jogos: Situacao[] }>(
  request("GET", `/atletas/${atletaId}/historico`, presidente.cookie));

/** Clube A (João, Pedro) e B (Bruno); João (7) credenciado, entra e marca; Bruno (9) também. Pedro joga, mas não foi credenciado. */
async function cenario({ encerrado = true } = {}) {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo);
  const [joao, pedro, bruno] = [
    await cadastrar("atleta", { clubeId: a, nome: "João" }), await cadastrar("atleta", { clubeId: a, nome: "Pedro" }), await cadastrar("atleta", { clubeId: b, nome: "Bruno" }),
  ];
  const pJoao = (await credenciar(jogo, arbitro, joao.id, 7)).participacaoId;
  const pBruno = (await credenciar(jogo, arbitro, bruno.id, 9)).participacaoId;
  await iniciar(jogo, arbitro);
  await entrar(jogo, arbitro, joao.id);
  await entrar(jogo, arbitro, bruno.id);
  const golJoao = await lancar(jogo, arbitro, pJoao);
  const golBruno = await lancar(jogo, arbitro, pBruno);
  if (encerrado) await encerrar(jogo, arbitro);
  return { a, b, campeonato, jogo, arbitro, joao, pedro, bruno, pJoao, pBruno, golJoao, golBruno };
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Jogos levam lançamentos, participações, histórico, arbitragens, sessões, cumprimentos e suspensões automáticas.
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

test("João credenciado no lugar de Pedro: entrada anulada, participação real registrada, gol transferido e estorno com histórico", async () => {
  const { jogo, joao, pedro, pJoao, golJoao } = await cenario();
  assert.deepEqual(await placar(jogo), [1, 1]);

  // Enquanto restam entrada e lançamento válidos, o estorno é recusado.
  await recusa(estornar(jogo, joao.id, 7), 409, /entrada em quadra válida/);

  // Pedro: participação real com outra camisa (a 7 ainda é de João), sem irregularidades; reenvio não duplica.
  const registro = await ok<Registro>(registrar(jogo.toUpperCase(), pedro.id.toUpperCase(), 17));
  assert.deepEqual([registro.alterado, registro.participacao.numeroCamisa, Boolean(registro.participacao.entrouEmQuadraEm), registro.participacao.registroAdministrativo],
    [true, 17, true, { presidenteId: presidente.id, irregularidades: [] }]);
  assert.equal(registro.participacao.entrouEmQuadraEm, registro.participacao.credenciadoEm);
  assert.deepEqual(await ok<Registro>(registrar(jogo, pedro.id, 17)), { ...registro, alterado: false });
  await recusa(registrar(jogo, pedro.id, 18), 409, /já credenciado/);
  await recusa(registrar(jogo, joao.id, 27), 409, /já credenciado/);

  // Entrada de João anulada: original preservado, com autor; repetir não muda.
  const anulada = await ok<Registro>(anularEntrada(jogo, joao.id));
  assert.equal(anulada.alterado, true);
  assert.ok(anulada.participacao.entrouEmQuadraEm, "horário original permanece");
  assert.equal(anulada.participacao.entradaAnulada?.presidenteId, presidente.id);
  assert.deepEqual(await ok<Registro>(anularEntrada(jogo, joao.id)), { ...anulada, alterado: false });

  // Ainda há o gol válido de João.
  await recusa(estornar(jogo, joao.id, 7), 409, /restam lançamentos válidos/);

  // Gol transferido para Pedro, do mesmo clube: o placar não muda.
  const transferido = await transferir(jogo, golJoao.id, registro.participacao.participacaoId);
  assert.equal(transferido.lancamento.participacaoId, registro.participacao.participacaoId);
  assert.deepEqual([transferido.placar.placarClubeA, transferido.placar.placarClubeB], [1, 1]);

  // Agora o estorno de João é feito; tudo fica no histórico, inclusive a entrada anulada e o autor.
  const estorno = await ok<Estorno>(estornar(jogo, joao.id, 7));
  assert.deepEqual([estorno.alterado, estorno.estorno.tipo, estorno.estorno.numeroCamisaAnterior, estorno.estorno.presidenteId, estorno.estorno.atleta.nomeCompleto],
    [true, "estorno", 7, presidente.id, "João"]);
  assert.equal(estorno.estorno.entrouEmQuadraEm, anulada.participacao.entrouEmQuadraEm);
  assert.deepEqual(estorno.estorno.entradaAnulada, anulada.participacao.entradaAnulada);
  assert.deepEqual(await ok<Estorno>(estornar(jogo, joao.id, 7)), { ...estorno, alterado: false });
  await recusa(estornar(jogo, joao.id, 8), 409, /não está credenciado/);

  // A participação de João continua existindo (o gol original aponta para ela), desfeita e sem etapas.
  const linha = await prisma.participacao.findUniqueOrThrow({ where: { id: pJoao } });
  assert.deepEqual([linha.credenciadoEm, linha.numeroCamisa, linha.entrouEmQuadraEm, Boolean(linha.credenciamentoDesfeitoEm)], [null, null, null, true]);
  const original = await prisma.lancamentoJogo.findUniqueOrThrow({ where: { id: golJoao.id } });
  assert.deepEqual([original.participacaoId, Boolean(original.anuladoEm)], [pJoao, true]);

  // Pedro fica com a camisa 7 depois do estorno.
  await ok(request("POST", `${PRESIDENCIA(jogo)}/${pedro.id}/camisa`, presidente.cookie, { numeroCamisaAtual: 17, numeroCamisa: 7 }));

  const consulta = await ok<{ participacoes: Participacao[]; desfeitas: { participacaoId: string; atleta: Pessoa }[]; alteracoes: Alteracao[] }>(request("GET", PRESIDENCIA(jogo), presidente.cookie));
  assert.deepEqual(consulta.desfeitas.map(d => [d.participacaoId, d.atleta.nomeCompleto]), [[pJoao, "João"]]);
  assert.deepEqual(consulta.alteracoes.map(a => [a.tipo, a.atleta.nomeCompleto, a.presidenteId]), [["estorno", "João", presidente.id], ["correcao_camisa", "Pedro", presidente.id]]);
  assert.deepEqual(consulta.participacoes.map(p => [p.atleta.nomeCompleto, p.numeroCamisa]).sort(), [["Bruno", 9], ["Pedro", 7]]);
  assert.deepEqual(await placar(jogo), [1, 1]);

  // Históricos: João sem o jogo; Pedro com participação administrativa, entrada e o gol.
  const hJoao = await historico(joao.id);
  assert.deepEqual([hJoao.jogos.length, hJoao.totais.gols], [0, 0]);
  const hPedro = await historico(pedro.id);
  assert.deepEqual(hPedro.jogos.map(j => [j.jogo?.id, j.credenciado, j.entrouEmQuadra, j.registroAdministrativo, j.irregularidades, j.metricas?.gols]),
    [[jogo, true, true, true, [], 1]]);
  const desempenho = await ok<{ participacoes: Situacao[] }>(request("GET", `/jogos/${jogo}/desempenho`, presidente.cookie));
  assert.deepEqual(desempenho.participacoes.map(p => p.atleta?.nomeCompleto).sort(), ["Bruno", "Pedro"]);
});

test("entrada anulada deixa de contar no histórico e transferência para atleta adversário altera os dois placares", async () => {
  const { jogo, joao, bruno, pBruno, golJoao } = await cenario();
  await ok(anularEntrada(jogo, joao.id));
  const h = await historico(joao.id);
  assert.deepEqual(h.jogos.map(j => [j.entrouEmQuadra, j.entradaAnulada, j.metricas?.gols]), [[false, true, 1]]);
  assert.equal(h.totais.participacoes.comEntradaEmQuadra, 0);

  // Gol de João era do adversário Bruno: A perde, B ganha.
  const transferido = await transferir(jogo, golJoao.id, pBruno);
  assert.deepEqual([transferido.placar.placarClubeA, transferido.placar.placarClubeB], [0, 2]);
  assert.equal((await historico(bruno.id)).totais.gols, 2);
  // Anular um gol que não aconteceu altera o placar.
  assert.deepEqual(await anularLancamento(jogo, transferido.lancamento.id).then(r => [r.placar.placarClubeA, r.placar.placarClubeB]), [0, 1]);

  // Sem entrada válida nem lançamentos válidos, João tem o credenciamento desfeito.
  assert.equal((await ok<Estorno>(estornar(jogo, joao.id, 7))).alterado, true);
  // Sem entrada a anular, a recusa é explícita.
  await recusa(anularEntrada(jogo, joao.id), 409, /não está credenciado/);
});

test("atleta inelegível tem a participação real registrada com as irregularidades, sem regularizar nem desfazer o cumprimento", async () => {
  const { a, b, campeonato } = await (async () => {
    const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
    return { a, b, campeonato: await campeonatoCom([a, b]) };
  })();
  const [pedro, carla, davi] = [
    await cadastrar("atleta", { clubeId: a, nome: "Pedro" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" }), await cadastrar("atleta", { clubeId: a, nome: "Davi" }),
  ];
  const aplicada = await request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, { atletaId: pedro.id, quantidadeJogos: 2, motivo: "Suspensão manual de teste" });
  assert.equal(aplicada.status, 201, await aplicada.clone().text());
  const suspensao = await aplicada.json() as { id: string };
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo);
  // A arbitragem continua sem credenciar o suspenso (o registro administrativo não amplia o credenciamento normal).
  await recusa(request("POST", `${ARBITRAGEM}/${jogo}/credenciamentos`, arbitro, { atletaId: pedro.id, numeroCamisa: 10 }), 409, /suspensão a cumprir/);
  await iniciar(jogo, arbitro);
  // Antes do encerramento, o presidente não faz correções administrativas.
  await recusa(registrar(jogo, pedro.id, 10), 409, /somente após o encerramento/);
  await encerrar(jogo, arbitro);
  const cumprimentos = () => prisma.cumprimentoSuspensao.count({ where: { suspensaoId: suspensao.id } });
  assert.equal(await cumprimentos(), 1, "o jogo cumpriu a suspensão de Pedro, que não estava credenciado");

  // Carteirinha de Carla invalidada e conta de Davi desativada depois do jogo.
  assert.equal((await request("POST", `/carteirinhas/atleta/${carla.id}/invalidacao`, presidente.cookie, {})).status, 200);
  assert.equal((await request("POST", `/contas/${davi.id}/desativacao`, presidente.cookie, {})).status, 200);

  const rPedro = await ok<Registro>(registrar(jogo, pedro.id, 10));
  assert.deepEqual(rPedro.participacao.registroAdministrativo?.irregularidades, ["suspensao"]);
  const rCarla = await ok<Registro>(registrar(jogo, carla.id, 11, false));
  assert.deepEqual([rCarla.participacao.registroAdministrativo?.irregularidades, rCarla.participacao.entrouEmQuadraEm], [["carteirinha_invalidada"], null]);
  const rDavi = await ok<Registro>(registrar(jogo, davi.id, 12));
  assert.deepEqual(rDavi.participacao.registroAdministrativo?.irregularidades, ["conta_desativada"]);

  // O cumprimento permanece (decisão de Marcus) e o saldo não muda; o jogo não é alterado.
  assert.equal(await cumprimentos(), 1);
  const [lista] = await ok<{ id: string; jogosCumpridos: number; jogosRestantes: number }[]>(request("GET", `/campeonatos/${campeonato}/suspensoes?atletaId=${pedro.id}`, presidente.cookie));
  assert.deepEqual([lista.jogosCumpridos, lista.jogosRestantes], [1, 1]);
  const resultado = await prisma.jogo.findUniqueOrThrow({ where: { id: jogo }, select: { status: true, resultado: true, inscricaoClubeVencedorId: true } });
  assert.deepEqual(resultado, { status: "finalizado", resultado: "normal", inscricaoClubeVencedorId: null });
  assert.deepEqual((await historico(pedro.id)).jogos.map(j => [j.registroAdministrativo, j.irregularidades]), [[true, ["suspensao"]]]);
});

test("suspensão automática anulada não vira irregularidade; estorno anterior da arbitragem não é repetição do presidente", async () => {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const campeonato = await campeonatoCom([a, b]);
  const [joao, carla] = [await cadastrar("atleta", { clubeId: a, nome: "João" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" })];

  // Jogo 1: vermelho com relatório para João gera suspensão automática de 1 jogo, cumprida no jogo 2.
  const jogo1 = await agendar(campeonato, a, b);
  const arbitro1 = await arbitrar(jogo1);
  const pJoao = (await credenciar(jogo1, arbitro1, joao.id, 7)).participacaoId;
  await iniciar(jogo1, arbitro1);
  await entrar(jogo1, arbitro1, joao.id);
  const vermelho = await lancar(jogo1, arbitro1, pJoao, "cartaoVermelho", true);
  await encerrar(jogo1, arbitro1);
  const automatica = await prisma.suspensao.findFirstOrThrow({ where: { jogoOrigemId: jogo1, atletaId: joao.id }, select: { id: true } });

  // Jogo 2: Carla credenciada e estornada pela arbitragem durante a partida.
  const jogo2 = await agendar(campeonato, a, b);
  const arbitro2 = await arbitrar(jogo2);
  await credenciar(jogo2, arbitro2, carla.id, 8);
  await iniciar(jogo2, arbitro2);
  const estornoArbitragem = await ok<Estorno>(request("POST", `${ARBITRAGEM}/${jogo2}/credenciamentos/${carla.id}/estorno`, arbitro2, { numeroCamisa: 8 }));
  assert.deepEqual([estornoArbitragem.alterado, estornoArbitragem.estorno.presidenteId], [true, null]);
  await encerrar(jogo2, arbitro2);
  assert.equal(await prisma.cumprimentoSuspensao.count({ where: { suspensaoId: automatica.id, jogoId: jogo2 } }), 1);

  // Vermelho anulado no jogo 1: a suspensão automática é anulada e o registro de João no jogo 2 fica sem irregularidades.
  await anularLancamento(jogo1, vermelho.id);
  assert.ok((await prisma.suspensao.findUniqueOrThrow({ where: { id: automatica.id } })).anuladaEm);
  const registro = await ok<Registro>(registrar(jogo2, joao.id, 7));
  assert.deepEqual(registro.participacao.registroAdministrativo?.irregularidades, []);

  // O estorno da arbitragem não é devolvido como repetição do presidente.
  await recusa(estornar(jogo2, carla.id, 8), 409, /não está credenciado/);
});

test("vínculo no início do jogo define o clube; sem vínculo, sem início, camisa ocupada e não presidente são recusados", async () => {
  const { a, b, campeonato, jogo, pedro, bruno } = await cenario();
  const c = await criarClube("Clube C");
  const forasteiro = await cadastrar("atleta", { clubeId: c, nome: "Forasteiro" });
  await recusa(registrar(jogo, forasteiro.id, 30), 409, /não tinha vínculo/);
  await recusa(registrar(jogo, pedro.id, 7), 409, /camisa 7 já está em uso/);

  // Pedro transferido depois do jogo continua registrado pelo clube A, do vínculo no início.
  assert.equal((await request("POST", `/atletas/${pedro.id}/transferencia`, presidente.cookie, { clubeAtualId: a, clubeDestinoId: c })).status, 200);
  const registro = await ok<Registro>(registrar(jogo, pedro.id, 30));
  const inscricaoA = (await prisma.jogo.findUniqueOrThrow({ where: { id: jogo }, select: { inscricaoClubeAId: true } })).inscricaoClubeAId;
  assert.equal(registro.participacao.inscricaoId, inscricaoA);

  // Só presidente; arbitragem e atleta não fazem correções administrativas.
  for (const [cookie, status] of [["", 401], [bruno.cookie, 403]] as const) {
    await recusa(registrar(jogo, pedro.id, 31, true, cookie), status);
    await recusa(anularEntrada(jogo, bruno.id, cookie), status);
    await recusa(estornar(jogo, bruno.id, 9, cookie), status);
    await recusa(request("GET", PRESIDENCIA(jogo), cookie), status);
  }
  await recusa(request("POST", `${PRESIDENCIA(jogo)}/administrativos`, presidente.cookie, { atletaId: pedro.id, numeroCamisa: 1 }), 400);
  await recusa(request("POST", `${PRESIDENCIA(jogo)}/${bruno.id}/entrada/anulacao`, presidente.cookie, { motivo: "x" }), 400);
  await recusa(registrar(randomUUID(), pedro.id, 1), 404);

  // W.O. sem início: não há participação a registrar.
  const wo = await agendar(campeonato, b, a);
  const arbitroWo = await arbitrar(wo);
  const inscricoes = await prisma.jogo.findUniqueOrThrow({ where: { id: wo }, select: { inscricaoClubeAId: true } });
  await ok(request("POST", `${ARBITRAGEM}/${wo}/encerramento`, arbitroWo, { resultado: "wo", vencedorInscricaoId: inscricoes.inscricaoClubeAId }));
  await recusa(registrar(wo, bruno.id, 40), 409, /sem início/);

  // Jogo em andamento: as correções seguem com a arbitragem.
  const { jogo: andamento, joao } = await cenario({ encerrado: false });
  await recusa(anularEntrada(andamento, joao.id), 409, /somente após o encerramento/);
  await recusa(estornar(andamento, joao.id, 7), 409, /somente após o encerramento/);

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const rota of ["/jogos/{jogoId}/credenciamentos/administrativos", "/jogos/{jogoId}/credenciamentos/{atletaId}/entrada/anulacao", "/jogos/{jogoId}/credenciamentos/{atletaId}/estorno"]) {
    assert.ok(contrato.paths[rota]?.post, rota);
  }
  assert.ok(contrato.paths["/jogos/{jogoId}/credenciamentos"]?.get);
});

test("relatório disciplinar transferido de João para Pedro move a suspensão automática; as correções simultâneas se serializam", async () => {
  const { a, b, campeonato } = await (async () => {
    const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
    return { a, b, campeonato: await campeonatoCom([a, b]) };
  })();
  const [joao, pedro] = [await cadastrar("atleta", { clubeId: a, nome: "João" }), await cadastrar("atleta", { clubeId: a, nome: "Pedro" })];
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo);
  const pJoao = (await credenciar(jogo, arbitro, joao.id, 7)).participacaoId;
  await iniciar(jogo, arbitro);
  await entrar(jogo, arbitro, joao.id);
  const vermelho = await lancar(jogo, arbitro, pJoao, "cartaoVermelho", true);
  await encerrar(jogo, arbitro);
  const automaticas = () => prisma.suspensao.findMany({ where: { jogoOrigemId: jogo }, select: { atletaId: true, anuladaEm: true }, orderBy: { aplicadaEm: "asc" } });
  assert.deepEqual((await automaticas()).map(s => [s.atletaId, s.anuladaEm]), [[joao.id, null]]);

  // Dois registros simultâneos da mesma participação: um grava, o outro devolve o mesmo registro.
  const simultaneos = await Promise.all([ok<Registro>(registrar(jogo, pedro.id, 17)), ok<Registro>(registrar(jogo, pedro.id, 17))]);
  assert.deepEqual(simultaneos.map(r => r.alterado).sort(), [false, true]);
  const pPedro = simultaneos[0].participacao.participacaoId;
  assert.equal(await prisma.participacao.count({ where: { jogoId: jogo, atletaId: pedro.id } }), 1);

  const transferido = await transferir(jogo, vermelho.id, pPedro, "cartaoVermelho", true);
  assert.equal(transferido.suspensoesAutomaticas.criadas.length, 1);
  assert.equal(transferido.suspensoesAutomaticas.anuladas.length, 1);
  const depois = await automaticas();
  assert.deepEqual(depois.map(s => [s.atletaId, s.anuladaEm === null]), [[joao.id, false], [pedro.id, true]]);

  // Anulação da entrada e estorno simultâneos de João: um caminho só termina com o estorno feito e histórico único.
  await ok(anularEntrada(jogo, joao.id));
  const estornos = await Promise.all([estornar(jogo, joao.id, 7), estornar(jogo, joao.id, 7)]);
  const corpos = await Promise.all(estornos.map(async r => { assert.equal(r.status, 200, await r.clone().text()); return r.json() as Promise<Estorno>; }));
  assert.deepEqual(corpos.map(c => c.alterado).sort(), [false, true]);
  assert.equal(await prisma.alteracaoCredenciamento.count({ where: { jogoId: jogo, tipo: "estorno" } }), 1);
});
