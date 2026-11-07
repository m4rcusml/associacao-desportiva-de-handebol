import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { AuthService } from "../dist/modules/autenticacao/auth.service.js";

const database = process.env.TEST_DATABASE_URL;
assert.ok(database, "Configure TEST_DATABASE_URL com banco dedicado terminado em _test");
assert.ok(new URL(database).pathname.endsWith("_test"), "Banco de integração deve terminar em _test");
assert.notEqual(new URL(database).pathname, new URL(process.env.DATABASE_URL!).pathname, "Não use o banco de desenvolvimento nos testes");
process.env.DATABASE_URL = database;
process.env.NODE_ENV = "test";
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
let base: string;
const clubeId = randomUUID();
const emails: string[] = [];
const password = "Senha-local-de-teste-2026";
const email = () => { const value = `${randomUUID()}@example.invalid`; emails.push(value); return value; };
const cadastro = (overrides = {}) => ({ nomeCompleto: "Pessoa Fictícia", email: email(), password, perfil: "tecnico", ...overrides });
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
// onApplicationShutdown é o único método público que limpa contadores e expirações do armazenamento em memória.
const zerarLimiteCadastro = () => throttler.onApplicationShutdown();
const ipAleatorio = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
// Por padrão, cada requisição simula um cliente distinto: zera o limite de cadastro (por IP do socket)
// e envia X-Forwarded-For próprio (IP usado pelo limite do Better Auth). Testes de limite passam `ip`.
const request = (path: string, body?: unknown, cookie = "", requestOrigin: string | null = origin, ip?: string) => {
  if (ip === undefined) zerarLimiteCadastro();
  return fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Forwarded-For": ip ?? ipAleatorio(), ...(requestOrigin === null ? {} : { Origin: requestOrigin }), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};
async function login(loginEmail: string) {
  const response = await request("/auth/sign-in/email", { email: loginEmail, password });
  assert.equal(response.status, 200, await response.clone().text());
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some(cookie => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
  assert.ok(cookies.every(cookie => !cookie.includes("session_data")), "cookieCache deve permanecer desligado");
  return cookies.map(cookie => cookie.split(";")[0]).join("; ");
}

before(async () => {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, stdio: "pipe" });
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  await prisma.usuario.create({ data: { id: clubeId, authId: `fixture-${clubeId}`, nomeCompleto: "Presidente de teste", perfil: "presidente", presidente: { create: {} } } });
  await prisma.clube.create({ data: { id: clubeId, nome: "Clube fictício de integração", criadoPorPresidenteId: clubeId } });
});

after(async () => {
  await prisma.$transaction(async tx => {
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const usuarios = await tx.usuario.findMany({ where: { authId: { in: identities.map(identity => identity.id) } }, select: { id: true } });
    const ids = usuarios.map(usuario => usuario.id);
    await tx.vinculoClube.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.atleta.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.tecnico.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
    await tx.clube.delete({ where: { id: clubeId } });
    await tx.presidente.delete({ where: { usuarioId: clubeId } });
    await tx.usuario.delete({ where: { id: clubeId } });
  });
  await app.close();
});

test("cadastro rejeita presidente, autoaprovação, ativo e vínculo de técnico", async () => {
  for (const input of [cadastro({ perfil: "presidente" }), cadastro({ statusVerificacao: "aprovado" }), cadastro({ ativo: true }), cadastro({ clubeId }), cadastro({ email: "a@b.c" }), cadastro({ perfil: "atleta" })]) {
    assert.equal((await request("/cadastros", input)).status, 400);
    assert.equal(await prisma.authUser.count({ where: { email: input.email } }), 0);
  }
  for (const path of ["/auth/sign-up/email", "/auth/update-user", "/auth/request-password-reset"]) {
    assert.equal((await request(path, cadastro())).status, 404);
  }
});

test("restrições do banco impedem extensão incompatível e aprovação sem presidente", async () => {
  const authId = randomUUID();
  await assert.rejects(prisma.usuario.create({ data: { authId, nomeCompleto: "Sem extensão", perfil: "tecnico" } }));
  assert.equal(await prisma.usuario.count({ where: { authId } }), 0);
  await assert.rejects(prisma.usuario.create({ data: { authId, nomeCompleto: "Perfil incompatível", perfil: "presidente", tecnico: { create: {} } } }));
  await assert.rejects(prisma.usuario.create({ data: { authId, nomeCompleto: "Atleta sem vínculo", perfil: "atleta", atleta: { create: {} } } }));
  await assert.rejects(prisma.usuario.create({ data: { authId, nomeCompleto: "Aprovação inválida", perfil: "tecnico", tecnico: { create: { statusVerificacao: "aprovado" } } } }));
  const original = await prisma.usuario.create({ data: { authId, nomeCompleto: "Origem", perfil: "tecnico", tecnico: { create: {} } } });
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const destino = await tx.usuario.create({ data: { authId: randomUUID(), nomeCompleto: "Destino", perfil: "tecnico" } });
      await tx.tecnico.update({ where: { usuarioId: original.id }, data: { usuarioId: destino.id } });
    }));
  } finally {
    await prisma.$transaction(async tx => {
      await tx.tecnico.delete({ where: { usuarioId: original.id } });
      await tx.usuario.delete({ where: { id: original.id } });
    });
  }
});

test("produção exige HTTPS e emite cookie Secure, HttpOnly e SameSite=Lax", async () => {
  const input = cadastro();
  assert.equal((await request("/cadastros", input)).status, 201);
  const previous = { NODE_ENV: process.env.NODE_ENV, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL, CLIENT_ORIGIN: process.env.CLIENT_ORIGIN };
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => new AuthService(prisma), /HTTPS/);
    process.env.BETTER_AUTH_URL = "https://api.handebol.example";
    process.env.CLIENT_ORIGIN = "https://handebol.example";
    const secure = new AuthService(prisma);
    const response = await secure.auth.handler(new Request("https://api.handebol.example/api/auth/sign-in/email", {
      method: "POST", headers: { Origin: process.env.CLIENT_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: input.email, password }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.ok(response.headers.getSetCookie().some(cookie => cookie.startsWith("__Secure-") && /; Secure/i.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
  } finally {
    Object.assign(process.env, previous);
  }
});

test("contrato OpenAPI publica somente os fluxos disponíveis", async () => {
  const response = await request("/openapi.json");
  assert.equal(response.status, 200);
  const contract = await response.json();
  assert.equal(contract.openapi, "3.1.0");
  assert.ok(contract.paths["/cadastros"].post.requestBody.content["application/json"].schema);
  assert.equal(contract.paths["/auth/sign-up/email"], undefined);
});

test("origem/CSRF e CORS: rejeita origem externa e ausente; aceita somente cliente", async () => {
  for (const invalidOrigin of ["https://evil.example", null]) {
    for (const path of ["/cadastros", "/auth/sign-in/email", "/auth/sign-out"]) {
      assert.equal((await request(path, cadastro(), "", invalidOrigin)).status, 403);
    }
  }
  const response = await fetch(`${base}/cadastros`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("atleta: grava identidade, hash, perfil pendente e vínculo em uma transação", async () => {
  const input = cadastro({ perfil: "atleta", clubeId });
  assert.equal((await request("/cadastros", input)).status, 201);
  const identity = await prisma.authUser.findUniqueOrThrow({ where: { email: input.email }, include: { accounts: true } });
  assert.equal(identity.emailVerified, false);
  assert.notEqual(identity.accounts[0].password, password);
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { authId: identity.id }, include: { atleta: { include: { vinculos: true } }, tecnico: true, presidente: true } });
  assert.equal(usuario.perfil, "atleta");
  assert.equal(usuario.tecnico, null);
  assert.equal(usuario.presidente, null);
  assert.ok(usuario.atleta);
  assert.equal(usuario.atleta.statusVerificacao, "pendente");
  assert.ok(usuario.atleta.verificacaoSolicitadaEm);
  assert.equal(usuario.atleta.verificadoEm, null);
  assert.equal(usuario.atleta.vinculos.length, 1);
  assert.equal(usuario.atleta.vinculos[0].clubeId, clubeId);
  assert.equal(usuario.atleta.vinculos[0].definidoPorPresidenteId, null);
  assert.equal((await request("/protegida", undefined, await login(input.email))).status, 200);
});

test("falha após criar identidade desfaz cadastro e permite nova tentativa", async () => {
  const input = cadastro({ perfil: "atleta", clubeId: randomUUID() });
  assert.equal((await request("/cadastros", input)).status, 400);
  assert.equal(await prisma.authUser.count({ where: { email: input.email } }), 0);
  assert.equal((await request("/cadastros", { ...input, clubeId })).status, 201);
});

test("falha no commit desfaz identidade e domínio; repetição pode concluir", async () => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION falhar_cadastro_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."nomeCompleto" = 'Falha simulada' THEN RAISE EXCEPTION 'Falha simulada no commit'; END IF; RETURN NULL; END $$`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER falhar_cadastro_teste AFTER INSERT ON "Usuario" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION falhar_cadastro_teste()`);
  const input = cadastro({ nomeCompleto: "Falha simulada" });
  try {
    assert.equal((await request("/cadastros", input)).status, 500);
    assert.equal(await prisma.authUser.count({ where: { email: input.email } }), 0);
    assert.equal(await prisma.usuario.count({ where: { nomeCompleto: input.nomeCompleto } }), 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER falhar_cadastro_teste ON "Usuario"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION falhar_cadastro_teste()`);
  }
  assert.equal((await request("/cadastros", input)).status, 201);
});

test("cadastros simultâneos com mesmo e-mail criam exatamente uma conta", async () => {
  const input = cadastro();
  const responses = await Promise.all([request("/cadastros", input), request("/cadastros", { ...input, email: input.email.toUpperCase() })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const identity = await prisma.authUser.findUniqueOrThrow({ where: { email: input.email }, include: { accounts: true } });
  assert.equal(identity.accounts.length, 1);
  assert.equal(await prisma.usuario.count({ where: { authId: identity.id } }), 1);
});

test("sessão persistida, acesso protegido, revogação e múltiplos dispositivos", async () => {
  const input = cadastro();
  assert.equal((await request("/cadastros", input)).status, 201);
  assert.equal((await request("/protegida")).status, 401);
  assert.equal((await request("/auth/sign-in/email", { email: input.email, password: "senha-incorreta" })).status, 401);
  const cookie = await login(input.email);
  const secondCookie = await login(input.email);
  const identity = await prisma.authUser.findUniqueOrThrow({ where: { email: input.email } });
  assert.equal(await prisma.authSession.count({ where: { userId: identity.id } }), 2);
  assert.equal((await request("/sessao", undefined, cookie)).status, 200);
  assert.equal((await request("/protegida", undefined, cookie)).status, 200);
  assert.equal((await request("/auth/sign-out", {}, cookie)).status, 200);
  const replays = await Promise.all(Array.from({ length: 5 }, () => request("/protegida", undefined, cookie)));
  assert.ok(replays.every(response => response.status === 401));
  assert.equal(await prisma.authSession.count({ where: { userId: identity.id } }), 1);
  assert.equal(await (await request("/auth/get-session", undefined, cookie)).json(), null);
  assert.equal((await request("/protegida", undefined, secondCookie)).status, 200);
  await prisma.usuario.update({ where: { authId: identity.id }, data: { ativo: false } });
  assert.equal((await request("/protegida", undefined, secondCookie)).status, 401);
  await prisma.usuario.update({ where: { authId: identity.id }, data: { ativo: true } });
  await prisma.authSession.updateMany({ where: { userId: identity.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await request("/protegida", undefined, secondCookie)).status, 401);
});

test("identidade técnica sem domínio não obtém acesso protegido", async () => {
  const input = cadastro();
  assert.equal((await request("/cadastros", input)).status, 201);
  const cookie = await login(input.email);
  const identity = await prisma.authUser.findUniqueOrThrow({ where: { email: input.email } });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { authId: identity.id } });
  await prisma.$transaction(async tx => {
    await tx.tecnico.delete({ where: { usuarioId: usuario.id } });
    await tx.usuario.delete({ where: { id: usuario.id } });
  });
  assert.equal((await request("/protegida", undefined, cookie)).status, 401);
  assert.equal((await request("/sessao", undefined, cookie)).status, 401);
});

test("usuário inativo não consegue entrar nem gravar sessão", async () => {
  const input = cadastro();
  assert.equal((await request("/cadastros", input)).status, 201);
  const identity = await prisma.authUser.findUniqueOrThrow({ where: { email: input.email } });
  await prisma.usuario.update({ where: { authId: identity.id }, data: { ativo: false } });
  const response = await request("/auth/sign-in/email", { email: input.email, password });
  assert.equal(response.status, 401);
  assert.ok(!response.headers.getSetCookie().some(cookie => cookie.includes("session_token=") && !/Max-Age=0/i.test(cookie)));
  assert.equal(await prisma.authSession.count({ where: { userId: identity.id } }), 0);
});

test("violação de restrição do cadastro no commit responde 409", async () => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION conflito_cadastro_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."nomeCompleto" = 'Conflito simulado' THEN RAISE EXCEPTION 'Conflito simulado' USING ERRCODE = '23514'; END IF; RETURN NULL; END $$`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER conflito_cadastro_teste AFTER INSERT ON "Usuario" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION conflito_cadastro_teste()`);
  const input = cadastro({ nomeCompleto: "Conflito simulado" });
  try {
    assert.equal((await request("/cadastros", input)).status, 409);
    assert.equal(await prisma.authUser.count({ where: { email: input.email } }), 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER conflito_cadastro_teste ON "Usuario"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION conflito_cadastro_teste()`);
  }
});

test("cadastro limita 5 tentativas por IP a cada 15 minutos", async () => {
  zerarLimiteCadastro();
  const ip = ipAleatorio();
  for (let i = 0; i < 5; i++) assert.equal((await request("/cadastros", { perfil: "invalido" }, "", origin, ip)).status, 400);
  const input = cadastro();
  const bloqueado = await request("/cadastros", input, "", origin, ip);
  assert.equal(bloqueado.status, 429);
  assert.match((await bloqueado.json()).message, /Muitas tentativas de cadastro/);
  assert.equal(await prisma.authUser.count({ where: { email: input.email } }), 0);
});

test("login limita tentativas por IP pelo Better Auth", async () => {
  const input = cadastro();
  assert.equal((await request("/cadastros", input)).status, 201);
  const ip = ipAleatorio();
  for (let i = 0; i < 3; i++) assert.equal((await request("/auth/sign-in/email", { email: input.email, password: "senha-incorreta" }, "", origin, ip)).status, 401);
  assert.equal((await request("/auth/sign-in/email", { email: input.email, password }, "", origin, ip)).status, 429);
  assert.equal((await request("/auth/sign-in/email", { email: input.email, password })).status, 200);
});
