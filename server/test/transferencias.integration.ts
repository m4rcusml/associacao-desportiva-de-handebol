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
import { transicionarCampeonato } from "../dist/modules/campeonatos/campeonatos.js";

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

type Metodo = "GET" | "POST" | "PUT";
const request = (method: Metodo, path: string, cookie = "", body?: unknown, comOrigem = true) => fetch(`${base}${path}`, {
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
    await tx.authUser.create({ data: { id: authId, name: "Presidente de transferências", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente de transferências", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, decisao = "aprovacao" }: { clubeId?: string; decisao?: "aprovacao" | "rejeicao" | null } = {}) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: "Pessoa Fictícia", email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  if (decisao) assert.equal((await request("POST", `/verificacoes/${id}/${decisao}`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function criarClube(nome = "Clube de transferências") {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
async function campeonatoCom(clubesInscritos: string[], iniciar = false) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato de transferências", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  if (iniciar) assert.equal((await request("POST", `/campeonatos/${id}/iniciar`, presidente.cookie)).status, 200);
  return id;
}

type Vinculo = { id: string; inicio: string; fim: string | null; definidoPorPresidenteId: string | null; clube: { id: string; nome: string; cidade: string | null } };
type Historico = { atleta: { id: string; nomeCompleto: string; ativo: boolean; statusVerificacao: string }; clubeAtual: { id: string } | null; vinculos: Vinculo[]; alterado?: boolean };
const transferir = (atletaId: string, body: unknown, cookie = presidente.cookie) => request("POST", `/atletas/${atletaId}/transferencia`, cookie, body);
const historico = async (atletaId: string): Promise<Historico> => (await request("GET", `/atletas/${atletaId}/vinculos`, presidente.cookie)).json();
const vinculosNoBanco = (atletaId: string) => prisma.vinculoClube.findMany({ where: { atletaId }, orderBy: { inicio: "asc" } });

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
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
  await app.close();
});

test("presidente transfere atleta aprovado sem sobreposição nem lacuna e preserva o vínculo original", async () => {
  const [a, b, c] = [await criarClube("Clube A"), await criarClube("Clube B"), await criarClube("Clube C")];
  const atleta = await cadastrar("atleta", { clubeId: a });
  const inicial = (await vinculosNoBanco(atleta.id))[0];

  const response = await transferir(atleta.id.toUpperCase(), { clubeAtualId: a.toUpperCase(), clubeDestinoId: b });
  assert.equal(response.status, 200, await response.clone().text());
  const corpo: Historico = await response.json();
  assert.equal(corpo.alterado, true);
  assert.equal(corpo.clubeAtual?.id, b);
  assert.deepEqual(corpo.atleta, { id: atleta.id, nomeCompleto: "Pessoa Fictícia", ativo: true, statusVerificacao: "aprovado" });
  assert.deepEqual(corpo.vinculos.map(v => v.clube.id), [a, b]);
  const [antigo, novo] = corpo.vinculos;
  assert.equal(antigo.id, inicial.id, "o vínculo original continua sendo o mesmo registro");
  assert.equal(antigo.inicio, inicial.inicio.toISOString());
  assert.equal(antigo.fim, novo.inicio, "fim do anterior é o início do seguinte");
  assert.equal(novo.fim, null);
  assert.deepEqual([antigo.definidoPorPresidenteId, novo.definidoPorPresidenteId], [presidente.id, presidente.id]);
  // A sessão do atleta passa a refletir o novo clube; a carteirinha continua a mesma.
  assert.equal((await (await request("GET", "/sessao", atleta.cookie)).json()).usuario.clubeId, b);
  assert.equal(await prisma.carteirinha.count({ where: { atletaId: atleta.id, status: "ativa" } }), 1);

  // Repetição da mesma transferência não cria vínculo.
  const repetida: Historico = await (await transferir(atleta.id, { clubeAtualId: a, clubeDestinoId: b })).json();
  assert.equal(repetida.alterado, false);
  assert.equal(repetida.vinculos.length, 2);
  // Origem desatualizada: 409. Nova transferência a partir do clube atual, inclusive de volta ao primeiro.
  assert.equal((await transferir(atleta.id, { clubeAtualId: a, clubeDestinoId: c })).status, 409);
  assert.equal((await transferir(atleta.id, { clubeAtualId: b, clubeDestinoId: a })).status, 200);
  const final = await historico(atleta.id);
  assert.deepEqual(final.vinculos.map(v => v.clube.id), [a, b, a]);
  assert.equal(final.vinculos[1].fim, final.vinculos[2].inicio);
  assert.deepEqual(final.vinculos.slice(0, 2).map(v => [v.id, v.inicio, v.fim]), corpo.vinculos.map(v => [v.id, v.inicio, v.fim ?? final.vinculos[1].fim]));
  assert.equal(await prisma.vinculoClube.count({ where: { atletaId: atleta.id, fim: null } }), 1);

  // Validação de entrada e recursos inexistentes.
  for (const body of [{}, { clubeAtualId: a }, { clubeAtualId: a, clubeDestinoId: a }, { clubeAtualId: "x", clubeDestinoId: b }, { clubeAtualId: a, clubeDestinoId: b, inicio: new Date().toISOString() }]) {
    assert.equal((await transferir(atleta.id, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await transferir(atleta.id, { clubeAtualId: a, clubeDestinoId: randomUUID() })).status, 404);
  assert.equal((await transferir(randomUUID(), { clubeAtualId: a, clubeDestinoId: b })).status, 404);
  assert.equal((await transferir("nao-uuid", { clubeAtualId: a, clubeDestinoId: b })).status, 400);
  const tecnico = await cadastrar("tecnico");
  assert.equal((await transferir(tecnico.id, { clubeAtualId: a, clubeDestinoId: b })).status, 404);
  assert.equal((await request("GET", `/atletas/${tecnico.id}/vinculos`, presidente.cookie)).status, 404);
  assert.equal((await vinculosNoBanco(atleta.id)).length, 3);
});

test("somente atleta aprovado é transferido; conta desativada pode ser transferida", async () => {
  const [a, b] = [await criarClube(), await criarClube()];
  const pendente = await cadastrar("atleta", { clubeId: a, decisao: null });
  const rejeitado = await cadastrar("atleta", { clubeId: a, decisao: "rejeicao" });
  for (const { id } of [pendente, rejeitado]) {
    assert.equal((await transferir(id, { clubeAtualId: a, clubeDestinoId: b })).status, 409);
    assert.equal((await vinculosNoBanco(id)).length, 1, "cadastro inicial não vira transferência");
  }
  const desativado = await cadastrar("atleta", { clubeId: a });
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  const response = await transferir(desativado.id, { clubeAtualId: a, clubeDestinoId: b });
  assert.equal(response.status, 200, await response.clone().text());
  const corpo: Historico = await response.json();
  assert.equal(corpo.atleta.ativo, false);
  assert.equal(corpo.clubeAtual?.id, b);
});

test("campeonato em andamento do clube atual bloqueia a transferência até terminar", async () => {
  const [a, b, c, d] = [await criarClube(), await criarClube(), await criarClube(), await criarClube()];
  const atleta = await cadastrar("atleta", { clubeId: a });
  // Campeonato planejado do clube atual e campeonato em andamento só do destino não impedem.
  const planejado = await campeonatoCom([a, b]);
  await campeonatoCom([c, d], true);
  assert.equal((await transferir(atleta.id, { clubeAtualId: a, clubeDestinoId: c })).status, 200);
  assert.equal((await transferir(atleta.id, { clubeAtualId: c, clubeDestinoId: a })).status, 409, "agora o clube atual (C) está em campeonato em andamento");

  const outro = await cadastrar("atleta", { clubeId: a });
  // Iniciado o campeonato do clube A, a transferência fica bloqueada, sem exceção por fase (PEN-017).
  assert.equal((await request("POST", `/campeonatos/${planejado}/iniciar`, presidente.cookie)).status, 200);
  const bloqueada = await transferir(outro.id, { clubeAtualId: a, clubeDestinoId: d });
  assert.equal(bloqueada.status, 409);
  assert.match((await bloqueada.json()).message, /campeonato em andamento/);
  assert.equal((await vinculosNoBanco(outro.id)).length, 1);
  // Encerrado (ou cancelado), o bloqueio deixa de valer.
  assert.equal((await request("POST", `/campeonatos/${planejado}/encerrar`, presidente.cookie)).status, 200);
  const e = await criarClube();
  assert.equal((await transferir(outro.id, { clubeAtualId: a, clubeDestinoId: e })).status, 200);
  const cancelavel = await campeonatoCom([e, b], true);
  assert.equal((await transferir(outro.id, { clubeAtualId: e, clubeDestinoId: b })).status, 409);
  assert.equal((await request("POST", `/campeonatos/${cancelavel}/cancelar`, presidente.cookie)).status, 200);
  assert.equal((await transferir(outro.id, { clubeAtualId: e, clubeDestinoId: b })).status, 200);
});

test("restrições do banco impedem reescrever vínculos, lacunas e transferência com campeonato em andamento", async () => {
  const [a, b, c] = [await criarClube(), await criarClube(), await criarClube()];
  const atleta = await cadastrar("atleta", { clubeId: a });
  assert.equal((await transferir(atleta.id, { clubeAtualId: a, clubeDestinoId: b })).status, 200);
  const [antigo, atual] = await vinculosNoBanco(atleta.id);
  // Vínculo encerrado e identificação do vínculo atual são imutáveis.
  for (const data of [{ fim: new Date() }, { clubeId: c }, { definidoPorPresidenteId: null }]) {
    await assert.rejects(prisma.vinculoClube.update({ where: { id: antigo.id }, data }), JSON.stringify(data));
  }
  for (const data of [{ clubeId: c }, { inicio: new Date(0) }, { definidoPorPresidenteId: (await criarPresidente()).id }]) {
    await assert.rejects(prisma.vinculoClube.update({ where: { id: atual.id }, data }), JSON.stringify(data));
  }
  // Encerrar sem abrir o seguinte é recusado no commit; abrir com lacuna, sem presidente ou no mesmo clube também.
  await assert.rejects(prisma.vinculoClube.update({ where: { id: atual.id }, data: { fim: new Date() } }));
  const fechar = (tx: typeof prisma) => tx.$executeRaw`UPDATE "VinculoClube" SET fim = now() WHERE id = ${atual.id}::uuid`;
  for (const novo of [
    (tx: typeof prisma) => tx.$executeRaw`INSERT INTO "VinculoClube" (id, "atletaId", "clubeId", inicio, "definidoPorPresidenteId") VALUES (gen_random_uuid(), ${atleta.id}::uuid, ${c}::uuid, now() + interval '1 second', ${presidente.id}::uuid)`,
    (tx: typeof prisma) => tx.$executeRaw`INSERT INTO "VinculoClube" (id, "atletaId", "clubeId", inicio) VALUES (gen_random_uuid(), ${atleta.id}::uuid, ${c}::uuid, now())`,
    (tx: typeof prisma) => tx.$executeRaw`INSERT INTO "VinculoClube" (id, "atletaId", "clubeId", inicio, "definidoPorPresidenteId") VALUES (gen_random_uuid(), ${atleta.id}::uuid, ${b}::uuid, now(), ${presidente.id}::uuid)`,
  ]) {
    await assert.rejects(prisma.$transaction(async tx => { await fechar(tx as typeof prisma); await novo(tx as typeof prisma); }));
  }
  // Atleta pendente não tem vínculo encerrado, mesmo pelo banco.
  const pendente = await cadastrar("atleta", { clubeId: a, decisao: null });
  const [vinculoPendente] = await vinculosNoBanco(pendente.id);
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "VinculoClube" SET fim = now() WHERE id = ${vinculoPendente.id}::uuid`;
    await tx.$executeRaw`INSERT INTO "VinculoClube" (id, "atletaId", "clubeId", inicio, "definidoPorPresidenteId") VALUES (gen_random_uuid(), ${pendente.id}::uuid, ${c}::uuid, now(), ${presidente.id}::uuid)`;
  }));
  // Clube atual em campeonato em andamento: o banco recusa mesmo sem passar pela aplicação.
  await campeonatoCom([b, c], true);
  await assert.rejects(prisma.$transaction(async tx => {
    await fechar(tx as typeof prisma);
    await tx.$executeRaw`INSERT INTO "VinculoClube" (id, "atletaId", "clubeId", inicio, "definidoPorPresidenteId") VALUES (gen_random_uuid(), ${atleta.id}::uuid, ${a}::uuid, now(), ${presidente.id}::uuid)`;
  }));
  assert.deepEqual(await vinculosNoBanco(atleta.id), [antigo, atual]);
  assert.deepEqual(await vinculosNoBanco(pendente.id), [vinculoPendente]);
});

test("falha após encerrar o vínculo desfaz a transferência inteira", async () => {
  const [a, b] = [await criarClube(), await criarClube()];
  const atleta = await cadastrar("atleta", { clubeId: a });
  const antes = await vinculosNoBanco(atleta.id);
  await assert.rejects(prisma.$transaction(async tx => {
    await transferirAtleta(tx, atleta.id, presidente.id, { clubeAtualId: a, clubeDestinoId: b });
    assert.equal(await tx.vinculoClube.count({ where: { atletaId: atleta.id } }), 2);
    throw new Error("falha simulada antes do commit");
  }), /falha simulada/);
  assert.deepEqual(await vinculosNoBanco(atleta.id), antes);
  assert.equal((await historico(atleta.id)).clubeAtual?.id, a);
});

test("transferências concorrentes do mesmo atleta não criam dois vínculos atuais", async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const [a, b, c] = [await criarClube(), await criarClube(), await criarClube()];
    const atleta = await cadastrar("atleta", { clubeId: a });
    // Destinos diferentes: uma vence; a outra vê o clube atual mudado.
    const respostas = await Promise.all([b, c].map(destino => transferir(atleta.id, { clubeAtualId: a, clubeDestinoId: destino })));
    assert.deepEqual(respostas.map(r => r.status).sort(), [200, 409]);
    const vinculos = await vinculosNoBanco(atleta.id);
    assert.equal(vinculos.length, 2);
    assert.equal(vinculos.filter(v => v.fim === null).length, 1);
    // Mesmo destino repetido em paralelo: uma alteração e as demais sem efeito.
    const outro = await cadastrar("atleta", { clubeId: a });
    const iguais = await Promise.all([1, 2, 3].map(() => transferir(outro.id, { clubeAtualId: a, clubeDestinoId: b })));
    assert.deepEqual(iguais.map(r => r.status), [200, 200, 200]);
    assert.deepEqual((await Promise.all(iguais.map(r => r.json() as Promise<Historico>))).map(h => h.alterado).sort(), [false, false, true]);
    assert.equal((await vinculosNoBanco(outro.id)).length, 2);
  }
});

test("início do campeonato e transferência concorrentes se serializam", async () => {
  // Campeonato iniciando (lock do campeonato mantido) antes da transferência: ela aguarda e é recusada.
  const [a, b, c] = [await criarClube(), await criarClube(), await criarClube()];
  const atleta = await cadastrar("atleta", { clubeId: a });
  const campeonato = await campeonatoCom([a, b]);
  let pedido: Promise<Response> | undefined;
  await prisma.$transaction(async tx => {
    await transicionarCampeonato(tx, campeonato, "iniciar");
    pedido = transferir(atleta.id, { clubeAtualId: a, clubeDestinoId: c });
    await esperar(300);
  });
  const recusada = await pedido!;
  assert.equal(recusada.status, 409, await recusada.clone().text());
  assert.equal((await vinculosNoBanco(atleta.id)).length, 1);

  // Transferência em curso antes do início: o início aguarda o commit e não a desfaz.
  const [d, e, f] = [await criarClube(), await criarClube(), await criarClube()];
  const outro = await cadastrar("atleta", { clubeId: d });
  const segundo = await campeonatoCom([d, e]);
  let inicio: Promise<Response> | undefined;
  let concluido = false;
  await prisma.$transaction(async tx => {
    await transferirAtleta(tx, outro.id, presidente.id, { clubeAtualId: d, clubeDestinoId: f });
    inicio = request("POST", `/campeonatos/${segundo}/iniciar`, presidente.cookie).then(r => { concluido = true; return r; });
    await esperar(300);
    assert.equal(concluido, false, "o início espera a transferência terminar");
  });
  assert.equal((await inicio!).status, 200);
  assert.equal((await historico(outro.id)).clubeAtual?.id, f);

  // Disputa direta, várias vezes: nunca transferência confirmada depois do início confirmado.
  for (let rodada = 0; rodada < 3; rodada++) {
    const [x, y, z] = [await criarClube(), await criarClube(), await criarClube()];
    const disputado = await cadastrar("atleta", { clubeId: x });
    const alvo = await campeonatoCom([x, y]);
    const [transferencia, iniciou] = await Promise.all([
      transferir(disputado.id, { clubeAtualId: x, clubeDestinoId: z }),
      request("POST", `/campeonatos/${alvo}/iniciar`, presidente.cookie),
    ]);
    assert.equal(iniciou.status, 200);
    assert.ok([200, 409].includes(transferencia.status), String(transferencia.status));
    const vinculos = await vinculosNoBanco(disputado.id);
    assert.equal(vinculos.length, transferencia.status === 200 ? 2 : 1);
  }
});

test("somente presidente ativo transfere e consulta vínculos; contrato OpenAPI publica as rotas", async () => {
  const [a, b] = [await criarClube(), await criarClube()];
  const atleta = await cadastrar("atleta", { clubeId: a });
  const tecnico = await cadastrar("tecnico");
  assert.equal((await request("PUT", `/clubes/${a}/tecnico`, presidente.cookie, { tecnicoId: tecnico.id })).status, 200);
  const operacoes: [Metodo, string, unknown?][] = [
    ["GET", `/atletas/${atleta.id}/vinculos`],
    ["POST", `/atletas/${atleta.id}/transferencia`, { clubeAtualId: a, clubeDestinoId: b }],
  ];
  for (const [metodo, path, body] of operacoes) {
    assert.equal((await request(metodo, path, "", body)).status, 401, `${metodo} ${path} sem sessão`);
    for (const { cookie } of [tecnico, atleta]) assert.equal((await request(metodo, path, cookie, body)).status, 403, `${metodo} ${path}`);
    if (metodo !== "GET") assert.equal((await request(metodo, path, presidente.cookie, body, false)).status, 403, `${metodo} ${path} sem origem`);
  }
  const desativado = await criarPresidente();
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  for (const [metodo, path, body] of operacoes) assert.equal((await request(metodo, path, desativado.cookie, body)).status, 401);
  assert.equal((await vinculosNoBanco(atleta.id)).length, 1);

  const contrato = await (await request("GET", "/openapi.json")).json();
  assert.ok(contrato.paths["/atletas/{atletaId}/vinculos"]?.get);
  assert.ok(contrato.paths["/atletas/{atletaId}/transferencia"]?.post);
});
