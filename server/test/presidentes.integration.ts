import "reflect-metadata";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
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
const clubeId = randomUUID();
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

const request = (path: string, cookie = "", body?: unknown) => {
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  return fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};
async function login(email: string, senha = password) {
  const response = await request("/auth/sign-in/email", "", { email, password: senha });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}

/** Executa o procedimento restrito como em implantação, com a senha pela entrada padrão. */
function presidenteInicial(args: string[], stdin: string) {
  const child = spawn(process.execPath, ["dist/cli/presidente-inicial.js", ...args], { env: process.env, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdin.end(stdin);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve({ code, stdout, stderr }));
  });
}
const presidentesPorEmail = async (lista: string[]) => {
  const identidades = await prisma.authUser.findMany({ where: { email: { in: lista } }, select: { id: true } });
  return prisma.usuario.findMany({ where: { authId: { in: identidades.map(i => i.id) } }, include: { presidente: true } });
};
const identidadesPorEmail = (lista: string[]) => prisma.authUser.count({ where: { email: { in: lista } } });
async function comFalhaNoCommit(nome: string, executar: () => Promise<void>) {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION falhar_presidente_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."nomeCompleto" = '${nome}' THEN RAISE EXCEPTION 'Falha simulada no commit'; END IF; RETURN NULL; END $$`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER falhar_presidente_teste AFTER INSERT ON "Usuario" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION falhar_presidente_teste()`);
  try {
    await executar();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER falhar_presidente_teste ON "Usuario"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION falhar_presidente_teste()`);
  }
}

let inicialEmail: string;
let inicialId: string;

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
});

after(async () => {
  await prisma.$transaction(async tx => {
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = (await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id);
    await tx.vinculoClube.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.atleta.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.tecnico.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.clube.deleteMany({ where: { id: clubeId } });
    await tx.presidente.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
  });
  await app.close();
});

test("presidente inicial: procedimento atômico, sem senha versionada, e repetição recusada", async () => {
  const ativosComAcesso = await prisma.usuario.findMany({ where: { perfil: "presidente", ativo: true }, select: { authId: true } });
  assert.equal(await prisma.authAccount.count({ where: { userId: { in: ativosComAcesso.map(a => a.authId) }, providerId: "credential" } }), 0,
    "O banco de teste não pode conter presidente ativo com credencial antes desta suíte");

  // Sem argumentos obrigatórios ou com senha inválida: nada é criado.
  assert.equal((await presidenteInicial([], `${password}\n`)).code, 2);
  const curta = novoEmail();
  const invalida = await presidenteInicial(["--nome", "Presidente Inicial", "--email", curta], "curta\n");
  assert.equal(invalida.code, 1);
  assert.match(invalida.stderr, /Dados inválidos/);
  assert.equal(await identidadesPorEmail([curta]), 0);

  // Falha no commit desfaz identidade, credencial e domínio.
  const falha = novoEmail();
  await comFalhaNoCommit("Falha simulada inicial", async () => {
    assert.notEqual((await presidenteInicial(["--nome", "Falha simulada inicial", "--email", falha], `${password}\n`)).code, 0);
  });
  assert.equal(await identidadesPorEmail([falha]), 0);
  assert.equal(await prisma.usuario.count({ where: { nomeCompleto: "Falha simulada inicial" } }), 0);

  // Execuções simultâneas: exatamente uma conclui.
  const candidatos = [novoEmail(), novoEmail()];
  const execucoes = await Promise.all(candidatos.map(email => presidenteInicial(["--nome", "Presidente Inicial", "--email", email.toUpperCase()], `${password}\r\n`)));
  assert.deepEqual(execucoes.map(e => e.code).sort(), [0, 1], JSON.stringify(execucoes));
  assert.match(execucoes.find(e => e.code === 1)!.stderr, /Já existe presidente ativo com credencial/);
  const criados = await presidentesPorEmail(candidatos);
  assert.equal(criados.length, 1);
  assert.equal(await identidadesPorEmail(candidatos), 1);
  assert.equal(criados[0].perfil, "presidente");
  assert.equal(criados[0].presidente?.criadoPorPresidenteId, null);
  assert.ok(!execucoes.some(e => e.stdout.includes(password) || e.stderr.includes(password)), "senha não deve aparecer na saída");
  inicialId = criados[0].id;
  inicialEmail = (await prisma.authUser.findUniqueOrThrow({ where: { id: criados[0].authId } })).email;

  const cookie = await login(inicialEmail);
  const sessao = await (await request("/sessao", cookie)).json();
  assert.equal(sessao.usuario.perfil, "presidente");
  assert.equal(sessao.usuario.id, inicialId);

  // Repetição, com o mesmo ou outro e-mail, não cria presidentes nem identidades parciais.
  const outro = novoEmail();
  for (const email of [inicialEmail, outro]) {
    const repetido = await presidenteInicial(["--nome", "Presidente Repetido", "--email", email], `${password}\n`);
    assert.equal(repetido.code, 1);
  }
  assert.equal(await identidadesPorEmail([outro]), 0);
  assert.equal(await prisma.usuario.count({ where: { nomeCompleto: "Presidente Repetido" } }), 0);
});

test("somente presidente ativo cria outro presidente e o criador fica registrado", async () => {
  const cookie = await login(inicialEmail);
  const email = novoEmail();
  const response = await request("/presidentes", cookie, { nomeCompleto: "Presidente Sucessor", email, password });
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  assert.equal(body.usuario.perfil, "presidente");
  assert.equal(body.criadoPorPresidenteId, inicialId);
  const [sucessor] = await presidentesPorEmail([email]);
  assert.equal(sucessor.presidente?.criadoPorPresidenteId, inicialId);

  // O novo presidente entra com a senha inicial e também pode criar presidentes.
  const cookieSucessor = await login(email);
  assert.equal((await request("/protegida/presidente", cookieSucessor)).status, 200);
  const terceiro = novoEmail();
  const criadoPeloSucessor = await request("/presidentes", cookieSucessor, { nomeCompleto: "Presidente Terceiro", email: terceiro, password });
  assert.equal(criadoPeloSucessor.status, 201);
  assert.equal((await criadoPeloSucessor.json()).criadoPorPresidenteId, sucessor.id);

  // E-mail repetido e campos administrativos forjados são recusados sem efeitos.
  assert.equal((await request("/presidentes", cookie, { nomeCompleto: "Duplicado", email: email.toUpperCase(), password })).status, 409);
  const forjado = novoEmail();
  for (const extra of [{ criadoPorPresidenteId: randomUUID() }, { perfil: "presidente" }, { ativo: true }]) {
    assert.equal((await request("/presidentes", cookie, { nomeCompleto: "Forjado", email: forjado, password, ...extra })).status, 400);
  }
  assert.equal((await request("/presidentes", cookie, { nomeCompleto: "Senha curta", email: forjado, password: "curta" })).status, 400);
  assert.equal(await identidadesPorEmail([forjado]), 0);
});

test("falha no commit da criação de presidente não deixa identidade parcial; repetição conclui", async () => {
  const cookie = await login(inicialEmail);
  const email = novoEmail();
  await comFalhaNoCommit("Falha simulada sucessor", async () => {
    assert.equal((await request("/presidentes", cookie, { nomeCompleto: "Falha simulada sucessor", email, password })).status, 500);
  });
  assert.equal(await identidadesPorEmail([email]), 0);
  assert.equal(await prisma.usuario.count({ where: { nomeCompleto: "Falha simulada sucessor" } }), 0);
  assert.equal((await request("/presidentes", cookie, { nomeCompleto: "Falha simulada sucessor", email, password })).status, 201);
});

test("escalada de privilégio negada: sem sessão, atleta, técnico, inativo e cadastro público", async () => {
  const novo = () => ({ nomeCompleto: "Tentativa de escalada", email: novoEmail(), password });
  assert.equal((await request("/presidentes", "", novo())).status, 401);

  await prisma.clube.create({ data: { id: clubeId, nome: "Clube fictício de presidentes", criadoPorPresidenteId: inicialId } });
  const contas: string[] = [];
  for (const perfil of ["atleta", "tecnico"] as const) {
    const email = novoEmail();
    const cadastro = await request("/cadastros", "", { nomeCompleto: "Pessoa Fictícia", email, password, perfil, ...(perfil === "atleta" ? { clubeId } : {}) });
    assert.equal(cadastro.status, 201);
    contas.push(email);
  }
  // Público não cria presidente nem com perfil forjado.
  assert.equal((await request("/cadastros", "", { ...novo(), perfil: "presidente" })).status, 400);

  const [atleta, tecnico] = await Promise.all(contas.map(email => login(email)));
  const aprovado = { statusVerificacao: "aprovado" as const, verificadoPorPresidenteId: inicialId, verificadoEm: new Date() };
  const [tecnicoUsuario] = await prisma.usuario.findMany({ where: { authId: (await prisma.authUser.findUniqueOrThrow({ where: { email: contas[1] } })).id } });
  await prisma.tecnico.update({ where: { usuarioId: tecnicoUsuario.id }, data: { ...aprovado, clubeId } });
  for (const cookie of [atleta, tecnico]) assert.equal((await request("/presidentes", cookie, novo())).status, 403);

  // Presidente desativado perde a criação imediatamente, com a mesma sessão.
  const desativadoEmail = novoEmail();
  assert.equal((await request("/presidentes", await login(inicialEmail), { nomeCompleto: "Presidente Desativado", email: desativadoEmail, password })).status, 201);
  const cookieDesativado = await login(desativadoEmail);
  const [desativado] = await presidentesPorEmail([desativadoEmail]);
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  const tentativa = novo();
  assert.equal((await request("/presidentes", cookieDesativado, tentativa)).status, 401);
  assert.equal(await identidadesPorEmail([tentativa.email]), 0);
  assert.equal(await prisma.usuario.count({ where: { nomeCompleto: "Tentativa de escalada" } }), 0);
});
