import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { carteirinhaFicticia } from "./support/carteirinha.ts";
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
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };

const request = (method: "GET" | "POST", path: string, cookie = "", body?: unknown, comOrigem = true) => fetch(`${base}${path}`, {
  method,
  headers: { ...(comOrigem ? { Origin: origin } : {}), "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function login(email: string) {
  const response = await request("POST", "/auth/sign-in/email", "", { email, password });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
}
async function criarPresidente() {
  const email = novoEmail();
  const authId = randomUUID();
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente das verificações", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente das verificações", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
async function cadastrar(perfil: "atleta" | "tecnico") {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: `Solicitante ${perfil}`, email, password, perfil, ...(perfil === "atleta" ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const { usuario } = await response.json();
  return { id: usuario.id as string, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;
const decidir = (decisao: "aprovacao" | "rejeicao", usuarioId: string, cookie = presidente.cookie, body?: unknown) =>
  request("POST", `/verificacoes/${usuarioId}/${decisao}`, cookie, body);
const solicitarNovamente = (cookie: string, body?: unknown) => request("POST", "/verificacoes/solicitacao", cookie, body);
const statusAprovado = async (cookie: string) => (await request("GET", "/protegida/aprovado", cookie)).status;
const estadoAtleta = (usuarioId: string) => prisma.atleta.findUniqueOrThrow({ where: { usuarioId }, include: { carteirinha: true, vinculos: true } });
async function listar(query = "") {
  const response = await request("GET", `/verificacoes${query}`, presidente.cookie);
  assert.equal(response.status, 200, await response.clone().text());
  return await response.json() as Record<string, unknown>[];
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
  await prisma.clube.create({ data: { id: clubeId, nome: "Clube das verificações", criadoPorPresidenteId: presidente.id } });
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

test("presidente consulta e aprova atleta: vínculo confirmado e carteirinha única emitida na mesma operação", async () => {
  const atleta = await cadastrar("atleta");
  assert.equal(await statusAprovado(atleta.cookie), 403);

  const pendente = (await listar()).find(s => s.usuarioId === atleta.id);
  assert.deepEqual({ ...pendente, verificacaoSolicitadaEm: typeof pendente?.verificacaoSolicitadaEm }, {
    usuarioId: atleta.id, nomeCompleto: "Solicitante atleta", perfil: "atleta", ativo: true, statusVerificacao: "pendente",
    verificacaoSolicitadaEm: "string", verificadoPorPresidenteId: null, verificadoEm: null,
    clube: { id: clubeId, nome: "Clube das verificações" }, carteirinha: null,
  });
  assert.equal((await listar("?perfil=tecnico")).some(s => s.usuarioId === atleta.id), false);

  const resposta = await decidir("aprovacao", atleta.id.toUpperCase());
  assert.equal(resposta.status, 200, await resposta.clone().text());
  const { solicitacao, alterado } = await resposta.json();
  assert.equal(alterado, true);
  assert.equal(solicitacao.statusVerificacao, "aprovado");
  assert.equal(solicitacao.verificadoPorPresidenteId, presidente.id);
  assert.ok(solicitacao.verificadoEm);
  // Resposta administrativa sem token do QR nem dados de login.
  assert.deepEqual(Object.keys(solicitacao.carteirinha).sort(), ["codigo", "emitidaEm", "emitidaPorPresidenteId", "id", "status"]);
  assert.equal(JSON.stringify(solicitacao).includes(atleta.email), false);
  assert.match(solicitacao.carteirinha.codigo, /^[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.deepEqual([solicitacao.carteirinha.status, solicitacao.carteirinha.emitidaPorPresidenteId, solicitacao.carteirinha.emitidaEm], ["ativa", presidente.id, solicitacao.verificadoEm]);

  const estado = await estadoAtleta(atleta.id);
  assert.equal(estado.carteirinha?.id, solicitacao.carteirinha.id);
  assert.match(estado.carteirinha!.tokenQr, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(estado.carteirinha!.tokenQr, estado.carteirinha!.codigo);
  assert.equal(estado.vinculos.length, 1);
  assert.deepEqual([estado.vinculos[0].clubeId, estado.vinculos[0].fim, estado.vinculos[0].definidoPorPresidenteId], [clubeId, null, presidente.id]);
  // Aprovação vale já na requisição seguinte, com a mesma sessão.
  assert.equal(await statusAprovado(atleta.cookie), 200);

  // Repetição não duplica nem altera a carteirinha.
  const repetida = await decidir("aprovacao", atleta.id);
  assert.equal(repetida.status, 200);
  const segunda = await repetida.json();
  assert.equal(segunda.alterado, false);
  assert.deepEqual(segunda.solicitacao, solicitacao);
  assert.equal(await prisma.carteirinha.count({ where: { atletaId: atleta.id } }), 1);
  assert.equal((await estadoAtleta(atleta.id)).carteirinha!.tokenQr, estado.carteirinha!.tokenQr);

  // Não há retirada de aprovação; nova solicitação também é recusada.
  assert.equal((await decidir("rejeicao", atleta.id)).status, 409);
  assert.equal((await solicitarNovamente(atleta.cookie)).status, 409);
  assert.equal((await estadoAtleta(atleta.id)).statusVerificacao, "aprovado");
  assert.equal((await listar()).some(s => s.usuarioId === atleta.id), false);
  assert.ok((await listar("?status=aprovado&perfil=atleta")).some(s => s.usuarioId === atleta.id));
});

test("aprovação de técnico não emite carteirinha; banco recusa carteirinha de técnico", async () => {
  const tecnico = await cadastrar("tecnico");
  const pendente = (await listar("?perfil=tecnico")).find(s => s.usuarioId === tecnico.id);
  assert.equal(pendente?.clube, null);
  assert.equal("carteirinha" in pendente!, false);

  const resposta = await decidir("aprovacao", tecnico.id);
  assert.equal(resposta.status, 200, await resposta.clone().text());
  const { solicitacao } = await resposta.json();
  assert.deepEqual([solicitacao.perfil, solicitacao.statusVerificacao, solicitacao.verificadoPorPresidenteId, "carteirinha" in solicitacao], ["tecnico", "aprovado", presidente.id, false]);
  assert.equal(await prisma.carteirinha.count({ where: { atletaId: tecnico.id } }), 0);
  assert.equal(await statusAprovado(tecnico.cookie), 200);
  await assert.rejects(prisma.carteirinha.create({ data: { atletaId: tecnico.id, codigo: randomUUID(), tokenQr: randomUUID(), emitidaEm: new Date(), emitidaPorPresidenteId: presidente.id } }));
});

test("rejeição sem motivo e nova solicitação na mesma conta, para atleta e técnico", async () => {
  for (const perfil of ["atleta", "tecnico"] as const) {
    const pessoa = await cadastrar(perfil);
    const antes = (await listar()).find(s => s.usuarioId === pessoa.id)!;

    const rejeitada = await decidir("rejeicao", pessoa.id);
    assert.equal(rejeitada.status, 200, await rejeitada.clone().text());
    const { solicitacao, alterado } = await rejeitada.json();
    assert.deepEqual([alterado, solicitacao.statusVerificacao, solicitacao.verificadoPorPresidenteId], [true, "rejeitado", presidente.id]);
    if (perfil === "atleta") assert.equal(solicitacao.carteirinha, null);
    assert.equal(await statusAprovado(pessoa.cookie), 403);
    // Repetir a rejeição não altera; aprovar exige nova solicitação.
    assert.equal((await (await decidir("rejeicao", pessoa.id)).json()).alterado, false);
    assert.equal((await decidir("aprovacao", pessoa.id)).status, 409);
    assert.equal(await prisma.carteirinha.count({ where: { atletaId: pessoa.id } }), 0);
    assert.ok((await listar("?status=rejeitado")).some(s => s.usuarioId === pessoa.id));

    // A própria conta solicita nova análise; não aceita campos para alterar perfil, clube ou aprovação.
    for (const body of [{ statusVerificacao: "aprovado" }, { clubeId: randomUUID() }, { perfil: "presidente" }]) {
      assert.equal((await solicitarNovamente(pessoa.cookie, body)).status, 400);
    }
    const nova = await solicitarNovamente(pessoa.cookie, {});
    assert.equal(nova.status, 200, await nova.clone().text());
    const reapresentada = await nova.json();
    assert.deepEqual([reapresentada.statusVerificacao, reapresentada.alterado], ["pendente", true]);
    assert.ok(new Date(reapresentada.verificacaoSolicitadaEm) > new Date(antes.verificacaoSolicitadaEm as string));
    assert.equal((await (await solicitarNovamente(pessoa.cookie)).json()).alterado, false);
    const listada = (await listar()).find(s => s.usuarioId === pessoa.id)!;
    assert.deepEqual([listada.statusVerificacao, listada.verificadoPorPresidenteId, listada.verificadoEm], ["pendente", null, null]);
    assert.equal(await statusAprovado(pessoa.cookie), 403);

    const aprovada = await decidir("aprovacao", pessoa.id);
    assert.equal(aprovada.status, 200);
    assert.equal(await prisma.carteirinha.count({ where: { atletaId: pessoa.id } }), perfil === "atleta" ? 1 : 0);
    assert.equal(await statusAprovado(pessoa.cookie), 200);
  }
});

test("aprovações e decisões simultâneas não duplicam carteirinha nem deixam estado parcial", async () => {
  for (let rodada = 0; rodada < 5; rodada++) {
    // Três aprovações simultâneas do mesmo atleta, por dois presidentes: uma única emissão.
    const outro = rodada === 0 ? await criarPresidente() : presidente;
    const atleta = await cadastrar("atleta");
    const respostas = await Promise.all([presidente.cookie, outro.cookie, presidente.cookie].map(cookie => decidir("aprovacao", atleta.id, cookie)));
    assert.deepEqual(respostas.map(r => r.status), [200, 200, 200]);
    const corpos = await Promise.all(respostas.map(r => r.json()));
    assert.equal(corpos.filter(c => c.alterado).length, 1);
    assert.equal(new Set(corpos.map(c => c.solicitacao.carteirinha.id)).size, 1);
    assert.equal(await prisma.carteirinha.count({ where: { atletaId: atleta.id } }), 1);

    // Aprovação e rejeição simultâneas: exatamente uma decisão prevalece, coerente com a carteirinha.
    const disputado = await cadastrar("atleta");
    const [aprovacao, rejeicao] = await Promise.all([decidir("aprovacao", disputado.id), decidir("rejeicao", disputado.id)]);
    assert.deepEqual([aprovacao.status, rejeicao.status].sort(), [200, 409]);
    const final = await estadoAtleta(disputado.id);
    assert.equal(final.statusVerificacao, aprovacao.status === 200 ? "aprovado" : "rejeitado");
    assert.equal(final.carteirinha !== null, final.statusVerificacao === "aprovado");
  }
  // Atletas distintos aprovados ao mesmo tempo recebem códigos e tokens distintos.
  const atletas = await Promise.all(Array.from({ length: 4 }, () => cadastrar("atleta")));
  assert.deepEqual((await Promise.all(atletas.map(a => decidir("aprovacao", a.id)))).map(r => r.status), [200, 200, 200, 200]);
  const carteirinhas = await prisma.carteirinha.findMany({ where: { atletaId: { in: atletas.map(a => a.id) } } });
  assert.equal(new Set(carteirinhas.map(c => c.codigo)).size, 4);
  assert.equal(new Set(carteirinhas.map(c => c.tokenQr)).size, 4);
});

test("falha no commit desfaz aprovação, vínculo e carteirinha; banco exige aprovado com carteirinha", async () => {
  const atleta = await cadastrar("atleta");
  await prisma.$executeRawUnsafe(`CREATE FUNCTION falhar_carteirinha_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."atletaId" = '${atleta.id}'::uuid THEN RAISE EXCEPTION 'Falha simulada na emissão'; END IF; RETURN NULL; END $$`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER falhar_carteirinha_teste AFTER INSERT ON "Carteirinha" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION falhar_carteirinha_teste()`);
  try {
    assert.equal((await decidir("aprovacao", atleta.id)).status, 500);
    const estado = await estadoAtleta(atleta.id);
    assert.deepEqual([estado.statusVerificacao, estado.verificadoPorPresidenteId, estado.verificadoEm, estado.carteirinha, estado.vinculos[0].definidoPorPresidenteId], ["pendente", null, null, null, null]);
    assert.equal(await statusAprovado(atleta.cookie), 403);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER falhar_carteirinha_teste ON "Carteirinha"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION falhar_carteirinha_teste()`);
  }
  // Nova tentativa conclui.
  assert.equal((await decidir("aprovacao", atleta.id)).status, 200);
  assert.equal(await prisma.carteirinha.count({ where: { atletaId: atleta.id } }), 1);

  // Restrições diretas no banco, independentes da aplicação.
  const pendente = await cadastrar("atleta");
  const aprovacao = { statusVerificacao: "aprovado" as const, verificadoPorPresidenteId: presidente.id, verificadoEm: new Date() };
  await assert.rejects(prisma.atleta.update({ where: { usuarioId: pendente.id }, data: aprovacao }), "aprovado sem carteirinha");
  await assert.rejects(prisma.carteirinha.create({ data: { atletaId: pendente.id, codigo: randomUUID(), tokenQr: randomUUID(), emitidaEm: new Date(), emitidaPorPresidenteId: presidente.id } }), "carteirinha sem aprovação");
  await assert.rejects(prisma.carteirinha.delete({ where: { atletaId: atleta.id } }), "remover carteirinha de aprovado");
  await assert.rejects(prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { statusVerificacao: "rejeitado" } }), "retirar aprovação");
  const outra = await cadastrar("atleta");
  await prisma.atleta.update({ where: { usuarioId: outra.id }, data: { ...aprovacao, ...carteirinhaFicticia(presidente.id) } });
  const { codigo, tokenQr } = (await estadoAtleta(atleta.id)).carteirinha!;
  await assert.rejects(prisma.carteirinha.update({ where: { atletaId: outra.id }, data: { codigo } }), { code: "P2002" });
  await assert.rejects(prisma.carteirinha.update({ where: { atletaId: outra.id }, data: { tokenQr } }), { code: "P2002" });
  await assert.rejects(prisma.carteirinha.update({ where: { atletaId: outra.id }, data: { atletaId: atleta.id } }), { code: "P2002" });
  assert.equal((await estadoAtleta(pendente.id)).statusVerificacao, "pendente");
});

test("aprovação indevida é recusada sem efeitos", async () => {
  const alvo = await cadastrar("atleta");
  const tecnicoAprovado = await cadastrar("tecnico");
  assert.equal((await decidir("aprovacao", tecnicoAprovado.id)).status, 200);
  const atletaAprovado = await cadastrar("atleta");
  assert.equal((await decidir("aprovacao", atletaAprovado.id)).status, 200);
  const tecnicoPendente = await cadastrar("tecnico");

  const operacoes: ["GET" | "POST", string, unknown?][] = [
    ["GET", "/verificacoes"],
    ["POST", `/verificacoes/${alvo.id}/aprovacao`, {}],
    ["POST", `/verificacoes/${alvo.id}/rejeicao`, {}],
  ];
  for (const [metodo, path, body] of operacoes) {
    assert.equal((await request(metodo, path, "", body)).status, 401, `${metodo} ${path} sem sessão`);
    // Ninguém além do presidente decide, inclusive sobre o próprio cadastro.
    for (const { cookie } of [alvo, tecnicoAprovado, atletaAprovado, tecnicoPendente]) {
      assert.equal((await request(metodo, path, cookie, body)).status, 403, `${metodo} ${path}`);
    }
  }
  assert.equal((await decidir("aprovacao", alvo.id, alvo.cookie)).status, 403);
  // Escrita sem origem do cliente é recusada antes da autorização.
  assert.equal((await request("POST", `/verificacoes/${alvo.id}/aprovacao`, presidente.cookie, {}, false)).status, 403);
  // Presidente não usa a nova solicitação.
  assert.equal((await solicitarNovamente(presidente.cookie)).status, 403);

  // Entradas forjadas ou inválidas.
  for (const body of [{ verificadoPorPresidenteId: alvo.id }, { carteirinha: { codigo: "FORJADO" } }, { statusVerificacao: "aprovado" }]) {
    assert.equal((await decidir("aprovacao", alvo.id, presidente.cookie, body)).status, 400);
    assert.equal((await decidir("rejeicao", alvo.id, presidente.cookie, body)).status, 400);
  }
  assert.equal((await decidir("aprovacao", "nao-uuid")).status, 400);
  for (const query of ["?status=todos", "?perfil=presidente", "?clubeId=x"]) assert.equal((await request("GET", `/verificacoes${query}`, presidente.cookie)).status, 400);
  // Inexistente e presidente não têm solicitação.
  for (const id of [randomUUID(), presidente.id]) {
    assert.equal((await decidir("aprovacao", id)).status, 404);
    assert.equal((await decidir("rejeicao", id)).status, 404);
  }
  // Conta desativada não recebe decisão; continua listada com ativo false.
  const desativado = await cadastrar("atleta");
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  assert.equal((await decidir("aprovacao", desativado.id)).status, 409);
  assert.equal((await decidir("rejeicao", desativado.id)).status, 409);
  assert.equal((await listar()).find(s => s.usuarioId === desativado.id)?.ativo, false);
  // Presidente desativado perde a operação com a mesma sessão.
  const presidenteDesativado = await criarPresidente();
  await prisma.usuario.update({ where: { id: presidenteDesativado.id }, data: { ativo: false } });
  assert.equal((await decidir("aprovacao", alvo.id, presidenteDesativado.cookie)).status, 401);
  assert.equal((await request("GET", "/verificacoes", presidenteDesativado.cookie)).status, 401);

  const estado = await estadoAtleta(alvo.id);
  assert.deepEqual([estado.statusVerificacao, estado.carteirinha, estado.verificadoPorPresidenteId], ["pendente", null, null]);
  assert.equal((await estadoAtleta(desativado.id)).statusVerificacao, "pendente");

  // Contrato OpenAPI publica as rotas.
  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const [path, metodo] of [["/verificacoes", "get"], ["/verificacoes/solicitacao", "post"], ["/verificacoes/{usuarioId}/aprovacao", "post"], ["/verificacoes/{usuarioId}/rejeicao", "post"]]) {
    assert.ok(contrato.paths[path]?.[metodo], `${metodo} ${path}`);
  }
});
