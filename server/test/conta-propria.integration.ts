import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { UnauthorizedException } from "@nestjs/common";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { carteirinhaFicticia } from "./support/carteirinha.ts";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { editarNomeProprio } from "../dist/modules/contas/contas.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let base: string;
const password = "Senha-local-de-teste-2026";
const clubeId = randomUUID();
const emails: string[] = [];
const usuariosSemIdentidade: string[] = [];
const presidente = { id: randomUUID(), email: `${randomUUID()}@example.invalid` };
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

const request = (path: string, { cookie = "", method = "GET", body, requestOrigin = origin }: { cookie?: string; method?: string; body?: unknown; requestOrigin?: string | null } = {}) => fetch(`${base}${path}`, {
  method,
  headers: { ...(requestOrigin ? { Origin: requestOrigin } : {}), "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const editar = (cookie: string, body: unknown, requestOrigin: string | null = origin) => request("/conta", { cookie, method: "PATCH", body, requestOrigin });

async function login(email: string) {
  const response = await request("/auth/sign-in/email", { method: "POST", body: { email, password } });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}
async function cadastrar(perfil: "atleta" | "tecnico") {
  const email = `${randomUUID()}@example.invalid`;
  emails.push(email);
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("/cadastros", { method: "POST", body: { nomeCompleto: "Pessoa Fictícia", email, password, perfil, ...(perfil === "atleta" ? { clubeId } : {}) } });
  assert.equal(response.status, 201, await response.clone().text());
  return { id: (await response.json()).usuario.id as string, email };
}

/** Estado completo que a edição não pode alterar, mais os dois nomes que devem acompanhar a edição. */
async function retrato(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId }, include: {
    atleta: { include: { vinculos: true, carteirinha: true } }, tecnico: true, presidente: true,
  } });
  const identidade = await prisma.authUser.findUniqueOrThrow({ where: { id: usuario.authId } });
  const { nomeCompleto, ...resto } = usuario;
  return { nomeCompleto, nomeIdentidade: identidade.name, email: identidade.email, resto };
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  emails.push(presidente.email);
  const authId = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente de teste", email: presidente.email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id: presidente.id, authId, nomeCompleto: "Presidente de teste", perfil: "presidente", presidente: { create: {} } } });
    await tx.clube.create({ data: { id: clubeId, nome: "Clube fictício da conta própria", criadoPorPresidenteId: presidente.id } });
  });
});

after(async () => {
  await prisma.$transaction(async tx => {
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = [...(await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id), ...usuariosSemIdentidade];
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

test("própria conta edita o nome sem nova aprovação, em qualquer perfil e situação", async () => {
  const atleta = await cadastrar("atleta");
  const tecnico = await cadastrar("tecnico");
  const pendente = await cadastrar("atleta");
  const verificado = { verificadoPorPresidenteId: presidente.id, verificadoEm: new Date("2026-11-01T12:00:00Z") };
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { statusVerificacao: "aprovado", ...verificado, ...carteirinhaFicticia(presidente.id) } });
  await prisma.tecnico.update({ where: { usuarioId: tecnico.id }, data: { statusVerificacao: "rejeitado", ...verificado } });

  const contas = [{ id: atleta.id, email: atleta.email }, { id: tecnico.id, email: tecnico.email }, { id: pendente.id, email: pendente.email }, presidente];
  for (const [indice, conta] of contas.entries()) {
    const antes = await retrato(conta.id);
    const cookie = await login(conta.email);
    const nome = `Nome Editado ${indice}`;
    const response = await editar(cookie, { nomeCompleto: `  ${nome}  ` });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { usuario: { id: conta.id, nomeCompleto: nome }, alterado: true });

    // Domínio e identidade mudam juntos; aprovação, verificação, vínculo, carteirinha, perfil, ativação e e-mail ficam intactos.
    const depois = await retrato(conta.id);
    assert.deepEqual([depois.nomeCompleto, depois.nomeIdentidade], [nome, nome]);
    assert.deepEqual(depois.resto, antes.resto);
    assert.equal(depois.email, antes.email);

    // A sessão aberta continua válida e passa a mostrar o novo nome, com a mesma situação de aprovação.
    const sessao = await (await request("/sessao", { cookie })).json();
    assert.equal(sessao.usuario.nomeCompleto, nome);
    assert.equal((await (await request("/auth/get-session", { cookie })).json()).user.name, nome);

    // Repetição com o mesmo nome não grava nada.
    assert.deepEqual(await (await editar(cookie, { nomeCompleto: nome })).json(), { usuario: { id: conta.id, nomeCompleto: nome }, alterado: false });
  }
  // A edição não reabre análise: o rejeitado continua rejeitado e o pendente mantém a data da solicitação.
  assert.equal((await prisma.tecnico.findUniqueOrThrow({ where: { usuarioId: tecnico.id } })).statusVerificacao, "rejeitado");
  const sessaoAtleta = await (await request("/sessao", { cookie: await login(atleta.email) })).json();
  assert.deepEqual([sessaoAtleta.usuario.statusVerificacao, sessaoAtleta.usuario.aprovado, sessaoAtleta.usuario.clubeId], ["aprovado", true, clubeId]);
  // Depois de corrigir os dados, o rejeitado solicita nova análise pelo fluxo próprio.
  assert.equal((await request("/verificacoes/solicitacao", { cookie: await login(tecnico.email), method: "POST", body: {} })).status, 200);
});

test("recusa campos administrativos, e-mail, senha e nome inválido sem alterar nada", async () => {
  const atleta = await cadastrar("atleta");
  const cookie = await login(atleta.email);
  const antes = await retrato(atleta.id);
  const nome = "Nome Válido";
  const corpos: unknown[] = [
    {}, { nomeCompleto: "ab" }, { nomeCompleto: "   abc   ".padEnd(160, "x") }, { nomeCompleto: 123 }, null, [],
    ...[
      { perfil: "presidente" }, { clubeId: randomUUID() }, { statusVerificacao: "aprovado" }, { aprovado: true }, { ativo: false },
      { verificadoPorPresidenteId: presidente.id }, { usuarioId: randomUUID() }, { id: randomUUID() }, { authId: randomUUID() },
      { email: `${randomUUID()}@example.invalid` }, { password: "Outra-senha-de-teste-1" }, { name: "Nome nativo" }, { image: "x" },
    ].map(extra => ({ nomeCompleto: nome, ...extra })),
  ];
  for (const body of corpos) {
    const response = await editar(cookie, body);
    assert.equal(response.status, 400, `${JSON.stringify(body)}: ${await response.text()}`);
  }
  assert.deepEqual(await retrato(atleta.id), antes);
  // Senha original segue válida.
  await login(atleta.email);
});

test("somente a própria conta: sem sessão, outra conta, conta desativada, origem e rotas nativas", async () => {
  const alvo = await cadastrar("tecnico");
  const outro = await cadastrar("atleta");
  const cookieOutro = await login(outro.email);
  const antesAlvo = await retrato(alvo.id);
  const antesOutro = await retrato(outro.id);

  assert.equal((await editar("", { nomeCompleto: "Sem Sessão" })).status, 401);
  assert.equal((await editar(cookieOutro, { nomeCompleto: "Origem Errada" }, "https://outra-origem.invalid")).status, 403);
  assert.equal((await editar(cookieOutro, { nomeCompleto: "Sem Origem" }, null)).status, 403);
  // Não há rota para editar terceiros: o alvo não vem da requisição.
  for (const path of [`/conta/${alvo.id}`, `/contas/${alvo.id}`]) {
    assert.equal((await request(path, { cookie: cookieOutro, method: "PATCH", body: { nomeCompleto: "Terceiro" } })).status, 404);
  }
  assert.equal((await editar(cookieOutro, { nomeCompleto: "Terceiro", usuarioId: alvo.id })).status, 400);

  // Rotas nativas do Better Auth para nome, e-mail e senha continuam bloqueadas.
  for (const [path, body] of [
    ["/auth/update-user", { name: "Nome Nativo" }], ["/auth/change-email", { newEmail: `${randomUUID()}@example.invalid` }],
    ["/auth/change-password", { currentPassword: password, newPassword: "Outra-senha-de-teste-1" }],
  ] as const) {
    for (const method of ["POST", "PATCH"]) assert.equal((await request(path, { cookie: cookieOutro, method, body })).status, 404, `${method} ${path}`);
  }
  assert.deepEqual(await retrato(alvo.id), antesAlvo);
  assert.deepEqual(await retrato(outro.id), antesOutro);

  // Conta desativada perde a sessão e não edita.
  await prisma.usuario.update({ where: { id: outro.id }, data: { ativo: false } });
  try {
    assert.equal((await editar(cookieOutro, { nomeCompleto: "Desativada" })).status, 401);
    await assert.rejects(prisma.$transaction(tx => editarNomeProprio(tx, outro.id, "Desativada")), UnauthorizedException);
    assert.equal((await retrato(outro.id)).nomeCompleto, antesOutro.nomeCompleto);
  } finally {
    await prisma.usuario.update({ where: { id: outro.id }, data: { ativo: true } });
  }
});

test("rollback mantém domínio e identidade consistentes", async () => {
  const atleta = await cadastrar("atleta");
  const antes = await retrato(atleta.id);

  // Falha depois da edição dentro da mesma transação: nenhum dos nomes muda.
  await assert.rejects(prisma.$transaction(async tx => {
    await editarNomeProprio(tx, atleta.id, "Nome Descartado");
    throw new Error("falha simulada");
  }), /falha simulada/);
  assert.deepEqual(await retrato(atleta.id), antes);

  // Identidade ausente: a gravação do domínio já feita é desfeita junto.
  const semIdentidade = await prisma.usuario.create({ data: { authId: randomUUID(), nomeCompleto: "Sem Identidade", perfil: "tecnico", tecnico: { create: {} } } });
  usuariosSemIdentidade.push(semIdentidade.id);
  await assert.rejects(prisma.$transaction(tx => editarNomeProprio(tx, semIdentidade.id, "Nome Perdido")));
  assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: semIdentidade.id } })).nomeCompleto, "Sem Identidade");
});

test("edições simultâneas terminam com o mesmo nome no domínio e na identidade", async () => {
  const atleta = await cadastrar("atleta");
  const cookie = await login(atleta.email);
  const nomes = Array.from({ length: 6 }, (_, i) => `Nome Concorrente ${i}`);
  const respostas = await Promise.all(nomes.map(nomeCompleto => editar(cookie, { nomeCompleto })));
  assert.deepEqual(respostas.map(r => r.status), nomes.map(() => 200));
  const { nomeCompleto, nomeIdentidade } = await retrato(atleta.id);
  assert.ok(nomes.includes(nomeCompleto));
  assert.equal(nomeIdentidade, nomeCompleto);
});

test("OpenAPI documenta a edição da própria conta somente com nomeCompleto", async () => {
  const contrato = await (await request("/openapi.json")).json();
  const schema = contrato.paths["/conta"].patch.requestBody.content["application/json"].schema;
  assert.deepEqual(Object.keys(schema.properties), ["nomeCompleto"]);
  assert.equal(schema.additionalProperties, false);
});
