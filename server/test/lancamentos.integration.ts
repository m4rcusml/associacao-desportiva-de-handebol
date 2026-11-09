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
import { consultarLancamentos, registrarLancamento } from "../dist/modules/resultados/lancamentos.js";

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
    await tx.authUser.create({ data: { id: authId, name: "Presidente dos lançamentos", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente dos lançamentos", perfil: "presidente", presidente: { create: {} } } });
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
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato dos lançamentos", edicao: "2026", categoria: "Adulto" });
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
/** Fixture: o endpoint de início vem na MAR-69. */
const iniciarJogo = (jogoId: string) => prisma.jogo.update({ where: { id: jogoId }, data: { status: "em_andamento", iniciadoEm: new Date() } });

type Pessoa = { id: string; nomeCompleto: string };
type Lancamento = { id: string; operacaoId: string; tipo: string; valor: number; registradoEm: string; participacaoId: string; inscricaoId: string; atleta: Pessoa; numeroCamisa: number };
type Placar = { clubeA: { inscricaoId: string; clube: { id: string } }; temp_placarClubeA: number; clubeB: { inscricaoId: string; clube: { id: string } }; temp_placarClubeB: number };
type Resultado = { lancamento: Lancamento; alterado: boolean; placar: Placar };
type Desempenho = { participacaoId: string; inscricaoId: string; atleta: Pessoa; numeroCamisa: number; temp_gols: number; temp_cartoesAmarelos: number; temp_exclusoesDoisMinutos: number; temp_cartoesVermelhos: number };
type Registros = { jogo: { id: string; status: string }; placar: Placar | null; desempenho: Desempenho[]; lancamentos: Lancamento[] };

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
const credenciar = async (jogo: string, cookie: string, atletaId: string, numeroCamisa: number) =>
  (await ok<{ participacao: { participacaoId: string } }>(request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, cookie, { atletaId, numeroCamisa }))).participacao.participacaoId;
const lancar = (jogo: string, cookie: string, body: unknown) => request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, cookie, body);
const lancamento = (participacaoId: string, tipo = "temp_gol", operacaoId: string = randomUUID()) => ({ operacaoId, tipo, participacaoId });
const registros = (jogo: string, cookie: string) => ok<Registros>(request("GET", `/arbitragem/jogos/${jogo}/lancamentos`, cookie));
const resumo = (r: Pick<Registros, "placar" | "desempenho">) => ({
  placar: r.placar && [r.placar.temp_placarClubeA, r.placar.temp_placarClubeB],
  desempenho: Object.fromEntries(r.desempenho.map(d => [d.atleta.nomeCompleto, [d.temp_gols, d.temp_cartoesAmarelos, d.temp_exclusoesDoisMinutos, d.temp_cartoesVermelhos]])),
});

/** Dois clubes inscritos, Ana (A) e Bruno (B) credenciados, Carla (A) sem credenciamento e sessão de arbitragem. */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const campeonato = await campeonatoCom([a, b]);
  const jogo = await agendar(campeonato, a, b);
  const arbitro = await arbitrar(jogo);
  const [ana, bruno, carla] = [await cadastrar("atleta", { clubeId: a, nome: "Ana" }), await cadastrar("atleta", { clubeId: b, nome: "Bruno" }), await cadastrar("atleta", { clubeId: a, nome: "Carla" })];
  const pAna = await credenciar(jogo, arbitro, ana.id, 7);
  const pBruno = await credenciar(jogo, arbitro, bruno.id, 9);
  return { a, b, campeonato, jogo, arbitro, ana, bruno, carla, pAna, pBruno };
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Jogos levam lançamentos, participações, arbitragens e sessões em cascata.
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

test("gol identifica o atleta credenciado e soma ao clube da participação; penalidades só no desempenho", async () => {
  const { a, b, jogo, arbitro, carla, pAna, pBruno } = await cenario();

  // Carla é escalada pelo técnico, mas não credenciada.
  const tecnico = await cadastrar("tecnico", { nome: "Técnico A" });
  assert.equal((await request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: tecnico.id })).status, 200);
  assert.equal((await request("POST", `/jogos/${jogo}/escalacao`, tecnico.cookie, { atletaId: carla.id })).status, 200);
  const pCarla = (await prisma.participacao.findFirstOrThrow({ where: { jogoId: jogo, atletaId: carla.id } })).id;

  // Antes do início: desempenho dos credenciados zerado, sem placar, e nenhum lançamento aceito.
  assert.deepEqual(resumo(await registros(jogo, arbitro)), { placar: null, desempenho: { Ana: [0, 0, 0, 0], Bruno: [0, 0, 0, 0] } });
  await recusa(lancar(jogo, arbitro, lancamento(pAna)), 409, /jogo em andamento/);

  await iniciarJogo(jogo);
  const inicial = await registros(jogo, arbitro);
  assert.deepEqual([inicial.placar?.clubeA.clube.id, inicial.placar?.clubeB.clube.id, resumo(inicial).placar], [a, b, [0, 0]]);

  const gol = await ok(lancar(jogo.toUpperCase(), arbitro, lancamento(pAna.toUpperCase())));
  assert.equal(gol.alterado, true);
  assert.deepEqual([gol.lancamento.tipo, gol.lancamento.valor, gol.lancamento.atleta.nomeCompleto, gol.lancamento.numeroCamisa, gol.lancamento.participacaoId], ["temp_gol", 1, "Ana", 7, pAna]);
  assert.equal(gol.lancamento.inscricaoId, inicial.placar!.clubeA.inscricaoId, "clube derivado da participação");
  assert.deepEqual([gol.placar.temp_placarClubeA, gol.placar.temp_placarClubeB], [1, 0]);

  for (const [p, tipo] of [[pAna, "temp_gol"], [pBruno, "temp_gol"], [pAna, "temp_cartaoAmarelo"], [pBruno, "temp_exclusaoDoisMinutos"], [pBruno, "temp_exclusaoDoisMinutos"], [pBruno, "temp_cartaoVermelho"]] as const) {
    assert.equal((await ok(lancar(jogo, arbitro, lancamento(p, tipo)))).alterado, true);
  }
  const atual = await registros(jogo, arbitro);
  assert.deepEqual(resumo(atual), { placar: [2, 1], desempenho: { Ana: [2, 1, 0, 0], Bruno: [1, 0, 2, 1] } });
  assert.equal(atual.lancamentos.length, 7);
  assert.deepEqual(atual.lancamentos[0], gol.lancamento, "consulta preserva o contrato do lançamento, inclusive a data ISO");
  assert.deepEqual(atual.lancamentos.map(l => l.atleta.nomeCompleto), ["Ana", "Ana", "Bruno", "Ana", "Bruno", "Bruno", "Bruno"], "ordem de registro");

  // Atleta não credenciado (escalado ou não), participação de outro jogo ou inexistente.
  const outroJogo = await agendar((await prisma.jogo.findUniqueOrThrow({ where: { id: jogo } })).campeonatoId, b, a);
  const pCarlaOutro = await credenciar(outroJogo, await arbitrar(outroJogo), carla.id, 3);
  await recusa(lancar(jogo, arbitro, lancamento(pCarlaOutro)), 404, /Participação não encontrada/);
  await recusa(lancar(jogo, arbitro, lancamento(randomUUID())), 404);
  await recusa(lancar(jogo, arbitro, lancamento(pCarla)), 409, /Somente atleta credenciado/);
  await recusa(lancar(jogo, arbitro, lancamento(pCarla, "temp_cartaoVermelho")), 409, /Somente atleta credenciado/);

  // Corpo inválido: tipo fora da lista temp_, valor ou clube informados, identificadores ausentes.
  for (const body of [{}, { tipo: "temp_gol", participacaoId: pAna }, { operacaoId: randomUUID(), participacaoId: pAna }, { ...lancamento(pAna), tipo: "gol" },
    { ...lancamento(pAna), valor: 2 }, { ...lancamento(pAna), inscricaoClubeId: inicial.placar!.clubeA.inscricaoId }, { ...lancamento(pAna), operacaoId: "x" }]) {
    await recusa(lancar(jogo, arbitro, body), 400);
  }
  assert.equal(await prisma.lancamentoJogo.count({ where: { jogoId: jogo } }), 7);

  // O banco repete as regras: somente inclusão, valor positivo, participação obrigatória e credenciada no mesmo jogo.
  const primeiro = atual.lancamentos[0];
  await assert.rejects(prisma.lancamentoJogo.update({ where: { id: primeiro.id }, data: { tipo: "temp_cartaoAmarelo" } }));
  await assert.rejects(prisma.lancamentoJogo.delete({ where: { id: primeiro.id } }));
  const direto = (data: Partial<{ participacaoId: string | null; valor: number; jogoId: string }>) =>
    prisma.lancamentoJogo.create({ data: { operacaoId: randomUUID(), jogoId: jogo, participacaoId: pAna, tipo: "temp_gol", registradoEm: new Date(), ...data } });
  await assert.rejects(direto({ valor: 0 }));
  await assert.rejects(direto({ participacaoId: null }));
  await assert.rejects(direto({ participacaoId: pCarlaOutro }));
  await assert.rejects(direto({ participacaoId: pCarla }), "escalada sem credenciamento");
  await assert.rejects(direto({ jogoId: outroJogo }), "jogo agendado não recebe lançamento");
  assert.deepEqual(resumo(await registros(jogo, arbitro)).placar, [2, 1]);
});

test("transferência posterior ao credenciamento não muda o clube do gol (RN-008/036)", async () => {
  const { a, b, jogo, arbitro, ana, pAna } = await cenario();
  await iniciarJogo(jogo);
  // Campeonato ainda planejado: a transferência é permitida e não reescreve a participação.
  await prisma.$transaction(tx => transferirAtleta(tx, ana.id, presidente.id, { clubeAtualId: a, clubeDestinoId: b }));
  const gol = await ok(lancar(jogo, arbitro, lancamento(pAna)));
  assert.deepEqual([gol.placar.temp_placarClubeA, gol.placar.temp_placarClubeB], [1, 0]);
});

test("reenvio da mesma operação não duplica; conteúdo diferente com o mesmo identificador é conflito", async () => {
  const { a, b, campeonato, jogo, arbitro, carla, pAna, pBruno } = await cenario();
  await iniciarJogo(jogo);
  const operacaoId = randomUUID();
  const primeiro = await ok(lancar(jogo, arbitro, lancamento(pAna, "temp_gol", operacaoId)));
  const reenvio = await ok(lancar(jogo, arbitro, lancamento(pAna, "temp_gol", operacaoId.toUpperCase())));
  assert.deepEqual([reenvio.alterado, reenvio.lancamento.id, reenvio.lancamento.registradoEm, reenvio.placar.temp_placarClubeA], [false, primeiro.lancamento.id, primeiro.lancamento.registradoEm, 1]);

  await recusa(lancar(jogo, arbitro, lancamento(pAna, "temp_cartaoAmarelo", operacaoId)), 409, /operacaoId já usado/);
  await recusa(lancar(jogo, arbitro, lancamento(pBruno, "temp_gol", operacaoId)), 409, /operacaoId já usado/);
  const outroJogo = await agendar(campeonato, b, a);
  const arbitroOutro = await arbitrar(outroJogo);
  const pCarla = await credenciar(outroJogo, arbitroOutro, carla.id, 1);
  await iniciarJogo(outroJogo);
  await recusa(lancar(outroJogo, arbitroOutro, lancamento(pCarla, "temp_gol", operacaoId)), 409, /operacaoId já usado/);
  const registro = await prisma.lancamentoJogo.findUniqueOrThrow({ where: { operacaoId } });
  assert.deepEqual([registro.jogoId, registro.participacaoId, registro.tipo], [jogo, pAna, "temp_gol"], "original não é sobrescrito");

  // A mesma operação enviada várias vezes em paralelo grava uma vez.
  const paralela = randomUUID();
  const respostas = await Promise.all(Array.from({ length: 5 }, () => lancar(jogo, arbitro, lancamento(pBruno, "temp_gol", paralela))));
  assert.deepEqual(respostas.map(r => r.status), [200, 200, 200, 200, 200]);
  assert.deepEqual((await Promise.all(respostas.map(r => r.json() as Promise<Resultado>))).map(r => r.alterado).sort(), [false, false, false, false, true]);
  assert.equal(await prisma.lancamentoJogo.count({ where: { operacaoId: paralela } }), 1);
  assert.deepEqual(resumo(await registros(jogo, arbitro)).placar, [1, 1]);
});

test("gols paralelos de vários dispositivos são todos preservados e os totais coincidem", async () => {
  const { jogo, arbitro, pAna, pBruno } = await cenario();
  await iniciarJogo(jogo);
  const outroDispositivo = await arbitrar(jogo);
  const pedidos = Array.from({ length: 24 }, (_, i) => lancar(jogo, i % 2 ? arbitro : outroDispositivo, lancamento(i % 3 ? pAna : pBruno, i % 4 === 3 ? "temp_cartaoAmarelo" : "temp_gol")));
  const respostas = await Promise.all(pedidos);
  assert.deepEqual(new Set(respostas.map(r => r.status)), new Set([200]));

  const esperado = { ana: { gols: 0, amarelos: 0 }, bruno: { gols: 0, amarelos: 0 } };
  for (let i = 0; i < 24; i++) {
    const quem = i % 3 ? esperado.ana : esperado.bruno;
    if (i % 4 === 3) quem.amarelos++; else quem.gols++;
  }
  const final = await registros(jogo, arbitro);
  assert.equal(final.lancamentos.length, 24);
  assert.deepEqual(resumo(final), {
    placar: [esperado.ana.gols, esperado.bruno.gols],
    desempenho: { Ana: [esperado.ana.gols, esperado.ana.amarelos, 0, 0], Bruno: [esperado.bruno.gols, esperado.bruno.amarelos, 0, 0] },
  });
  // Placar coincide com o desempenho somado por clube (RNF-006).
  const porClube = new Map<string, number>();
  for (const d of final.desempenho) porClube.set(d.inscricaoId, (porClube.get(d.inscricaoId) ?? 0) + d.temp_gols);
  assert.deepEqual([porClube.get(final.placar!.clubeA.inscricaoId), porClube.get(final.placar!.clubeB.inscricaoId)], [final.placar!.temp_placarClubeA, final.placar!.temp_placarClubeB]);
});

test("falha na transação desfaz o lançamento sem deixar totais parciais", async () => {
  const { jogo, arbitro, pAna } = await cenario();
  await iniciarJogo(jogo);
  const token = decodeURIComponent(arbitro.split("=")[1]);
  const operacaoId = randomUUID();
  await assert.rejects(prisma.$transaction(async tx => {
    const resultado = await registrarLancamento(tx, jogo, token, { operacaoId, tipo: "temp_gol", participacaoId: pAna });
    assert.equal(resultado.placar?.temp_placarClubeA, 1, "dentro da transação o placar já inclui o gol");
    throw new Error("falha depois de gravar");
  }), /falha depois de gravar/);
  assert.equal(await prisma.lancamentoJogo.count({ where: { operacaoId } }), 0);
  assert.deepEqual(resumo(await registros(jogo, arbitro)), { placar: [0, 0], desempenho: { Ana: [0, 0, 0, 0], Bruno: [0, 0, 0, 0] } });
  // A mesma operação pode ser reenviada depois da falha.
  assert.equal((await ok(lancar(jogo, arbitro, lancamento(pAna, "temp_gol", operacaoId)))).alterado, true);
});

test("consulta mantém placar, desempenho e lançamentos no mesmo estado durante gol concorrente", async () => {
  const { jogo, arbitro, pAna } = await cenario();
  await iniciarJogo(jogo);
  let gravou = false;
  const consulta = await prisma.$transaction(async tx => {
    const interceptado = new Proxy(tx, {
      get(target, propriedade) {
        if (propriedade === "$queryRaw") return async (...args: unknown[]) => {
          const resultado = await Reflect.apply(target.$queryRaw, target, args);
          // Confirma outro gol depois da leitura dos dados, antes de a consulta montar sua resposta.
          if (!gravou && String(args[0]).includes("DesempenhoDoAtleta")) {
            gravou = true;
            await ok(lancar(jogo, arbitro, lancamento(pAna)));
          }
          return resultado;
        };
        const valor = Reflect.get(target, propriedade);
        return typeof valor === "function" ? valor.bind(target) : valor;
      },
    });
    return consultarLancamentos(interceptado, jogo, decodeURIComponent(arbitro.split("=")[1]));
  });
  assert.equal(gravou, true, "o gol confirma enquanto a consulta ainda está em curso");
  assert.deepEqual(resumo(consulta), { placar: [0, 0], desempenho: { Ana: [0, 0, 0, 0], Bruno: [0, 0, 0, 0] } });
  assert.equal(consulta.lancamentos.length, 0);
  const depois = await registros(jogo, arbitro);
  assert.deepEqual(resumo(depois), { placar: [1, 0], desempenho: { Ana: [1, 0, 0, 0], Bruno: [0, 0, 0, 0] } });
  assert.equal(depois.lancamentos.length, 1);
});

test("somente a arbitragem autorizada do jogo lança; encerramento concorrente impede a gravação", async () => {
  const { campeonato, a, b, jogo, arbitro, ana, pAna } = await cenario();
  await iniciarJogo(jogo);
  const outroJogo = await agendar(campeonato, b, a);
  const doOutro = await arbitrar(outroJogo);
  for (const cookie of ["", presidente.cookie, ana.cookie, doOutro, doOutro.replace(nomeCookie(outroJogo), nomeCookie(jogo))]) {
    await recusa(lancar(jogo, cookie, lancamento(pAna)), 401);
    await recusa(request("GET", `/arbitragem/jogos/${jogo}/lancamentos`, cookie), 401);
  }
  await recusa(request("GET", "/arbitragem/jogos/nao-uuid/lancamentos", arbitro), 400);

  // Saída encerra a sessão deste dispositivo.
  const temporario = await arbitrar(jogo);
  assert.equal((await request("POST", `/arbitragem/jogos/${jogo}/saida`, temporario)).status, 200);
  await recusa(lancar(jogo, temporario, lancamento(pAna)), 401);

  // Encerramento em curso: o lançamento aguarda o commit e é recusado; nada é gravado.
  const operacaoId = randomUUID();
  let pedido: Promise<Response> | undefined;
  await prisma.$transaction(async tx => {
    await tx.jogo.update({ where: { id: jogo }, data: { status: "finalizado", encerradoEm: new Date() } });
    pedido = lancar(jogo, arbitro, lancamento(pAna, "temp_gol", operacaoId));
    await esperar(300);
  });
  await recusa(pedido!, 403, /finalizado/);
  assert.equal(await prisma.lancamentoJogo.count({ where: { jogoId: jogo } }), 0);
  await assert.rejects(prisma.lancamentoJogo.create({ data: { operacaoId, jogoId: jogo, participacaoId: pAna, tipo: "temp_gol", registradoEm: new Date() } }), "banco recusa com o jogo finalizado");

  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const metodo of ["get", "post"]) assert.ok(contrato.paths["/arbitragem/jogos/{jogoId}/lancamentos"]?.[metodo], metodo);
});
