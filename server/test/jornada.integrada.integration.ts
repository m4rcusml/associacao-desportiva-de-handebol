import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const app = await createApp();
const prisma = app.get(PrismaService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
const password = "Senha-ficticia-jornada-2026";
const emails: string[] = [];
const clubes: string[] = [];
const campeonatos: string[] = [];
const sockets: Socket[] = [];
const origin = process.env.CLIENT_ORIGIN!;
let servidor: string;
let presidente: { id: string; cookie: string };

const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };
function request(method: "GET" | "POST" | "PUT", path: string, cookie = "", body?: unknown) {
  return fetch(`${servidor}/api${path}`, {
    method,
    headers: { Origin: origin, "X-Forwarded-For": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
      ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function ok<T = { alterado: boolean }>(response: Promise<Response>, status = 200): Promise<T> {
  const r = await response;
  assert.equal(r.status, status, await r.clone().text());
  return r.json();
}
async function recusa(response: Promise<Response>, status: number) {
  const r = await response;
  assert.equal(r.status, status, await r.text());
}
async function login(email: string) {
  const r = await request("POST", "/auth/sign-in/email", "", { email, password });
  assert.equal(r.status, 200, await r.clone().text());
  return r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}
async function cadastrar(perfil: "atleta" | "tecnico", clubeId?: string) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // O limite de cadastro por IP é exercitado na suíte de autenticação.
  const { usuario } = await ok<{ usuario: { id: string } }>(request("POST", "/cadastros", "", {
    nomeCompleto: `Pessoa Fictícia ${perfil}`, email, password, perfil, ...(clubeId ? { clubeId } : {}),
  }), 201);
  return { id: usuario.id, cookie: await login(email) };
}
const aprovar = (id: string) => ok(request("POST", `/verificacoes/${id}/aprovacao`, presidente.cookie, {}));
async function clube(nome: string) {
  const { id } = await ok<{ id: string }>(request("POST", "/clubes", presidente.cookie, { nome }), 201);
  clubes.push(id);
  return id;
}
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function jogo(campeonato: string, clubeAId: string, clubeBId: string) {
  return ok<{ id: string; clubeA: { inscricaoId: string } }>(request("POST", `/campeonatos/${campeonato}/jogos`, presidente.cookie, {
    clubeAId, clubeBId, inicioPrevisto: `${hoje()}T12:00`, fusoHorario: "America/Recife",
  }), 201);
}
async function arbitrar(jogoId: string, nomeCompleto: string) {
  const { senha } = await ok<{ senha: string }>(request("GET", `/jogos/${jogoId}/arbitragem/senha`, presidente.cookie));
  const r = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, "", { nomeCompleto, senha });
  assert.equal(r.status, 201, await r.clone().text());
  return r.headers.getSetCookie().find(c => c.startsWith(`handebol.arbitragem.${jogoId}=`))!.split(";")[0];
}
type Evento = { id: string; jogoId: string; tipo: string; referenciaId: string | null };
async function dispositivo(jogoId: string, cookie: string) {
  // Mesmo transporte da implantação de teste; dois clientes reais, sem frontend.
  const socket = io(servidor, { path: "/api/socket.io", auth: { jogoId }, transports: ["polling"],
    reconnection: false, forceNew: true, timeout: 5000, extraHeaders: { Origin: origin, Cookie: cookie } });
  sockets.push(socket);
  const eventos: Evento[] = [];
  let motivo: string | undefined;
  socket.on("jogo:evento", (evento: Evento) => eventos.push(evento));
  socket.on("acesso:encerrado", (aviso: { motivo: string }) => { motivo = aviso.motivo; });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  return { socket, eventos, motivo: () => motivo };
}
async function ate(condicao: () => boolean, mensagem: string) {
  const limite = Date.now() + 5000;
  while (!condicao()) {
    assert.ok(Date.now() < limite, mensagem);
    await esperar(20);
  }
}
type Participacao = { participacaoId: string; escalado: boolean; credenciado: boolean; entrouEmQuadra: boolean; metricas: { gols: number; cartoesVermelhos: number } | null };
type Historico = { atleta: { clubeAtual: { id: string } }; totais: { gols: number; cartoesVermelhos: number }; jogos: (Participacao & { clube: { clube: { id: string } } })[] };
type Suspensao = { origem: string; jogosCumpridos: number; jogosRestantes: number; cumprimentos: { jogoId: string }[] };

before(async () => {
  await app.listen(0, "127.0.0.1");
  servidor = await app.getUrl();
  // Única preparação fora da API: identidade administrativa restrita (CLI coberta em presidentes.integration.ts).
  const email = novoEmail();
  const authId = randomUUID();
  const id = randomUUID();
  const hash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente da jornada", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: hash } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente da jornada", perfil: "presidente", presidente: { create: {} } } });
  });
  presidente = { id, cookie: await login(email) };
});

after(async () => {
  for (const socket of sockets) socket.close();
  try {
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
  } finally {
    await app.close();
  }
});

test("jornada HTTP/banco/polling: aprovação, escalação, QR, rollback, reenvios, disciplina, encerramento e histórico", { timeout: 60_000 }, async () => {
  const [a, b] = [await clube("Clube A da jornada"), await clube("Clube B da jornada")];
  const atleta = await cadastrar("atleta", a);
  await ok(request("POST", `/verificacoes/${atleta.id}/rejeicao`, presidente.cookie, {}));
  await recusa(request("GET", "/protegida/aprovado", atleta.cookie), 403);
  assert.equal(await prisma.carteirinha.count({ where: { atletaId: atleta.id } }), 0);
  await ok(request("POST", "/verificacoes/solicitacao", atleta.cookie, {}));
  await aprovar(atleta.id);
  const card = await ok<{ id: string; tokenQr: string; versaoQr: number }>(request("GET", `/carteirinhas/atleta/${atleta.id}`, presidente.cookie));

  const antigo = await cadastrar("tecnico");
  const novo = await cadastrar("tecnico");
  for (const tecnico of [antigo, novo]) await aprovar(tecnico.id);
  await ok(request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: antigo.id }));
  const { id: campeonato } = await ok<{ id: string }>(request("POST", "/campeonatos", presidente.cookie, { nome: "Copa da jornada", edicao: "2026", categoria: "Adulto" }), 201);
  campeonatos.push(campeonato);
  for (const clubeId of [a, b]) await ok(request("POST", `/campeonatos/${campeonato}/inscricoes`, presidente.cookie, { clubeId }), 201);
  await ok(request("POST", `/campeonatos/${campeonato}/iniciar`, presidente.cookie));
  const partida = await jogo(campeonato, a, b);
  const rota = `/arbitragem/jogos/${partida.id}`;
  await ok(request("POST", `/jogos/${partida.id}/escalacao`, antigo.cookie, { atletaId: atleta.id }));
  const antes = await ok<{ participacoes: Participacao[] }>(request("GET", `/jogos/${partida.id}/desempenho`, antigo.cookie));
  assert.deepEqual([antes.participacoes[0].escalado, antes.participacoes[0].credenciado, antes.participacoes[0].entrouEmQuadra, antes.participacoes[0].metricas], [true, false, false, null]);
  await ok(request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: novo.id, substituirTecnicoId: antigo.id }));
  await recusa(request("POST", `/jogos/${partida.id}/escalacao`, antigo.cookie, { atletaId: atleta.id }), 403);
  await ok(request("POST", `/jogos/${partida.id}/escalacao`, novo.cookie, { atletaId: atleta.id }));
  await recusa(request("POST", `/atletas/${atleta.id}/transferencia`, presidente.cookie, { clubeAtualId: a, clubeDestinoId: b }), 409);

  const [linhaCookie, bancoCookie] = [await arbitrar(partida.id, "Árbitra Linha"), await arbitrar(partida.id, "Árbitro Banco")];
  const [linha, banco] = [await dispositivo(partida.id, linhaCookie), await dispositivo(partida.id, bancoCookie)];
  await ok(request("PUT", `${rota}/visualizacao`, bancoCookie, { visualizacao: "banco" }));
  const { participacao } = await ok<{ participacao: Participacao }>(request("POST", `${rota}/credenciamentos`, linhaCookie, { tokenQr: card.tokenQr, numeroCamisa: 7 }));
  const substituida = await ok<{ carteirinha: { id: string; tokenQr: string } }>(request("POST", `/carteirinhas/atleta/${atleta.id}/substituicao-qr`, presidente.cookie, { versaoQr: card.versaoQr }));
  assert.equal(substituida.carteirinha.id, card.id);
  await recusa(request("POST", `${rota}/credenciamentos`, bancoCookie, { tokenQr: card.tokenQr, numeroCamisa: 7 }), 404);
  assert.equal((await ok(request("POST", `${rota}/credenciamentos`, bancoCookie, { tokenQr: substituida.carteirinha.tokenQr, numeroCamisa: 7 }))).alterado, false);
  await ok(request("POST", `${rota}/inicio`, linhaCookie));
  await ok(request("POST", `${rota}/credenciamentos/${atleta.id}/entrada`, bancoCookie));

  // Falha diferida: o controller já gravou lançamento e outbox, mas o commit inteiro deve ser revertido.
  const operacaoId = randomUUID();
  const gol = { operacaoId, tipo: "gol", participacaoId: participacao.participacaoId };
  await prisma.$executeRawUnsafe(`CREATE FUNCTION falhar_jornada_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."operacaoId" = '${operacaoId}'::uuid THEN RAISE EXCEPTION 'Falha simulada no commit da jornada'; END IF; RETURN NULL; END $$`);
  try {
    await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER falhar_jornada_teste AFTER INSERT ON "LancamentoJogo" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION falhar_jornada_teste()');
    try {
      await recusa(request("POST", `${rota}/lancamentos`, linhaCookie, gol), 500);
      assert.equal(await prisma.lancamentoJogo.count({ where: { operacaoId } }), 0);
      assert.equal(await prisma.eventoJogo.count({ where: { jogoId: partida.id, tipo: "lancamento_registrado" } }), 0);
      const visto = await ok<{ placar: { placarClubeA: number } }>(request("GET", `/jogos/${partida.id}/desempenho`, novo.cookie));
      assert.equal(visto.placar.placarClubeA, 0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER falhar_jornada_teste ON "LancamentoJogo"');
    }
  } finally {
    await prisma.$executeRawUnsafe("DROP FUNCTION falhar_jornada_teste()");
  }
  const repetidos = await Promise.all([linhaCookie, bancoCookie].map(c => ok<{ alterado: boolean; lancamento: { id: string } }>(request("POST", `${rota}/lancamentos`, c, gol))));
  assert.deepEqual(repetidos.map(r => r.alterado).sort(), [false, true]);
  assert.equal(repetidos[0].lancamento.id, repetidos[1].lancamento.id);
  const golId = repetidos[0].lancamento.id;
  await recusa(request("POST", `${rota}/lancamentos`, bancoCookie, { ...gol, tipo: "cartaoAmarelo" }), 409);
  await ok(request("POST", `${rota}/lancamentos`, bancoCookie, { operacaoId: randomUUID(), tipo: "cartaoVermelho", relatorioDisciplinar: true, participacaoId: participacao.participacaoId }));
  await ate(() => [linha, banco].every(c => c.eventos.filter(e => e.tipo === "lancamento_registrado").length >= 2), "dois dispositivos recebem os lançamentos confirmados");
  const persistidos = await prisma.eventoJogo.findMany({ where: { jogoId: partida.id, tipo: "lancamento_registrado" }, orderBy: { id: "asc" } });
  assert.equal(persistidos.length, 2, "rollback, conflito e reenvio não criam eventos extras");
  for (const c of [linha, banco]) {
    const eventos = c.eventos.filter(e => e.tipo === "lancamento_registrado");
    assert.deepEqual(new Set(eventos.map(e => e.id)), new Set(persistidos.map(e => e.id.toString())));
    assert.ok(eventos.some(e => e.referenciaId === golId));
  }
  await ok(request("POST", `${rota}/encerramento`, linhaCookie, { resultado: "normal", vencedorInscricaoId: partida.clubeA.inscricaoId }));
  await ate(() => [linha, banco].every(c => c.motivo() === "jogo_encerrado" && !c.socket.connected), "encerramento revoga ambos os dispositivos");
  await recusa(request("POST", `${rota}/lancamentos`, bancoCookie, { ...gol, operacaoId: randomUUID() }), 401);
  assert.equal((await ok(request("POST", `${rota}/encerramento`, linhaCookie, { resultado: "normal", vencedorInscricaoId: partida.clubeA.inscricaoId }))).alterado, false);

  // Automática e manual correm em paralelo: o W.O. seguinte cumpre ambas uma única vez.
  await ok(request("POST", `/campeonatos/${campeonato}/suspensoes`, presidente.cookie, { atletaId: atleta.id, quantidadeJogos: 1, motivo: "Decisão disciplinar fictícia" }), 201);
  const seguinte = await jogo(campeonato, a, b);
  const arbitro = await arbitrar(seguinte.id, "Árbitra W.O.");
  await recusa(request("POST", `/arbitragem/jogos/${seguinte.id}/credenciamentos`, arbitro, { atletaId: atleta.id, numeroCamisa: 7 }), 409);
  const fim = { resultado: "wo", vencedorInscricaoId: seguinte.clubeA.inscricaoId };
  await ok(request("POST", `/arbitragem/jogos/${seguinte.id}/encerramento`, arbitro, fim));
  assert.equal((await ok(request("POST", `/arbitragem/jogos/${seguinte.id}/encerramento`, arbitro, fim))).alterado, false);
  const suspensoes = await ok<Suspensao[]>(request("GET", `/campeonatos/${campeonato}/suspensoes?atletaId=${atleta.id}`, presidente.cookie));
  assert.deepEqual(suspensoes.map(s => s.origem).sort(), ["automatica", "manual"]);
  for (const s of suspensoes) assert.deepEqual([s.jogosCumpridos, s.jogosRestantes, s.cumprimentos.map(c => c.jogoId)], [1, 0, [seguinte.id]]);
  const wo = await ok<{ placar: { placarClubeA: number; placarClubeB: number } }>(request("GET", `/jogos/${seguinte.id}/desempenho`, novo.cookie));
  assert.deepEqual([wo.placar.placarClubeA, wo.placar.placarClubeB], [0, 0]);
  await ok(request("POST", `/campeonatos/${campeonato}/encerrar`, presidente.cookie));
  await ok(request("POST", `/atletas/${atleta.id}/transferencia`, presidente.cookie, { clubeAtualId: a, clubeDestinoId: b }));
  const historico = await ok<Historico>(request("GET", `/atletas/${atleta.id}/historico`, atleta.cookie));
  assert.deepEqual([historico.atleta.clubeAtual.id, historico.totais.gols, historico.totais.cartoesVermelhos], [b, 1, 1]);
  assert.equal(historico.jogos.length, 1);
  assert.equal(historico.jogos[0].clube.clube.id, a, "histórico preserva o clube representado");
  assert.deepEqual([historico.jogos[0].escalado, historico.jogos[0].credenciado, historico.jogos[0].entrouEmQuadra], [true, true, true]);
});
