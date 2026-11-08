import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { carteirinhaFicticia } from "./support/carteirinha.ts";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { AutorizacaoService } from "../dist/modules/autorizacao/autorizacao.service.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const autorizacao = app.get(AutorizacaoService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let base: string;
const password = "Senha-local-de-teste-2026";
const presidenteId = randomUUID();
const presidenteEmail = `${randomUUID()}@example.invalid`;
const clubeA = randomUUID();
const clubeB = randomUUID();
const emails: string[] = [presidenteEmail];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

const request = (path: string, cookie = "", body?: unknown) => fetch(`${base}${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { Origin: origin, "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function login(email: string) {
  const response = await request("/auth/sign-in/email", "", { email, password });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}
async function cadastrar(perfil: "atleta" | "tecnico", clubeId?: string) {
  const email = `${randomUUID()}@example.invalid`;
  emails.push(email);
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("/cadastros", "", { nomeCompleto: "Pessoa Fictícia", email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const { usuario } = await response.json();
  return { id: usuario.id as string, email, cookie: await login(email) };
}
const aprovacao = { statusVerificacao: "aprovado" as const, verificadoPorPresidenteId: presidenteId, verificadoEm: new Date() };
const status = async (path: string, cookie: string) => (await request(path, cookie)).status;

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  const authId = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente de teste", email: presidenteEmail } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id: presidenteId, authId, nomeCompleto: "Presidente de teste", perfil: "presidente", presidente: { create: {} } } });
    await tx.clube.createMany({ data: [
      { id: clubeA, nome: "Clube A fictício", criadoPorPresidenteId: presidenteId },
      { id: clubeB, nome: "Clube B fictício", criadoPorPresidenteId: presidenteId },
    ] });
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
    await tx.clube.deleteMany({ where: { id: { in: [clubeA, clubeB] } } });
    await tx.presidente.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
  });
  await app.close();
});

test("pendente e rejeitado autenticam, mas não obtêm privilégios esportivos", async () => {
  const atleta = await cadastrar("atleta", clubeA);
  const tecnico = await cadastrar("tecnico");
  for (const { cookie } of [atleta, tecnico]) {
    assert.equal(await status("/protegida", cookie), 200);
    assert.equal(await status("/protegida/aprovado", cookie), 403);
    assert.equal(await status(`/protegida/clubes/${clubeA}`, cookie), 403);
    assert.equal(await status("/protegida/presidente", cookie), 403);
  }
  const sessao = await (await request("/sessao", atleta.cookie)).json();
  assert.deepEqual({ ...sessao.usuario, id: undefined, nomeCompleto: undefined }, { id: undefined, nomeCompleto: undefined, perfil: "atleta", statusVerificacao: "pendente", aprovado: false, clubeId: clubeA });
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { statusVerificacao: "rejeitado" } });
  assert.equal(await status("/protegida/aprovado", atleta.cookie), 403);
});

test("atleta e técnico aprovados acessam somente o próprio clube; presidente acessa qualquer clube", async () => {
  const atleta = await cadastrar("atleta", clubeA);
  const tecnico = await cadastrar("tecnico");
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { ...aprovacao, ...carteirinhaFicticia(presidenteId) } });
  await prisma.tecnico.update({ where: { usuarioId: tecnico.id }, data: aprovacao });
  // Aprovado sem clube: acessa rotas esportivas gerais, mas nenhum clube.
  assert.equal(await status("/protegida/aprovado", tecnico.cookie), 200);
  assert.equal(await status(`/protegida/clubes/${clubeA}`, tecnico.cookie), 403);
  await prisma.tecnico.update({ where: { usuarioId: tecnico.id }, data: { clubeId: clubeA } });
  for (const { cookie } of [atleta, tecnico]) {
    assert.equal(await status("/protegida/aprovado", cookie), 200);
    assert.equal(await status(`/protegida/clubes/${clubeA}`, cookie), 200);
    assert.equal(await status(`/protegida/clubes/${clubeA.toUpperCase()}`, cookie), 200);
    assert.equal(await status(`/protegida/clubes/${clubeB}`, cookie), 403);
    assert.equal(await status(`/protegida/clubes/${clubeB.toUpperCase()}`, cookie), 403);
    assert.equal(await status("/protegida/presidente", cookie), 403);
  }
  // Clube vem do cadastro: parâmetros extras na requisição não alteram o clube autorizado.
  assert.equal(await status(`/protegida/clubes/${clubeB}?clubeId=${clubeA}&usuarioId=${presidenteId}`, atleta.cookie), 403);
  assert.equal(await status("/protegida/clubes/nao-uuid", atleta.cookie), 400);

  const presidente = await login(presidenteEmail);
  assert.equal(await status("/protegida/presidente", presidente), 200);
  assert.equal(await status("/protegida/aprovado", presidente), 200);
  assert.equal(await status(`/protegida/clubes/${clubeB}`, presidente), 200);
});

test("transferência registrada passa a valer na requisição seguinte", async () => {
  const atleta = await cadastrar("atleta", clubeA);
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { ...aprovacao, ...carteirinhaFicticia(presidenteId) } });
  await prisma.$transaction(async tx => {
    await tx.vinculoClube.updateMany({ where: { atletaId: atleta.id, fim: null }, data: { fim: new Date() } });
    await tx.vinculoClube.create({ data: { atletaId: atleta.id, clubeId: clubeB, inicio: new Date(Date.now() + 1), definidoPorPresidenteId: presidenteId } });
  });
  assert.equal(await status(`/protegida/clubes/${clubeA}`, atleta.cookie), 403);
  assert.equal(await status(`/protegida/clubes/${clubeB}`, atleta.cookie), 200);
});

test("inativo e identidade sem domínio são recusados com 401 em todas as rotas protegidas", async () => {
  const tecnico = await cadastrar("tecnico");
  await prisma.tecnico.update({ where: { usuarioId: tecnico.id }, data: { ...aprovacao, clubeId: clubeB } });
  assert.equal(await status(`/protegida/clubes/${clubeB}`, tecnico.cookie), 200);
  await prisma.usuario.update({ where: { id: tecnico.id }, data: { ativo: false } });
  for (const path of ["/protegida", "/protegida/aprovado", "/protegida/presidente", `/protegida/clubes/${clubeB}`, "/sessao"]) {
    assert.equal(await status(path, tecnico.cookie), 401);
    assert.equal(await status(path, ""), 401);
  }
  const semDominio = await cadastrar("tecnico");
  await prisma.$transaction(async tx => {
    await tx.tecnico.delete({ where: { usuarioId: semDominio.id } });
    await tx.usuario.delete({ where: { id: semDominio.id } });
  });
  assert.equal(await status("/protegida/aprovado", semDominio.cookie), 401);
});

test("transação sensível revalida acesso e aguarda desativação concorrente", async () => {
  const atleta = await cadastrar("atleta", clubeA);
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { ...aprovacao, ...carteirinhaFicticia(presidenteId) } });
  const ator = { usuarioId: atleta.id };
  assert.equal((await prisma.$transaction(tx => autorizacao.revalidarClube(tx, ator, clubeA))).clubeId, clubeA);
  await assert.rejects(prisma.$transaction(tx => autorizacao.revalidarClube(tx, ator, clubeB)), { status: 403 });
  await assert.rejects(prisma.$transaction(tx => autorizacao.revalidar(tx, ator, { perfis: ["presidente"] })), { status: 403 });

  // Desativação (FOR UPDATE na linha Usuario) iniciada antes: a revalidação aguarda o commit e recusa.
  let liberar!: () => void;
  const bloqueio = new Promise<void>(resolve => { liberar = resolve; });
  let travado!: () => void;
  const linhaTravada = new Promise<void>(resolve => { travado = resolve; });
  const desativacao = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${atleta.id}::uuid FOR UPDATE`;
    await tx.usuario.update({ where: { id: atleta.id }, data: { ativo: false } });
    travado();
    await bloqueio;
  });
  await linhaTravada;
  const revalidacao = prisma.$transaction(tx => autorizacao.revalidar(tx, ator, { aprovado: true }));
  setTimeout(liberar, 200);
  await desativacao;
  await assert.rejects(revalidacao, { status: 401 });
  // Ator anterior ao guard não substitui a releitura: mesmo objeto, agora recusado.
  assert.equal(await status("/protegida/aprovado", atleta.cookie), 401);
});
