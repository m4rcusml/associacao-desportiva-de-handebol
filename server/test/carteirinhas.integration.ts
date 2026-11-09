import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import type { Prisma } from "../dist/generated/prisma/client.js";
import { alterarStatus, substituirQr } from "../dist/modules/carteirinhas/carteirinhas.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let base: string;
const password = "Senha-local-de-teste-2026";
const emails: string[] = [];
const clubeId = randomUUID();
const clubeDestinoId = randomUUID();
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };

const request = (method: "GET" | "POST", path: string, cookie = "", body?: unknown, comOrigem = true, extras: Record<string, string> = {}) => fetch(`${base}${path}`, {
  method,
  headers: { ...(comOrigem ? { Origin: origin } : {}), "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extras },
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
    await tx.authUser.create({ data: { id: authId, name: "Presidente das carteirinhas", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente das carteirinhas", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
async function cadastrar(perfil: "atleta" | "tecnico") {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: `Pessoa ${perfil}`, email, password, perfil, ...(perfil === "atleta" ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const { usuario } = await response.json();
  return { id: usuario.id as string, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;
async function atletaAprovado() {
  const atleta = await cadastrar("atleta");
  const resposta = await request("POST", `/verificacoes/${atleta.id}/aprovacao`, presidente.cookie, {});
  assert.equal(resposta.status, 200, await resposta.clone().text());
  return atleta;
}
const operar = (operacao: "invalidacao" | "reativacao" | "substituicao-qr", atletaId: string, body: unknown = {}, cookie = presidente.cookie) =>
  request("POST", `/carteirinhas/atleta/${atletaId}/${operacao}`, cookie, body);
const ler = (tokenQr: string, cookie = presidente.cookie) => request("POST", "/carteirinhas/leitura", cookie, { tokenQr });
async function consultar(atletaId: string) {
  const resposta = await request("GET", `/carteirinhas/atleta/${atletaId}`, presidente.cookie);
  assert.equal(resposta.status, 200, await resposta.clone().text());
  return await resposta.json();
}
async function propria(cookie: string) {
  const resposta = await request("GET", "/carteirinhas/minha", cookie);
  assert.equal(resposta.status, 200, await resposta.clone().text());
  return await resposta.json();
}
const statusAprovado = async (cookie: string) => (await request("GET", "/protegida/aprovado", cookie)).status;
const eventos = (atletaId: string) => prisma.eventoCarteirinha.count({ where: { carteirinha: { atletaId } } });

// Retém o commit da primeira operação até comprovar no PostgreSQL que a concorrente aguarda seu lock.
async function concorrer<T>(primeira: (tx: Prisma.TransactionClient) => Promise<T>, segunda: () => Promise<Response>) {
  let sinalizarPronta!: (pid: number) => void;
  let falhar!: (error: unknown) => void;
  let liberar!: () => void;
  const pronta = new Promise<number>((resolve, reject) => { sinalizarPronta = resolve; falhar = reject; });
  const liberacao = new Promise<void>(resolve => { liberar = resolve; });
  const transacao = prisma.$transaction(async tx => {
    const resultado = await primeira(tx);
    const [conexao] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    sinalizarPronta(conexao.pid);
    await liberacao;
    return resultado;
  });
  void transacao.catch(falhar);
  const pid = await pronta;
  const concorrente = segunda();
  try {
    const limite = Date.now() + 2_000;
    let bloqueada = false;
    while (!bloqueada && Date.now() < limite) {
      const [estado] = await prisma.$queryRaw<{ bloqueada: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS bloqueada`;
      bloqueada = estado.bloqueada;
      if (!bloqueada) await esperar(10);
    }
    assert.equal(bloqueada, true, "a operação concorrente deve aguardar o commit da primeira");
  } finally {
    liberar();
    await Promise.all([transacao, concorrente]);
  }
  return { primeira: await transacao, segunda: await concorrente };
}

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
  await prisma.clube.create({ data: { id: clubeId, nome: "Clube das carteirinhas", criadoPorPresidenteId: presidente.id } });
  await prisma.clube.create({ data: { id: clubeDestinoId, nome: "Clube de destino das carteirinhas", criadoPorPresidenteId: presidente.id } });
});

after(async () => {
  await prisma.$transaction(async tx => {
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = (await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id);
    await tx.vinculoClube.deleteMany({ where: { atletaId: { in: ids } } });
    // A exclusão da carteirinha remove seu histórico em cascata; o histórico isolado não pode ser removido.
    await tx.carteirinha.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.atleta.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.tecnico.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.clube.deleteMany({ where: { id: { in: [clubeId, clubeDestinoId] } } });
    await tx.presidente.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
  });
  await app.close();
});

test("atleta consulta a própria carteirinha; leitura do QR devolve somente identificação mínima", async () => {
  const atleta = await atletaAprovado();
  const minha = await propria(atleta.cookie);
  assert.deepEqual(Object.keys(minha).sort(), ["clubeAtual", "codigo", "emitidaEm", "id", "nomeCompleto", "possuiFoto", "status", "tokenQr"]);
  assert.deepEqual([minha.status, minha.nomeCompleto, minha.clubeAtual, minha.possuiFoto], ["ativa", "Pessoa atleta", { id: clubeId, nome: "Clube das carteirinhas" }, false]);
  assert.equal(JSON.stringify(minha).includes(atleta.email), false, "carteirinha não exibe e-mail");
  assert.match(minha.tokenQr, /^[A-Za-z0-9_-]{43}$/);

  const detalhe = await consultar(atleta.id.toUpperCase());
  assert.deepEqual({ ...detalhe, emitidaEm: undefined }, {
    id: minha.id, atletaId: atleta.id, nomeCompleto: "Pessoa atleta", clubeAtual: { id: clubeId, nome: "Clube das carteirinhas" }, possuiFoto: false,
    codigo: minha.codigo, tokenQr: minha.tokenQr, versaoQr: 1, status: "ativa", emitidaEm: undefined, emitidaPorPresidenteId: presidente.id, historico: [],
  });
  assert.equal(JSON.stringify(detalhe).includes(atleta.email), false, "visão do presidente também sem e-mail");

  const leitura = await ler(minha.tokenQr);
  assert.equal(leitura.status, 200, await leitura.clone().text());
  const identificacao = await leitura.json();
  assert.deepEqual(identificacao, { carteirinhaId: minha.id, codigo: minha.codigo, status: "ativa", atleta: { usuarioId: atleta.id, nomeCompleto: "Pessoa atleta" } });
  assert.equal(JSON.stringify(identificacao).includes(atleta.email), false);
  // O código manual não substitui o token na leitura; token desconhecido não é reconhecido.
  assert.equal((await ler(minha.codigo)).status, 404);
  assert.equal((await ler(randomUUID())).status, 404);
});

test("carteirinha indica a foto sem expor a chave e permanece a mesma após transferência, com o clube atual", async () => {
  const atleta = await atletaAprovado();
  const antes = await propria(atleta.cookie);
  const chave = `atletas/${atleta.id}/${randomUUID()}.webp`;
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { fotoChave: chave } });
  const comFoto = await propria(atleta.cookie);
  assert.equal(comFoto.possuiFoto, true);
  assert.equal(JSON.stringify(comFoto).includes(chave), false, "chave do armazenamento não é exposta");
  assert.equal(JSON.stringify(await consultar(atleta.id)).includes(chave), false);
  assert.equal((await consultar(atleta.id)).possuiFoto, true);
  // QR sozinho continua sem foto nem clube.
  const leitura = await (await ler(antes.tokenQr)).json();
  assert.deepEqual(Object.keys(leitura).sort(), ["atleta", "carteirinhaId", "codigo", "status"]);

  const transferencia = await request("POST", `/atletas/${atleta.id}/transferencia`, presidente.cookie, { clubeAtualId: clubeId, clubeDestinoId });
  assert.equal(transferencia.status, 200, await transferencia.clone().text());
  const depois = await propria(atleta.cookie);
  assert.deepEqual({ ...depois, clubeAtual: undefined }, { ...comFoto, clubeAtual: undefined }, "mesma carteirinha: id, código, QR e situação");
  assert.deepEqual(depois.clubeAtual, { id: clubeDestinoId, nome: "Clube de destino das carteirinhas" });
  assert.deepEqual((await consultar(atleta.id)).clubeAtual, { id: clubeDestinoId, nome: "Clube de destino das carteirinhas" });

  // Invalidada, a carteirinha segue exibida com a situação; sem foto continua utilizável.
  await prisma.atleta.update({ where: { usuarioId: atleta.id }, data: { fotoChave: null } });
  assert.equal((await operar("invalidacao", atleta.id)).status, 200);
  const invalidada = await propria(atleta.cookie);
  assert.deepEqual([invalidada.status, invalidada.possuiFoto, invalidada.codigo], ["invalidada", false, antes.codigo]);
});

test("invalidar e reativar registram histórico e responsável sem bloquear a conta", async () => {
  const atleta = await atletaAprovado();
  const outro = await criarPresidente();
  const { tokenQr, codigo, id } = await propria(atleta.cookie);

  const invalidada = await operar("invalidacao", atleta.id);
  assert.equal(invalidada.status, 200, await invalidada.clone().text());
  const primeira = await invalidada.json();
  assert.equal(primeira.alterado, true);
  assert.deepEqual([primeira.carteirinha.status, primeira.carteirinha.id, primeira.carteirinha.codigo, primeira.carteirinha.tokenQr], ["invalidada", id, codigo, tokenQr]);
  assert.equal(primeira.carteirinha.historico.length, 1);
  assert.deepEqual({ ...primeira.carteirinha.historico[0], ocorridoEm: undefined }, { tipo: "invalidacao", versaoQr: 1, presidenteId: presidente.id, ocorridoEm: undefined });

  // Repetição não gera novo histórico.
  const repetida = await (await operar("invalidacao", atleta.id, undefined, outro.cookie)).json();
  assert.deepEqual(repetida, { ...primeira, alterado: false });
  assert.equal(await eventos(atleta.id), 1);

  // Conta, sessão e aprovação continuam válidas; a leitura identifica a carteirinha como invalidada.
  assert.equal(await statusAprovado(atleta.cookie), 200);
  await login(atleta.email);
  assert.equal((await propria(atleta.cookie)).status, "invalidada");
  assert.equal((await (await ler(tokenQr)).json()).status, "invalidada");
  const conta = await prisma.usuario.findUniqueOrThrow({ where: { id: atleta.id }, include: { atleta: true } });
  assert.deepEqual([conta.ativo, conta.atleta?.statusVerificacao], [true, "aprovado"]);

  const reativada = await (await operar("reativacao", atleta.id, {}, outro.cookie)).json();
  assert.equal(reativada.alterado, true);
  assert.equal(reativada.carteirinha.status, "ativa");
  assert.deepEqual(reativada.carteirinha.historico.map((e: { tipo: string; presidenteId: string }) => [e.tipo, e.presidenteId]), [["invalidacao", presidente.id], ["reativacao", outro.id]]);
  assert.equal((await (await operar("reativacao", atleta.id)).json()).alterado, false);
  assert.equal(await eventos(atleta.id), 2);
  assert.equal((await (await ler(tokenQr)).json()).status, "ativa");
});

test("substituir QR invalida o token anterior na mesma carteirinha e é idempotente por versão", async () => {
  const atleta = await atletaAprovado();
  const original = await propria(atleta.cookie);
  assert.equal((await operar("invalidacao", atleta.id)).status, 200);

  const resposta = await operar("substituicao-qr", atleta.id, { versaoQr: 1 });
  assert.equal(resposta.status, 200, await resposta.clone().text());
  const { carteirinha, alterado } = await resposta.json();
  assert.equal(alterado, true);
  // Mesma carteirinha, mesmo código e status; novo token e versão seguinte.
  assert.deepEqual([carteirinha.id, carteirinha.codigo, carteirinha.status, carteirinha.versaoQr], [original.id, original.codigo, "invalidada", 2]);
  assert.notEqual(carteirinha.tokenQr, original.tokenQr);
  assert.match(carteirinha.tokenQr, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(carteirinha.historico.map((e: { tipo: string; versaoQr: number; presidenteId: string }) => [e.tipo, e.versaoQr, e.presidenteId]),
    [["invalidacao", 1, presidente.id], ["substituicao_qr", 2, presidente.id]]);
  assert.equal(await prisma.carteirinha.count({ where: { atletaId: atleta.id } }), 1);

  // Token antigo deixa de funcionar; o novo identifica a mesma carteirinha e chega ao atleta.
  assert.equal((await ler(original.tokenQr)).status, 404);
  assert.equal((await (await ler(carteirinha.tokenQr)).json()).carteirinhaId, original.id);
  assert.equal((await propria(atleta.cookie)).tokenQr, carteirinha.tokenQr);

  // Reenvio da substituição da versão 1 devolve o QR já substituído, sem novo token ou histórico.
  const repetida = await (await operar("substituicao-qr", atleta.id, { versaoQr: 1 })).json();
  assert.deepEqual(repetida, { carteirinha, alterado: false });
  assert.equal((await operar("substituicao-qr", atleta.id, { versaoQr: 3 })).status, 409);
  const segunda = await (await operar("substituicao-qr", atleta.id, { versaoQr: 2 })).json();
  assert.deepEqual([segunda.alterado, segunda.carteirinha.versaoQr], [true, 3]);
  for (const token of [original.tokenQr, carteirinha.tokenQr]) assert.equal((await ler(token)).status, 404);
  assert.equal((await ler(segunda.carteirinha.tokenQr)).status, 200);
  assert.equal(await eventos(atleta.id), 3);
  // Substituição não reativa: a carteirinha continua invalidada até reativação explícita.
  assert.equal((await propria(atleta.cookie)).status, "invalidada");
});

test("operações simultâneas na mesma carteirinha não duplicam efeitos", async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const atleta = await atletaAprovado();
    const { tokenQr } = await propria(atleta.cookie);

    // Substituição retida no commit e reenvio da mesma versão: a segunda aguarda e não gera outro QR.
    const { primeira, segunda } = await concorrer(tx => substituirQr(tx, presidente.id, atleta.id, 1), () => operar("substituicao-qr", atleta.id, { versaoQr: 1 }));
    assert.equal(primeira.alterado, true);
    assert.equal(segunda.status, 200, await segunda.clone().text());
    const repetida = await segunda.json();
    assert.deepEqual([repetida.alterado, repetida.carteirinha.tokenQr, repetida.carteirinha.versaoQr], [false, primeira.carteirinha.tokenQr, 2]);
    assert.equal((await ler(tokenQr)).status, 404);

    // Invalidação retida e invalidação concorrente: um único evento.
    const disputa = await concorrer(tx => alterarStatus(tx, presidente.id, atleta.id, "invalidada"), () => operar("invalidacao", atleta.id));
    assert.equal((await disputa.segunda.json()).alterado, false);

    // Pedidos HTTP paralelos: reativações e substituições da mesma versão.
    const reativacoes = await Promise.all([1, 2, 3].map(() => operar("reativacao", atleta.id)));
    assert.deepEqual(reativacoes.map(r => r.status), [200, 200, 200]);
    assert.equal((await Promise.all(reativacoes.map(r => r.json()))).filter(c => c.alterado).length, 1);
    const substituicoes = await Promise.all([1, 2, 3].map(() => operar("substituicao-qr", atleta.id, { versaoQr: 2 })));
    const corpos = await Promise.all(substituicoes.map(r => r.json()));
    assert.equal(corpos.filter(c => c.alterado).length, 1);
    assert.equal(new Set(corpos.map(c => c.carteirinha.tokenQr)).size, 1);

    const final = await consultar(atleta.id);
    assert.deepEqual([final.status, final.versaoQr], ["ativa", 3]);
    assert.deepEqual(final.historico.map((e: { tipo: string }) => e.tipo), ["substituicao_qr", "invalidacao", "reativacao", "substituicao_qr"]);
  }
});

test("banco preserva identificação, versões e histórico da carteirinha", async () => {
  const atleta = await atletaAprovado();
  assert.equal((await operar("invalidacao", atleta.id)).status, 200);
  const carteirinha = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: atleta.id }, include: { eventos: true } });
  const onde = { where: { id: carteirinha.id } };
  for (const data of [
    { codigo: `OUTRO-${randomUUID()}` }, { emitidaEm: new Date(0) }, { tokenQr: randomUUID() },
    { tokenQr: randomUUID(), versaoQr: 3 }, { versaoQr: 2 }, { tokenQr: randomUUID(), versaoQr: 0 },
  ]) {
    await assert.rejects(prisma.carteirinha.update({ ...onde, data }), JSON.stringify(data));
  }
  const evento = { where: { id: carteirinha.eventos[0].id } };
  await assert.rejects(prisma.eventoCarteirinha.update({ ...evento, data: { presidenteId: atleta.id } }));
  await assert.rejects(prisma.eventoCarteirinha.update({ ...evento, data: { ocorridoEm: new Date(0) } }));
  await assert.rejects(prisma.eventoCarteirinha.delete(evento));
  const intacta = await prisma.carteirinha.findUniqueOrThrow({ ...onde, include: { eventos: true } });
  assert.deepEqual(intacta, carteirinha);
});

test("acesso indevido à carteirinha é recusado sem efeitos; QR não autentica", async () => {
  const alvo = await atletaAprovado();
  const { tokenQr } = await propria(alvo.cookie);
  const outroAtleta = await atletaAprovado();
  const tecnico = await cadastrar("tecnico");
  assert.equal((await request("POST", `/verificacoes/${tecnico.id}/aprovacao`, presidente.cookie, {})).status, 200);
  const pendente = await cadastrar("atleta");

  const operacoes: ["GET" | "POST", string, unknown?][] = [
    ["GET", `/carteirinhas/atleta/${alvo.id}`],
    ["POST", `/carteirinhas/atleta/${alvo.id}/invalidacao`, {}],
    ["POST", `/carteirinhas/atleta/${alvo.id}/reativacao`, {}],
    ["POST", `/carteirinhas/atleta/${alvo.id}/substituicao-qr`, { versaoQr: 1 }],
    ["POST", "/carteirinhas/leitura", { tokenQr }],
  ];
  for (const [metodo, path, body] of operacoes) {
    assert.equal((await request(metodo, path, "", body)).status, 401, `${metodo} ${path} sem sessão`);
    // Só o presidente opera, inclusive sobre a própria carteirinha do atleta.
    for (const { cookie } of [alvo, outroAtleta, tecnico, pendente]) assert.equal((await request(metodo, path, cookie, body)).status, 403, `${metodo} ${path}`);
  }
  // Consulta própria: só atleta, e somente após emissão.
  assert.equal((await request("GET", "/carteirinhas/minha", "")).status, 401);
  assert.equal((await request("GET", "/carteirinhas/minha", tecnico.cookie)).status, 403);
  assert.equal((await request("GET", "/carteirinhas/minha", presidente.cookie)).status, 403);
  assert.equal((await request("GET", "/carteirinhas/minha", pendente.cookie)).status, 404);
  assert.notEqual((await propria(outroAtleta.cookie)).tokenQr, tokenQr);

  // O token do QR não serve como sessão ou credencial.
  const credenciaisForjadas: Record<string, string>[] = [{ Authorization: `Bearer ${tokenQr}` }, { Cookie: `better-auth.session_token=${tokenQr}` }];
  for (const extras of credenciaisForjadas) {
    assert.equal((await request("GET", "/carteirinhas/minha", "", undefined, true, extras)).status, 401);
    assert.equal((await request("POST", "/carteirinhas/leitura", "", { tokenQr }, true, extras)).status, 401);
  }
  // Escrita sem origem do cliente é recusada antes da autorização.
  assert.equal((await request("POST", `/carteirinhas/atleta/${alvo.id}/invalidacao`, presidente.cookie, {}, false)).status, 403);

  // Entradas forjadas ou inválidas.
  for (const body of [{ status: "ativa" }, { presidenteId: alvo.id }]) {
    assert.equal((await operar("invalidacao", alvo.id, body)).status, 400);
    assert.equal((await operar("reativacao", alvo.id, body)).status, 400);
  }
  for (const body of [{}, { versaoQr: 0 }, { versaoQr: "1" }, { versaoQr: 1.5 }, { versaoQr: 1, tokenQr: "FORJADO" }]) {
    assert.equal((await operar("substituicao-qr", alvo.id, body)).status, 400, JSON.stringify(body));
  }
  for (const body of [{}, { tokenQr: "" }, { tokenQr: "x".repeat(257) }, { tokenQr, usuarioId: alvo.id }]) {
    assert.equal((await request("POST", "/carteirinhas/leitura", presidente.cookie, body)).status, 400);
  }
  assert.equal((await request("GET", `/carteirinhas/leitura?tokenQr=${tokenQr}`, presidente.cookie)).status, 404, "token não é aceito na URL");
  assert.equal((await operar("invalidacao", "nao-uuid")).status, 400);
  // Sem carteirinha: inexistente, técnico, atleta pendente e presidente.
  for (const id of [randomUUID(), tecnico.id, pendente.id, presidente.id]) {
    assert.equal((await request("GET", `/carteirinhas/atleta/${id}`, presidente.cookie)).status, 404);
    assert.equal((await operar("invalidacao", id)).status, 404);
    assert.equal((await operar("substituicao-qr", id, { versaoQr: 1 })).status, 404);
  }
  // Presidente desativado perde a operação com a mesma sessão.
  const desativado = await criarPresidente();
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  assert.equal((await operar("invalidacao", alvo.id, {}, desativado.cookie)).status, 401);
  assert.equal((await ler(tokenQr, desativado.cookie)).status, 401);

  const estado = await consultar(alvo.id);
  assert.deepEqual([estado.status, estado.versaoQr, estado.tokenQr, estado.historico], ["ativa", 1, tokenQr, []]);

  // Contrato OpenAPI publica as rotas.
  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const [path, metodo] of [
    ["/carteirinhas/minha", "get"], ["/carteirinhas/leitura", "post"], ["/carteirinhas/atleta/{atletaId}", "get"],
    ["/carteirinhas/atleta/{atletaId}/invalidacao", "post"], ["/carteirinhas/atleta/{atletaId}/reativacao", "post"], ["/carteirinhas/atleta/{atletaId}/substituicao-qr", "post"],
  ]) {
    assert.ok(contrato.paths[path]?.[metodo], `${metodo} ${path}`);
  }
});
