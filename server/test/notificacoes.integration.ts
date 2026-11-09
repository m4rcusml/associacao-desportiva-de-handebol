import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { io as conectar, type Socket } from "socket.io-client";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
// Varredura curta: prova o reprocessamento sem NOTIFY e a retirada de acessos expirados sem esperar 30 s.
process.env.NOTIFICACOES_VARREDURA_MS = "400";
const { createApp } = await import("../dist/app.js");
const { PrismaService } = await import("../dist/infrastructure/prisma.service.js");
const { registrarEvento } = await import("../dist/modules/notificacoes/eventos.js");
const { NotificacoesService } = await import("../dist/modules/notificacoes/notificacoes.service.js");
const { AuthService } = await import("../dist/modules/autenticacao/auth.service.js");
const { hashToken } = await import("../dist/modules/arbitragem/senha.js");
type Banco = InstanceType<typeof PrismaService>;

const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let servidor: string;
let base: string;
const password = "Senha-local-de-teste-2026";
const emails: string[] = [];
const clubes: string[] = [];
const campeonatos: string[] = [];
const clientes: Socket[] = [];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };
const FUSO = "America/Recife";

type Metodo = "GET" | "POST" | "PUT" | "DELETE";
const request = (method: Metodo, path: string, cookie = "", body?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: { Origin: origin, "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const cookies = (response: Response) => response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
async function ok<T>(response: Promise<Response>, status = 200): Promise<T> {
  const resolvida = await response;
  assert.equal(resolvida.status, status, await resolvida.clone().text());
  return resolvida.json();
}
async function criarPresidente() {
  const email = novoEmail();
  const authId = randomUUID();
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente das notificações", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente das notificações", perfil: "presidente", presidente: { create: {} } } });
  });
  throttler.onApplicationShutdown();
  return { id, email, cookie: cookies(await request("POST", "/auth/sign-in/email", "", { email, password })) };
}
let presidente: Awaited<ReturnType<typeof criarPresidente>>;

async function cadastrar(clubeId: string, nome: string) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
  const { usuario } = await ok<{ usuario: { id: string } }>(request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil: "atleta", clubeId }), 201);
  await ok(request("POST", `/verificacoes/${usuario.id}/aprovacao`, presidente.cookie, {}));
  const response = await request("POST", "/auth/sign-in/email", "", { email, password });
  assert.equal(response.status, 200);
  return { id: usuario.id, cookie: cookies(response) };
}
async function criarClube(nome: string) {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
const dataLocal = (dias = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + dias * 86_400_000));
const cookieDe = (response: Response, jogoId: string) => response.headers.getSetCookie().find(c => c.startsWith(`handebol.arbitragem.${jogoId}=`))!.split(";")[0];

/** Jogo de hoje com Ana (A) credenciada, arbitragem por senha e por designação (conta de clube neutro). */
async function cenario() {
  const [a, b] = [await criarClube("Clube A"), await criarClube("Clube B")];
  const { id: campeonato } = await ok<{ id: string }>(request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato das notificações", edicao: "2026", categoria: "Adulto" }), 201);
  campeonatos.push(campeonato);
  for (const clubeId of [a, b]) await ok(request("POST", `/campeonatos/${campeonato}/inscricoes`, presidente.cookie, { clubeId }), 201);
  const { id: jogo } = await ok<{ id: string }>(request("POST", `/campeonatos/${campeonato}/jogos`, presidente.cookie, { clubeAId: a, clubeBId: b, inicioPrevisto: `${dataLocal()}T12:00`, fusoHorario: FUSO }), 201);
  const { senha } = await ok<{ senha: string }>(request("GET", `/jogos/${jogo}/arbitragem/senha`, presidente.cookie));
  throttler.onApplicationShutdown();
  const entradaSenha = await request("POST", `/arbitragem/jogos/${jogo}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
  assert.equal(entradaSenha.status, 201);
  const porSenha = cookieDe(entradaSenha, jogo);
  const neutro = await criarClube("Clube neutro");
  const designado = await cadastrar(neutro, "Árbitro Designado");
  await ok(request("POST", `/jogos/${jogo}/arbitragens`, presidente.cookie, { usuarioId: designado.id }), 201);
  const entradaDesignacao = await request("POST", `/arbitragem/jogos/${jogo}/entrada/designacao`, designado.cookie, {});
  assert.equal(entradaDesignacao.status, 201);
  const { arbitragem } = await entradaDesignacao.clone().json() as { arbitragem: { id: string } };
  const porDesignacao = cookieDe(entradaDesignacao, jogo);
  const ana = await cadastrar(a, "Ana");
  const { participacao } = await ok<{ participacao: { participacaoId: string } }>(request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, porSenha, { atletaId: ana.id, numeroCamisa: 7 }));
  return { jogo, a, neutro, porSenha, porDesignacao, designado, arbitragemDesignada: arbitragem.id, pAna: participacao.participacaoId };
}

type Evento = { id: string; jogoId: string; tipo: string; referenciaId: string | null; ocorridoEm: string };
type Registro = { tipo: "evento"; evento: Evento } | { tipo: "encerrado"; motivo: string };
interface Cliente { socket: Socket; registros: Registro[]; eventos: (tipo?: string) => Evento[]; encerrado: () => string | undefined }

/** Cliente Socket.IO automatizado (sem frontend); registra a ordem de eventos e do aviso de encerramento. */
function cliente(jogoId: unknown, cookie: string, origem = origin): Cliente {
  const socket = conectar(servidor, {
    path: "/api/socket.io", auth: { jogoId }, transports: ["websocket"], reconnection: false, forceNew: true,
    extraHeaders: { Origin: origem, ...(cookie ? { Cookie: cookie } : {}) },
  });
  clientes.push(socket);
  const registros: Registro[] = [];
  socket.on("jogo:evento", (evento: Evento) => registros.push({ tipo: "evento", evento }));
  socket.on("acesso:encerrado", ({ motivo }: { motivo: string }) => registros.push({ tipo: "encerrado", motivo }));
  return {
    socket, registros,
    eventos: tipo => registros.flatMap(r => r.tipo === "evento" && (!tipo || r.evento.tipo === tipo) ? [r.evento] : []),
    encerrado: () => registros.flatMap(r => r.tipo === "encerrado" ? [r.motivo] : [])[0],
  };
}
async function conectado(jogoId: string, cookie: string) {
  const c = cliente(jogoId, cookie);
  await new Promise<void>((resolve, reject) => { c.socket.once("connect", resolve); c.socket.once("connect_error", reject); });
  return c;
}
async function recusado(jogoId: unknown, cookie: string, origem = origin) {
  const c = cliente(jogoId, cookie, origem);
  return new Promise<Error & { data?: { motivo?: string } }>((resolve, reject) => {
    c.socket.once("connect", () => reject(new Error("conexão deveria ser recusada")));
    c.socket.once("connect_error", resolve);
  });
}
async function ate(condicao: () => boolean, descricao: string, limite = 5000) {
  const fim = Date.now() + limite;
  while (!condicao()) {
    if (Date.now() > fim) assert.fail(`Tempo esgotado: ${descricao}`);
    await esperar(20);
  }
}
/** Encerrado e desconectado pelo servidor, sem nenhum evento depois do aviso. */
async function retirado(c: Cliente, motivo: string) {
  await ate(() => c.encerrado() !== undefined && !c.socket.connected, `aviso ${motivo} e desconexão`);
  assert.equal(c.encerrado(), motivo);
  assert.equal(c.registros.at(-1)?.tipo, "encerrado", "nenhum evento depois do encerramento");
}
const lancar = (jogo: string, cookie: string, participacaoId: string) =>
  ok<{ lancamento: { id: string } }>(request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, cookie, { operacaoId: randomUUID(), tipo: "temp_gol", participacaoId }));
const iniciar = (jogo: string, cookie: string) => ok(request("POST", `/arbitragem/jogos/${jogo}/inicio`, cookie));

before(async () => {
  await app.listen(0, "127.0.0.1");
  servidor = await app.getUrl();
  base = `${servidor}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  for (const socket of clientes) socket.close();
  await prisma.$transaction(async tx => {
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

test("handshake exige origem do cliente, jogoId e sessão temporária válida daquele jogo", async () => {
  const { jogo, porSenha, designado } = await cenario();
  const outro = await cenario();
  assert.equal((await recusado(jogo, "")).message, "acesso_indisponivel");
  assert.equal((await recusado(jogo, `handebol.arbitragem.${jogo}=%`)).message, "acesso_indisponivel", "cookie malformado não derruba a API");
  assert.equal((await recusado(jogo, presidente.cookie)).message, "acesso_indisponivel", "conta permanente não assina");
  assert.equal((await recusado(jogo, designado.cookie)).message, "acesso_indisponivel", "conta designada sem cookie temporário");
  assert.equal((await recusado(jogo, outro.porSenha.replace(outro.jogo, jogo))).message, "acesso_indisponivel", "cookie de outro jogo");
  assert.equal((await recusado("nao-uuid", porSenha)).message, "jogo_invalido");
  assert.equal((await recusado(undefined, porSenha)).message, "jogo_invalido");
  await recusado(jogo, porSenha, "http://outro-site.invalid");
  const valido = await conectado(jogo.toUpperCase(), porSenha);
  assert.equal(valido.socket.connected, true);
  const contrato = await ok<{ "x-socketio": { path: string; eventosDoServidor: Record<string, unknown> } }>(request("GET", "/openapi.json"));
  assert.equal(contrato["x-socketio"].path, "/api/socket.io");
  assert.deepEqual(Object.keys(contrato["x-socketio"].eventosDoServidor).sort(), ["acesso:encerrado", "jogo:evento"]);
});

test("dois dispositivos recebem o aviso mínimo depois do commit; rollback e operação recusada não geram evento", async () => {
  const { jogo, porSenha, porDesignacao, pAna } = await cenario();
  const [linha, banco] = [await conectado(jogo, porSenha), await conectado(jogo, porDesignacao)];
  await iniciar(jogo, porSenha);
  await ate(() => banco.eventos("jogo_iniciado").length === 1 && linha.eventos("jogo_iniciado").length === 1, "jogo_iniciado nos dois dispositivos");

  // Transação revertida com o evento já inserido: nem linha nem NOTIFY.
  const fantasma = randomUUID();
  await assert.rejects(prisma.$transaction(async tx => {
    await registrarEvento(tx, jogo, "lancamento_registrado", fantasma);
    throw new Error("rollback de teste");
  }), /rollback de teste/);
  // Operação recusada pela API (participação inexistente) também não grava evento.
  assert.equal((await request("POST", `/arbitragem/jogos/${jogo}/lancamentos`, porSenha, { operacaoId: randomUUID(), tipo: "temp_gol", participacaoId: randomUUID() })).status, 404);

  const { lancamento } = await lancar(jogo, porDesignacao, pAna);
  await ate(() => linha.eventos("lancamento_registrado").length === 1 && banco.eventos("lancamento_registrado").length === 1, "lancamento_registrado nos dois");
  for (const c of [linha, banco]) {
    const [evento] = c.eventos("lancamento_registrado");
    assert.deepEqual(Object.keys(evento).sort(), ["id", "jogoId", "ocorridoEm", "referenciaId", "tipo"], "somente o aviso mínimo, sem dados");
    assert.deepEqual([evento.jogoId, evento.referenciaId], [jogo, lancamento.id]);
    assert.equal(c.eventos().some(e => e.referenciaId === fantasma), false, "rollback não publica");
  }
  assert.equal(linha.eventos("lancamento_registrado")[0].id, banco.eventos("lancamento_registrado")[0].id, "mesmo id nos dois dispositivos");
  const gravados = await prisma.eventoJogo.findMany({ where: { jogoId: jogo }, orderBy: { id: "asc" } });
  assert.deepEqual(gravados.map(e => e.tipo), ["credenciamento_registrado", "jogo_iniciado", "lancamento_registrado"]);
  assert.ok(gravados.every(e => e.referenciaId !== fantasma));

  // Repetição sem alteração não gera evento novo; mudança de visualização avisa os outros dispositivos.
  await ok(request("POST", `/arbitragem/jogos/${jogo}/inicio`, porSenha));
  await ok(request("PUT", `/arbitragem/jogos/${jogo}/visualizacao`, porDesignacao, { visualizacao: "banco" }));
  await ok(request("PUT", `/arbitragem/jogos/${jogo}/visualizacao`, porDesignacao, { visualizacao: "banco" }));
  await ate(() => banco.eventos("visualizacao_alterada").length === 1, "visualizacao_alterada");
  await esperar(300);
  assert.equal(await prisma.eventoJogo.count({ where: { jogoId: jogo, tipo: { in: ["jogo_iniciado", "visualizacao_alterada"] } } }), 2);
  const pendentes = () => prisma.eventoJogo.count({ where: { jogoId: jogo, publicadoEm: null } });
  const fim = Date.now() + 3000;
  while (await pendentes() > 0 && Date.now() < fim) await esperar(50);
  assert.equal(await pendentes(), 0, "eventos marcados como publicados");
});

test("troca de senha retira só os dispositivos por senha, com motivo; os designados continuam recebendo", async () => {
  const { jogo, porSenha, porDesignacao, pAna } = await cenario();
  await iniciar(jogo, porSenha);
  const [senha, designacao] = [await conectado(jogo, porSenha), await conectado(jogo, porDesignacao)];
  await ok(request("POST", `/jogos/${jogo}/arbitragem/senha/troca`, presidente.cookie));
  await retirado(senha, "troca_senha");
  const { lancamento } = await lancar(jogo, porDesignacao, pAna);
  await ate(() => designacao.eventos("lancamento_registrado").some(e => e.referenciaId === lancamento.id), "designação recebe após a troca");
  assert.equal(designacao.socket.connected, true);
  assert.equal((await recusado(jogo, porSenha)).message, "acesso_indisponivel", "sessão trocada não reconecta");
});

test("revogação concorrente com lançamentos: nada chega depois do aviso e nenhum evento se perde para quem continua", async () => {
  const { jogo, porSenha, porDesignacao, pAna } = await cenario();
  await iniciar(jogo, porSenha);
  const [senha, designacao] = [await conectado(jogo, porSenha), await conectado(jogo, porDesignacao)];
  const lancamentos = Array.from({ length: 12 }, () => lancar(jogo, porDesignacao, pAna));
  const troca = ok(request("POST", `/jogos/${jogo}/arbitragem/senha/troca`, presidente.cookie));
  const ids = (await Promise.all(lancamentos)).map(r => r.lancamento.id);
  await troca;
  await retirado(senha, "troca_senha");
  await ate(() => designacao.eventos("lancamento_registrado").length === 12, "12 lançamentos para quem continua autorizado");
  assert.deepEqual(new Set(designacao.eventos("lancamento_registrado").map(e => e.referenciaId)), new Set(ids));
  const recebidosPelaSenha = senha.eventos("lancamento_registrado");
  assert.ok(recebidosPelaSenha.every(e => ids.includes(e.referenciaId!)), "só eventos confirmados enquanto autorizado");
});

test("envio mantém a autorização até emitir, mesmo se outra conexão estiver bloqueada", async () => {
  const { jogo, porSenha, porDesignacao, designado } = await cenario();
  // Reproduz a publicação de um evento já confirmado, isolada da varredura do app.
  const evento = await prisma.eventoJogo.findFirstOrThrow({ where: { jogoId: jogo } });
  let publicado = false;
  let revogou = false;
  let validou!: () => void;
  const primeiraValidada = new Promise<void>(resolve => { validou = resolve; });
  const banco = {
    $queryRaw: async () => publicado ? [] : [{ ...evento, id: evento.id.toString() }],
    $executeRaw: async () => { publicado = true; },
    $transaction: async (operacao: Parameters<Banco["$transaction"]>[0]) => {
      const resultado = await prisma.$transaction(operacao);
      validou();
      return resultado;
    },
  };
  const envios: { token: string; aposRevogacao: boolean }[] = [];
  const conexoes = [porSenha, porDesignacao].map(cookie => {
    const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
    return { data: { jogoId: jogo, token }, emit: (tipo: string) => {
      if (tipo === "jogo:evento") envios.push({ token, aposRevogacao: revogou });
    }, disconnect: () => undefined };
  });
  const publicador = new NotificacoesService(banco as unknown as Banco, app.get(AuthService)) as unknown as {
    io: { in: () => { fetchSockets: () => Promise<typeof conexoes> } };
    publicarPendentes: () => Promise<void>;
  };
  publicador.io = { in: () => ({ fetchSockets: async () => conexoes }) };
  let liberou!: () => void;
  let bloqueou!: (pid: number) => void;
  const liberar = new Promise<void>(resolve => { liberou = resolve; });
  const bloqueada = new Promise<number>(resolve => { bloqueou = resolve; });
  const bloqueio = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${designado.id}::uuid FOR UPDATE`;
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    bloqueou(pid);
    await liberar;
  }, { timeout: 15_000 });
  const pid = await bloqueada;
  const publicacao = publicador.publicarPendentes();
  try {
    await primeiraValidada;
    let aguardando = false;
    const limite = Date.now() + 5_000;
    while (!aguardando && Date.now() < limite) {
      const [estado] = await prisma.$queryRaw<{ aguardando: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS aguardando`;
      aguardando = estado.aguardando;
      if (!aguardando) await esperar(10);
    }
    assert.equal(aguardando, true, "a validação da segunda conexão aguarda o bloqueio real da conta");
    await prisma.$executeRaw`
      UPDATE "SessaoArbitragem" SET "revogadaEm" = now(), "motivoRevogacao" = 'troca_senha'
      WHERE "tokenHash" = ${hashToken(conexoes[0].data.token)}`;
    revogou = true;
  } finally {
    liberou();
    await Promise.all([bloqueio, publicacao]);
  }
  const enviadosPorSenha = envios.filter(envio => envio.token === conexoes[0].data.token);
  assert.equal(enviadosPorSenha.length, 1);
  assert.equal(enviadosPorSenha[0].aposRevogacao, false, "nenhum envio usa autorização anterior à revogação confirmada");
  assert.equal(publicado, true);
});

test("retirada da designação, logout e desativação da conta de origem desconectam o dispositivo designado", async () => {
  const retirada = await cenario();
  const c1 = await conectado(retirada.jogo, retirada.porDesignacao);
  const porSenha1 = await conectado(retirada.jogo, retirada.porSenha);
  await ok(request("DELETE", `/jogos/${retirada.jogo}/arbitragens/${retirada.arbitragemDesignada}`, presidente.cookie));
  await retirado(c1, "acesso_indisponivel");
  assert.equal(porSenha1.socket.connected, true, "acesso por senha não depende da designação");

  const logout = await cenario();
  const c2 = await conectado(logout.jogo, logout.porDesignacao);
  await ok(request("POST", "/auth/sign-out", logout.designado.cookie, {}));
  await retirado(c2, "acesso_indisponivel");

  const desativacao = await cenario();
  const c3 = await conectado(desativacao.jogo, desativacao.porDesignacao);
  await ok(request("POST", `/contas/${desativacao.designado.id}/desativacao`, presidente.cookie, {}));
  await retirado(c3, "acesso_indisponivel");
});

test("adiamento, cancelamento e encerramento retiram todas as conexões abertas com o motivo da sessão", async () => {
  const adiado = await cenario();
  const a = [await conectado(adiado.jogo, adiado.porSenha), await conectado(adiado.jogo, adiado.porDesignacao)];
  await ok(request("POST", `/jogos/${adiado.jogo}/adiamento`, presidente.cookie, { inicioPrevisto: `${dataLocal(1)}T12:00` }));
  for (const c of a) await retirado(c, "jogo_adiado");

  const cancelado = await cenario();
  const b = [await conectado(cancelado.jogo, cancelado.porSenha), await conectado(cancelado.jogo, cancelado.porDesignacao)];
  await ok(request("POST", `/jogos/${cancelado.jogo}/cancelamento`, presidente.cookie));
  for (const c of b) await retirado(c, "jogo_cancelado");

  const encerrado = await cenario();
  await iniciar(encerrado.jogo, encerrado.porSenha);
  const c = [await conectado(encerrado.jogo, encerrado.porSenha), await conectado(encerrado.jogo, encerrado.porDesignacao)];
  await ok(request("POST", `/arbitragem/jogos/${encerrado.jogo}/encerramento`, encerrado.porSenha, { resultado: "normal", vencedorInscricaoId: null }));
  for (const cliente of c) {
    await retirado(cliente, "jogo_encerrado");
    assert.equal(cliente.eventos("jogo_encerrado").length, 0, "o aviso do encerramento não chega a sessões já revogadas");
  }
  assert.equal(await prisma.eventoJogo.count({ where: { jogoId: encerrado.jogo, tipo: "jogo_encerrado" } }), 1);
  for (const { jogo, porSenha } of [adiado, cancelado, encerrado]) assert.equal((await recusado(jogo, porSenha)).message, "acesso_indisponivel");
});

test("reconexão, reprocessamento de evento pendente e revogação sem NOTIFY retirada pela varredura", async () => {
  const { jogo, a, neutro, porSenha, porDesignacao, designado, pAna } = await cenario();
  await iniciar(jogo, porSenha);

  // Reconexão: o evento ocorrido durante a queda não é reenviado; o estado oficial vem da API REST.
  const primeira = await conectado(jogo, porDesignacao);
  primeira.socket.close();
  const { lancamento: perdido } = await lancar(jogo, porDesignacao, pAna);
  const reconectado = await conectado(jogo, porDesignacao);
  const { lancamentos } = await ok<{ lancamentos: { id: string }[] }>(request("GET", `/arbitragem/jogos/${jogo}/lancamentos`, porDesignacao));
  assert.ok(lancamentos.some(l => l.id === perdido.id), "estado oficial recuperado por REST após reconectar");
  const { lancamento: novo } = await lancar(jogo, porDesignacao, pAna);
  await ate(() => reconectado.eventos("lancamento_registrado").some(e => e.referenciaId === novo.id), "evento após reconectar");

  // Reprocessamento: evento confirmado e não publicado (sem NOTIFY) é enviado pela varredura, com o mesmo id.
  const [evento] = await prisma.eventoJogo.findMany({ where: { jogoId: jogo, referenciaId: novo.id } });
  await prisma.$executeRaw`UPDATE "EventoJogo" SET "publicadoEm" = NULL WHERE id = ${evento.id}`;
  await ate(() => reconectado.eventos("lancamento_registrado").filter(e => e.referenciaId === novo.id).length === 2, "reenvio pela varredura");
  assert.deepEqual(new Set(reconectado.eventos("lancamento_registrado").filter(e => e.referenciaId === novo.id).map(e => e.id)), new Set([evento.id.toString()]), "repetição identificável pelo id");

  // Conta designada transferida para um clube do jogo (vínculo impeditivo): nenhum trigger notifica; a varredura
  // revalida e retira a conexão sem novo evento, enquanto o acesso por senha continua.
  const senha = await conectado(jogo, porSenha);
  await ok(request("POST", `/atletas/${designado.id}/transferencia`, presidente.cookie, { clubeAtualId: neutro, clubeDestinoId: a }));
  await retirado(reconectado, "acesso_indisponivel");
  assert.equal(senha.socket.connected, true);
});
