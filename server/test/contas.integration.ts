import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { carteirinhaFicticia } from "./support/carteirinha.ts";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { alterarAtivacao, bloquearAtivacao, contaAtiva } from "../dist/modules/contas/contas.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let base: string;
const password = "Senha-local-de-teste-2026";
const clubeId = randomUUID();
const emails: string[] = [];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

const request = (path: string, cookie = "", body?: unknown, requestOrigin: string | null = origin) => fetch(`${base}${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { ...(requestOrigin ? { Origin: requestOrigin } : {}), "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const status = async (path: string, cookie = "", body?: unknown) => (await request(path, cookie, body)).status;
async function login(email: string) {
  const response = await request("/auth/sign-in/email", "", { email, password });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}
async function cadastrar(perfil: "atleta" | "tecnico") {
  const email = `${randomUUID()}@example.invalid`;
  emails.push(email);
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("/cadastros", "", { nomeCompleto: "Pessoa Fictícia", email, password, perfil, ...(perfil === "atleta" ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  return { id: (await response.json()).usuario.id as string, email };
}
const desativar = (cookie: string, usuarioId: string) => request(`/contas/${usuarioId}/desativacao`, cookie, {});
const reativar = (cookie: string, usuarioId: string) => request(`/contas/${usuarioId}/reativacao`, cookie, {});
const sessoes = async (usuarioId: string) => prisma.authSession.count({ where: { userId: (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).authId } });
const ativo = async (usuarioId: string) => (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).ativo;

const presidentes = { a: { id: randomUUID(), email: `${randomUUID()}@example.invalid` }, b: { id: randomUUID(), email: `${randomUUID()}@example.invalid` } };

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  const ativosComAcesso = await prisma.usuario.findMany({ where: { perfil: "presidente", ativo: true }, select: { authId: true } });
  assert.equal(await prisma.authAccount.count({ where: { userId: { in: ativosComAcesso.map(a => a.authId) }, providerId: "credential" } }), 0,
    "O banco de teste não pode conter presidente ativo com credencial antes desta suíte");
  const hash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    for (const { id, email } of Object.values(presidentes)) {
      emails.push(email);
      const authId = randomUUID();
      await tx.authUser.create({ data: { id: authId, name: "Presidente de teste", email } });
      await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: hash } });
      await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente de teste", perfil: "presidente", presidente: { create: {} } } });
    }
    await tx.clube.create({ data: { id: clubeId, nome: "Clube fictício de contas", criadoPorPresidenteId: presidentes.a.id } });
  });
});

after(async () => {
  await prisma.$transaction(async tx => {
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = (await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id);
    await tx.vinculoClube.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.carteirinha.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.atleta.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.tecnico.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.clube.deleteMany({ where: { id: clubeId } });
    await tx.presidente.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
  });
  await app.close();
});

test("desativação revoga sessões e bloqueia login; histórico preservado; reativação exige novo login", async () => {
  const presidente = await login(presidentes.a.email);
  const atleta = await cadastrar("atleta");
  const tecnico = await cadastrar("tecnico");
  const aprovado = { statusVerificacao: "aprovado" as const, verificadoPorPresidenteId: presidentes.a.id, verificadoEm: new Date() };
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { ...aprovado, ...carteirinhaFicticia(presidentes.a.id) } });
  await prisma.tecnico.update({ where: { usuarioId: tecnico.id }, data: { ...aprovado, clubeId } });
  const cookieAtleta = await login(atleta.email);
  const dispositivosTecnico = [await login(tecnico.email), await login(tecnico.email)];
  assert.equal(await status(`/protegida/clubes/${clubeId}`, cookieAtleta), 200);

  for (const conta of [atleta, tecnico]) {
    const response = await desativar(presidente, conta.id);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { usuario: { id: conta.id, perfil: conta === atleta ? "atleta" : "tecnico", ativo: false }, alterado: true });
    assert.equal(await sessoes(conta.id), 0);
  }
  // Sessões já abertas deixam de valer, inclusive todos os dispositivos e a sessão técnica.
  for (const cookie of [cookieAtleta, ...dispositivosTecnico]) {
    assert.equal(await status("/protegida", cookie), 401);
    assert.equal(await status("/sessao", cookie), 401);
    assert.equal(await (await request("/auth/get-session", cookie)).json(), null);
  }
  assert.equal(await status(`/protegida/clubes/${clubeId}`, cookieAtleta), 401);
  for (const { email } of [atleta, tecnico]) assert.equal(await status("/auth/sign-in/email", "", { email, password }), 401);

  // Repetição informa que nada mudou; histórico, aprovação, vínculo e credencial preservados.
  assert.deepEqual(await (await desativar(presidente, atleta.id)).json(), { usuario: { id: atleta.id, perfil: "atleta", ativo: false }, alterado: false });
  const preservado = await prisma.usuario.findUniqueOrThrow({ where: { id: atleta.id }, include: { atleta: { include: { vinculos: true } } } });
  assert.equal(preservado.atleta?.statusVerificacao, "aprovado");
  assert.deepEqual(preservado.atleta?.vinculos.map(v => [v.clubeId, v.fim]), [[clubeId, null]]);
  assert.equal(await prisma.authAccount.count({ where: { userId: preservado.authId, providerId: "credential" } }), 1);
  assert.equal((await prisma.tecnico.findUniqueOrThrow({ where: { usuarioId: tecnico.id } })).clubeId, clubeId);

  // Reativação: a sessão antiga continua revogada; novo login restabelece acesso com o mesmo cadastro.
  for (const conta of [atleta, tecnico]) {
    const response = await reativar(presidente, conta.id);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).alterado, true);
  }
  assert.equal((await (await reativar(presidente, atleta.id)).json()).alterado, false);
  assert.equal(await status("/protegida", cookieAtleta), 401);
  const novoCookie = await login(atleta.email);
  assert.equal(await status(`/protegida/clubes/${clubeId}`, novoCookie), 200);
  const sessao = await (await request("/sessao", novoCookie)).json();
  assert.deepEqual([sessao.usuario.id, sessao.usuario.aprovado, sessao.usuario.clubeId], [atleta.id, true, clubeId]);
  // Técnico desativado e reativado continua atribuído ao clube (atribuição preparada direto no banco).
  const tecnicoReativado = await prisma.tecnico.findUniqueOrThrow({ where: { usuarioId: tecnico.id } });
  assert.deepEqual([tecnicoReativado.clubeId, tecnicoReativado.statusVerificacao], [clubeId, "aprovado"]);
  const cookieTecnico = await login(tecnico.email);
  assert.equal(await status("/protegida/aprovado", cookieTecnico), 200);
  assert.equal((await (await request("/sessao", cookieTecnico)).json()).usuario.clubeId, clubeId);
});

test("acesso indevido: sem sessão, atleta, técnico aprovado, própria conta, origem e entrada inválida", async () => {
  const presidente = await login(presidentes.a.email);
  const atleta = await cadastrar("atleta");
  const alvo = await cadastrar("atleta");
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { statusVerificacao: "aprovado", verificadoPorPresidenteId: presidentes.a.id, verificadoEm: new Date(), ...carteirinhaFicticia(presidentes.a.id) } });
  const tecnico = await cadastrar("tecnico");
  await prisma.tecnico.update({ where: { usuarioId: tecnico.id }, data: { statusVerificacao: "aprovado", verificadoPorPresidenteId: presidentes.a.id, verificadoEm: new Date() } });
  const cookieAtleta = await login(atleta.email);
  const cookieTecnico = await login(tecnico.email);

  for (const operacao of ["desativacao", "reativacao"]) {
    const path = `/contas/${alvo.id}/${operacao}`;
    assert.equal(await status(path, "", {}), 401);
    assert.equal(await status(path, cookieAtleta, {}), 403);
    assert.equal(await status(path, cookieTecnico, {}), 403);
    assert.equal((await request(path, presidente, {}, null)).status, 403);
    assert.equal(await status(path, presidente, { ativo: false }), 400);
    assert.equal(await status(`/contas/${presidentes.a.id}/${operacao}`, presidente, {}), 403);
    assert.equal(await status(`/contas/${presidentes.a.id.toUpperCase()}/${operacao}`, presidente, {}), 403);
    assert.equal(await status(`/contas/nao-uuid/${operacao}`, presidente, {}), 400);
    assert.equal(await status(`/contas/${randomUUID()}/${operacao}`, presidente, {}), 404);
  }
  assert.equal(await ativo(alvo.id), true);
  assert.equal(await ativo(presidentes.a.id), true);

  // Corpo ausente é aceito; atleta desativado perde o acesso com a mesma sessão.
  const semCorpo = await fetch(`${base}/contas/${atleta.id}/desativacao`, { method: "POST", headers: { Origin: origin, Cookie: presidente } });
  assert.equal(semCorpo.status, 200);
  assert.equal(await status("/protegida", cookieAtleta), 401);

  const contrato = await (await request("/openapi.json")).json();
  for (const operacao of ["desativacao", "reativacao"]) assert.ok(contrato.paths[`/contas/{usuarioId}/${operacao}`].post);
});

test("últimos dois presidentes desativados simultaneamente: exatamente um permanece ativo", async () => {
  const { a, b } = presidentes;
  for (let rodada = 0; rodada < 5; rodada++) {
    const [cookieA, cookieB] = [await login(a.email), await login(b.email)];
    const respostas = await Promise.all([desativar(cookieA, b.id), desativar(cookieB, a.id)]);
    assert.deepEqual(respostas.map(r => r.status).sort(), [200, 401], `rodada ${rodada}`);
    const [vencedor, perdedor, cookiePerdedor] = respostas[0].status === 200 ? [a, b, cookieB] : [b, a, cookieA];
    assert.equal(await ativo(vencedor.id), true);
    assert.equal(await ativo(perdedor.id), false);
    assert.equal(await prisma.usuario.count({ where: { id: { in: [a.id, b.id] }, ativo: true } }), 1);

    // O desativado não opera nem entra; o restante continua presidindo.
    assert.equal(await status("/presidentes", cookiePerdedor, { nomeCompleto: "Tentativa", email: `${randomUUID()}@example.invalid`, password }), 401);
    assert.equal(await status("/auth/sign-in/email", "", { email: perdedor.email, password }), 401);
    const cookieVencedor = await login(vencedor.email);
    assert.equal(await status("/protegida/presidente", cookieVencedor), 200);
    assert.equal(await status(`/contas/${perdedor.id}/reativacao`, cookieVencedor, {}), 200);
  }
});

test("último presidente com credencial nunca é desativado e checagem de conta ativa aguarda desativação concorrente", async () => {
  const { a, b } = presidentes;
  assert.equal(await status(`/contas/${b.id}/desativacao`, await login(a.email), {}), 200);

  // Regra no domínio, independente da origem: um presidente sem credencial (como o fictício do seed) não substitui o último.
  const semCredencial = randomUUID();
  await assert.rejects(prisma.$transaction(async tx => {
    await bloquearAtivacao(tx);
    await alterarAtivacao(tx, semCredencial, a.id, false);
  }), (error: { getStatus?: () => number }) => error.getStatus?.() === 409);
  assert.equal(await ativo(a.id), true);
  await prisma.$transaction(async tx => {
    assert.equal(await contaAtiva(tx, a.id), true);
    assert.equal(await contaAtiva(tx, b.id), false);
    assert.equal(await contaAtiva(tx, randomUUID()), false);
  });

  // Transação que conferiu a conta (ex.: futura arbitragem por designação) termina antes da desativação concorrente.
  const atleta = await cadastrar("atleta");
  let liberar!: () => void;
  let conferida!: () => void;
  const conferencia = new Promise<void>(resolve => { conferida = resolve; });
  const transacao = prisma.$transaction(async tx => {
    assert.equal(await contaAtiva(tx, atleta.id), true);
    conferida();
    await new Promise<void>(resolve => { liberar = resolve; });
  });
  await conferencia;
  let concluida = false;
  const desativacao = desativar(await login(a.email), atleta.id).then(r => { concluida = true; return r; });
  await esperar(300);
  assert.equal(concluida, false, "desativação deve aguardar a transação que conferiu a conta");
  liberar();
  await transacao;
  assert.equal((await desativacao).status, 200);
  await prisma.$transaction(async tx => assert.equal(await contaAtiva(tx, atleta.id), false));

  assert.equal(await status(`/contas/${b.id}/reativacao`, await login(a.email), {}), 200);
});

test("login concorrente não grava sessão após desativação, nem após desativação e reativação", async () => {
  const presidente = await login(presidentes.a.email);
  const atleta = await cadastrar("atleta");
  const { authId } = await prisma.usuario.findUniqueOrThrow({ where: { id: atleta.id } });

  // Barreira logo após a leitura da conta pelo hook de sessão do Better Auth (mesmo PrismaService da API).
  const delegate = prisma.usuario as unknown as { findUnique: (args: { where?: { authId?: string }; select?: { versaoAtivacao?: boolean } }) => Promise<unknown> };
  const original = delegate.findUnique;
  async function loginRetido(entreLeituraEInsercao: () => Promise<void>) {
    let lida!: () => void;
    let liberar!: () => void;
    const leitura = new Promise<void>(resolve => { lida = resolve; });
    const liberacao = new Promise<void>(resolve => { liberar = resolve; });
    delegate.findUnique = async function (this: unknown, args) {
      const resultado = await original.call(this, args);
      if (args.where?.authId === authId && args.select?.versaoAtivacao) { lida(); await liberacao; }
      return resultado;
    };
    try {
      const resposta = request("/auth/sign-in/email", "", { email: atleta.email, password });
      await leitura;
      await entreLeituraEInsercao();
      liberar();
      return await resposta;
    } finally {
      delegate.findUnique = original;
    }
  }

  const somenteDesativada = await loginRetido(async () => {
    assert.equal((await desativar(presidente, atleta.id)).status, 200);
  });
  // O banco recusa a gravação; o Better Auth responde erro interno (500) sem emitir sessão.
  assert.ok(somenteDesativada.status >= 400, String(somenteDesativada.status));
  assert.equal(await sessoes(atleta.id), 0);
  assert.equal(await status("/auth/sign-in/email", "", { email: atleta.email, password }), 401);
  assert.equal((await reativar(presidente, atleta.id)).status, 200);

  const desativadaEReativada = await loginRetido(async () => {
    assert.equal((await desativar(presidente, atleta.id)).status, 200);
    assert.equal((await reativar(presidente, atleta.id)).status, 200);
  });
  assert.ok(desativadaEReativada.status >= 400, String(desativadaEReativada.status));
  assert.equal(await sessoes(atleta.id), 0);
  assert.equal(await ativo(atleta.id), true);

  // Sessão gravada antes da desativação: a desativação aguarda o commit e a revoga.
  const { versaoAtivacao } = await prisma.usuario.findUniqueOrThrow({ where: { id: atleta.id } });
  let liberarInsercao!: () => void;
  let inserida!: () => void;
  const insercao = new Promise<void>(resolve => { inserida = resolve; });
  const transacao = prisma.$transaction(async tx => {
    await tx.authSession.create({ data: { id: randomUUID(), token: randomUUID(), userId: authId, expiresAt: new Date(Date.now() + 3_600_000), versaoAtivacao } });
    inserida();
    await new Promise<void>(resolve => { liberarInsercao = resolve; });
  });
  await insercao;
  let concluida = false;
  const desativacao = desativar(presidente, atleta.id).then(r => { concluida = true; return r; });
  await esperar(300);
  assert.equal(concluida, false, "desativação deve aguardar a sessão em gravação");
  liberarInsercao();
  await transacao;
  assert.equal((await desativacao).status, 200);
  assert.equal(await sessoes(atleta.id), 0);

  // Sessão com versão desatualizada ou sem versão é recusada pelo banco mesmo com a conta ativa.
  assert.equal((await reativar(presidente, atleta.id)).status, 200);
  for (const versao of [versaoAtivacao, null]) {
    await assert.rejects(prisma.authSession.create({ data: { id: randomUUID(), token: randomUUID(), userId: authId, expiresAt: new Date(Date.now() + 3_600_000), versaoAtivacao: versao } }));
  }
  assert.equal(await status("/protegida", await login(atleta.email)), 200);
});
