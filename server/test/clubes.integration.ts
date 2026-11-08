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
const clubes: string[] = [];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
    await tx.authUser.create({ data: { id: authId, name: "Presidente de clubes", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente de clubes", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
async function cadastrar(perfil: "atleta" | "tecnico", clubeId?: string) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera o limite de cadastro por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: "Pessoa Fictícia", email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const { usuario } = await response.json();
  return { id: usuario.id as string, email, cookie: await login(email) };
}

let presidente: Awaited<ReturnType<typeof criarPresidente>>;
const aprovar = (usuarioId: string) => prisma.tecnico.update({ where: { usuarioId }, data: { statusVerificacao: "aprovado", verificadoPorPresidenteId: presidente.id, verificadoEm: new Date() } });
async function tecnicoAprovado() {
  const tecnico = await cadastrar("tecnico");
  await aprovar(tecnico.id);
  return tecnico;
}
async function criarClube(nome = "Clube fictício", cidade?: string | null) {
  const response = await request("POST", "/clubes", presidente.cookie, { nome, ...(cidade === undefined ? {} : { cidade }) });
  assert.equal(response.status, 201, await response.clone().text());
  const clube = await response.json();
  clubes.push(clube.id);
  return clube;
}
const atribuir = (clubeId: string, tecnicoId: string, substituirTecnicoId?: string, cookie = presidente.cookie) =>
  request("PUT", `/clubes/${clubeId}/tecnico`, cookie, { tecnicoId, ...(substituirTecnicoId ? { substituirTecnicoId } : {}) });
const clubeDoTecnico = async (usuarioId: string) => (await prisma.tecnico.findUniqueOrThrow({ where: { usuarioId } })).clubeId;
const acessoAoClube = async (clubeId: string, cookie: string) => (await request("GET", `/protegida/clubes/${clubeId}`, cookie)).status;

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    const identities = await tx.authUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = (await tx.usuario.findMany({ where: { authId: { in: identities.map(i => i.id) } }, select: { id: true } })).map(u => u.id);
    await tx.vinculoClube.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.carteirinha.deleteMany({ where: { atletaId: { in: ids } } });
    await tx.atleta.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.tecnico.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.clube.deleteMany({ where: { id: { in: clubes } } });
    await tx.presidente.deleteMany({ where: { usuarioId: { in: ids } } });
    await tx.usuario.deleteMany({ where: { id: { in: ids } } });
    await tx.authUser.deleteMany({ where: { email: { in: emails } } });
  });
  await app.close();
});

test("presidente cria, consulta e edita clubes; listagem pública e cadastro seguem funcionando", async () => {
  const clube = await criarClube("  Clube Repetido  ", "Recife");
  assert.deepEqual({ ...clube, id: undefined }, { id: undefined, nome: "Clube Repetido", cidade: "Recife", criadoPorPresidenteId: presidente.id, tecnico: null });
  // Nome não precisa ser único; cidade é opcional.
  const homonimo = await criarClube("Clube Repetido");
  assert.notEqual(homonimo.id, clube.id);
  assert.equal(homonimo.cidade, null);

  // Listagem pública continua mínima e sem sessão.
  const publica = await (await request("GET", "/clubes")).json() as Record<string, unknown>[];
  const listado = publica.find(c => c.id === clube.id);
  assert.deepEqual(listado, { id: clube.id, nome: "Clube Repetido", cidade: "Recife" });

  // Regressão do cadastro: atleta escolhe clube criado pela API.
  const atleta = await cadastrar("atleta", clube.id);
  const vinculo = await prisma.vinculoClube.findFirstOrThrow({ where: { atletaId: atleta.id } });
  assert.equal(vinculo.clubeId, clube.id);

  // Edição de nome/cidade preserva o mesmo clube e os vínculos.
  const editado = await request("PATCH", `/clubes/${clube.id.toUpperCase()}`, presidente.cookie, { nome: "Clube Renomeado" });
  assert.equal(editado.status, 200, await editado.clone().text());
  assert.deepEqual(await editado.json(), { ...clube, nome: "Clube Renomeado" });
  const semCidade = await (await request("PATCH", `/clubes/${clube.id}`, presidente.cookie, { cidade: null })).json();
  assert.equal(semCidade.cidade, null);
  assert.equal(semCidade.nome, "Clube Renomeado");
  assert.deepEqual(await prisma.vinculoClube.findUniqueOrThrow({ where: { id: vinculo.id } }), vinculo);
  const consulta = await request("GET", `/clubes/${clube.id}`, presidente.cookie);
  assert.equal(consulta.status, 200);
  assert.deepEqual(await consulta.json(), semCidade);

  // Validação: campos administrativos forjados, corpo vazio, nomes inválidos e IDs inexistentes.
  for (const body of [{}, { nome: "" }, { nome: "X" }, { nome: "Válido", criadoPorPresidenteId: randomUUID() }, { nome: "Válido", tecnicoId: randomUUID() }, { id: randomUUID(), nome: "Válido" }]) {
    assert.equal((await request("POST", "/clubes", presidente.cookie, body)).status, 400, JSON.stringify(body));
  }
  for (const body of [{}, { nome: " " }, { criadoPorPresidenteId: randomUUID() }, { nome: "Válido", id: randomUUID() }]) {
    assert.equal((await request("PATCH", `/clubes/${clube.id}`, presidente.cookie, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await request("GET", `/clubes/${randomUUID()}`, presidente.cookie)).status, 404);
  assert.equal((await request("PATCH", `/clubes/${randomUUID()}`, presidente.cookie, { nome: "Inexistente" })).status, 404);
  assert.equal((await request("GET", "/clubes/nao-uuid", presidente.cookie)).status, 400);
  // Não há exclusão de clubes.
  assert.equal((await request("DELETE", `/clubes/${clube.id}`, presidente.cookie)).status, 404);
  assert.equal(await prisma.clube.count({ where: { id: clube.id } }), 1);
});

test("atribuir, substituir e desvincular técnico; clube pode ficar sem técnico", async () => {
  const clube = await criarClube("Clube da vaga");
  const outroClube = await criarClube("Outro clube");
  const [primeiro, segundo] = [await tecnicoAprovado(), await tecnicoAprovado()];

  const atribuido = await atribuir(clube.id, primeiro.id.toUpperCase());
  assert.equal(atribuido.status, 200, await atribuido.clone().text());
  assert.deepEqual((await atribuido.json()).tecnico, { id: primeiro.id, nomeCompleto: "Pessoa Fictícia", ativo: true });
  assert.equal(await acessoAoClube(clube.id, primeiro.cookie), 200);
  // Repetir a mesma atribuição não altera nada.
  assert.equal((await atribuir(clube.id, primeiro.id)).status, 200);

  // Clube ocupado: atribuir sem indicar o técnico atual, ou indicando outro, é recusado.
  assert.equal((await atribuir(clube.id, segundo.id)).status, 409);
  assert.equal((await atribuir(clube.id, segundo.id, randomUUID())).status, 409);
  // Clube vazio não aceita substituição de técnico inexistente.
  assert.equal((await atribuir(outroClube.id, segundo.id, primeiro.id)).status, 409);
  // Técnico já atribuído não ocupa outro clube.
  assert.equal((await atribuir(outroClube.id, primeiro.id)).status, 409);
  assert.equal(await clubeDoTecnico(segundo.id), null);
  assert.equal((await (await request("GET", `/clubes/${outroClube.id}`, presidente.cookie)).json()).tecnico, null);

  // Substituição explícita: o anterior perde o clube e o acesso já na requisição seguinte.
  const substituido = await atribuir(clube.id, segundo.id, primeiro.id);
  assert.equal(substituido.status, 200, await substituido.clone().text());
  assert.equal((await substituido.json()).tecnico.id, segundo.id);
  assert.equal(await clubeDoTecnico(primeiro.id), null);
  assert.equal(await acessoAoClube(clube.id, primeiro.cookie), 403);
  assert.equal(await acessoAoClube(clube.id, segundo.cookie), 200);
  // O anterior, agora sem clube, pode ser atribuído a outro clube.
  assert.equal((await atribuir(outroClube.id, primeiro.id)).status, 200);

  // Desvincular exige o técnico atual; o clube fica sem técnico e continua existindo.
  assert.equal((await request("DELETE", `/clubes/${clube.id}/tecnico/${primeiro.id}`, presidente.cookie)).status, 409);
  const desvinculado = await request("DELETE", `/clubes/${clube.id}/tecnico/${segundo.id.toUpperCase()}`, presidente.cookie);
  assert.equal(desvinculado.status, 200, await desvinculado.clone().text());
  assert.equal((await desvinculado.json()).tecnico, null);
  assert.equal(await clubeDoTecnico(segundo.id), null);
  assert.equal(await acessoAoClube(clube.id, segundo.cookie), 403);
  assert.equal((await request("DELETE", `/clubes/${clube.id}/tecnico/${segundo.id}`, presidente.cookie)).status, 409);
  assert.equal((await request("DELETE", `/clubes/${randomUUID()}/tecnico/${segundo.id}`, presidente.cookie)).status, 404);
  assert.equal((await request("GET", `/clubes/${clube.id}`, presidente.cookie)).status, 200);
  // Vaga livre volta a aceitar atribuição simples.
  assert.equal((await atribuir(clube.id, segundo.id)).status, 200);
});

test("somente técnico aprovado e ativo pode ser atribuído; banco recusa atalhos", async () => {
  const clube = await criarClube("Clube das regras");
  const pendente = await cadastrar("tecnico");
  const rejeitado = await cadastrar("tecnico");
  await prisma.tecnico.update({ where: { usuarioId: rejeitado.id }, data: { statusVerificacao: "rejeitado" } });
  const inativo = await tecnicoAprovado();
  await prisma.usuario.update({ where: { id: inativo.id }, data: { ativo: false } });
  const atleta = await cadastrar("atleta", clube.id);

  for (const tecnico of [pendente, rejeitado, inativo]) assert.equal((await atribuir(clube.id, tecnico.id)).status, 409);
  for (const id of [atleta.id, presidente.id, randomUUID()]) assert.equal((await atribuir(clube.id, id)).status, 404);
  assert.equal((await atribuir(randomUUID(), pendente.id)).status, 404);
  for (const body of [{}, { tecnicoId: "nao-uuid" }, { tecnicoId: pendente.id, clubeId: clube.id }]) {
    assert.equal((await request("PUT", `/clubes/${clube.id}/tecnico`, presidente.cookie, body)).status, 400);
  }
  assert.equal((await (await request("GET", `/clubes/${clube.id}`, presidente.cookie)).json()).tecnico, null);

  // Restrições no banco, independentes da aplicação: técnico não aprovado e segunda ocupação da vaga.
  await assert.rejects(prisma.tecnico.update({ where: { usuarioId: pendente.id }, data: { clubeId: clube.id } }));
  const [a, b] = [await tecnicoAprovado(), await tecnicoAprovado()];
  await prisma.tecnico.update({ where: { usuarioId: a.id }, data: { clubeId: clube.id } });
  await assert.rejects(prisma.tecnico.update({ where: { usuarioId: b.id }, data: { clubeId: clube.id } }), { code: "P2002" });
});

test("atribuições concorrentes à mesma vaga ou ao mesmo técnico: exatamente uma conclui", async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const clube = await criarClube(`Clube concorrido ${rodada}`);
    const candidatos = [await tecnicoAprovado(), await tecnicoAprovado(), await tecnicoAprovado()];
    const respostas = await Promise.all(candidatos.map(t => atribuir(clube.id, t.id)));
    assert.deepEqual(respostas.map(r => r.status).sort(), [200, 409, 409]);
    assert.equal(await prisma.tecnico.count({ where: { clubeId: clube.id } }), 1);
    const vencedor = candidatos[respostas.findIndex(r => r.status === 200)];
    assert.equal((await (await request("GET", `/clubes/${clube.id}`, presidente.cookie)).json()).tecnico.id, vencedor.id);

    // Duas substituições simultâneas a partir do mesmo técnico atual: só a primeira prevalece.
    const restantes = candidatos.filter(t => t !== vencedor);
    const trocas = await Promise.all(restantes.map(t => atribuir(clube.id, t.id, vencedor.id)));
    assert.deepEqual(trocas.map(r => r.status).sort(), [200, 409]);
    assert.equal(await prisma.tecnico.count({ where: { clubeId: clube.id } }), 1);

    // Mesmo técnico em dois clubes vazios ao mesmo tempo.
    const [c1, c2] = [await criarClube(`Clube paralelo A ${rodada}`), await criarClube(`Clube paralelo B ${rodada}`)];
    const tecnico = await tecnicoAprovado();
    const paralelas = await Promise.all([c1, c2].map(c => atribuir(c.id, tecnico.id)));
    assert.deepEqual(paralelas.map(r => r.status).sort(), [200, 409]);
    assert.equal(await prisma.tecnico.count({ where: { clubeId: { in: [c1.id, c2.id] } } }), 1);
  }
});

test("acessos indevidos às operações de clubes são recusados sem efeitos", async () => {
  const clube = await criarClube("Clube protegido", "Olinda");
  const tecnicoDoClube = await tecnicoAprovado();
  assert.equal((await atribuir(clube.id, tecnicoDoClube.id)).status, 200);
  const outroTecnico = await tecnicoAprovado();
  const atletaAprovado = await cadastrar("atleta", clube.id);
  await prisma.atleta.update({ where: { usuarioId: atletaAprovado.id }, data: { statusVerificacao: "aprovado", verificadoPorPresidenteId: presidente.id, verificadoEm: new Date(), ...carteirinhaFicticia(presidente.id) } });
  const tecnicoPendente = await cadastrar("tecnico");

  const operacoes: [Metodo, string, unknown?][] = [
    ["POST", "/clubes", { nome: "Clube indevido" }],
    ["PATCH", `/clubes/${clube.id}`, { nome: "Nome indevido" }],
    ["PUT", `/clubes/${clube.id}/tecnico`, { tecnicoId: outroTecnico.id, substituirTecnicoId: tecnicoDoClube.id }],
    ["DELETE", `/clubes/${clube.id}/tecnico/${tecnicoDoClube.id}`],
  ];
  for (const [metodo, path, body] of operacoes) {
    assert.equal((await request(metodo, path, "", body)).status, 401, `${metodo} ${path} sem sessão`);
    for (const { cookie } of [tecnicoDoClube, outroTecnico, atletaAprovado, tecnicoPendente]) {
      assert.equal((await request(metodo, path, cookie, body)).status, 403, `${metodo} ${path}`);
    }
    // Escrita sem origem do cliente é recusada antes da autorização.
    assert.equal((await request(metodo, path, presidente.cookie, body, false)).status, 403);
  }

  // Presidente desativado perde o acesso com a mesma sessão.
  const desativado = await criarPresidente();
  assert.equal((await request("GET", `/clubes/${clube.id}`, desativado.cookie)).status, 200);
  await prisma.usuario.update({ where: { id: desativado.id }, data: { ativo: false } });
  for (const [metodo, path, body] of operacoes) assert.equal((await request(metodo, path, desativado.cookie, body)).status, 401);

  const estado = await (await request("GET", `/clubes/${clube.id}`, presidente.cookie)).json();
  assert.deepEqual(estado, { id: clube.id, nome: "Clube protegido", cidade: "Olinda", criadoPorPresidenteId: presidente.id, tecnico: { id: tecnicoDoClube.id, nomeCompleto: "Pessoa Fictícia", ativo: true } });
  assert.equal(await prisma.clube.count({ where: { nome: "Clube indevido" } }), 0);
  assert.equal(await clubeDoTecnico(outroTecnico.id), null);

  // Contrato OpenAPI publica as novas rotas.
  const contrato = await (await request("GET", "/openapi.json")).json();
  for (const [path, metodo] of [["/clubes", "get"], ["/clubes", "post"], ["/clubes/visao-geral", "get"], ["/clubes/{clubeId}", "get"], ["/clubes/{clubeId}", "patch"], ["/clubes/{clubeId}/tecnico", "put"], ["/clubes/{clubeId}/tecnico/{tecnicoId}", "delete"]]) {
    assert.ok(contrato.paths[path]?.[metodo], `${metodo} ${path}`);
  }
});

test("visão geral e consulta de clubes: contas autenticadas e ativas; ativo do técnico só para presidente", async () => {
  const comTecnico = await criarClube("Clube visível com técnico", "Natal");
  const semTecnico = await criarClube("Clube visível sem técnico");
  const tecnico = await tecnicoAprovado();
  assert.equal((await atribuir(comTecnico.id, tecnico.id)).status, 200);
  const atletaPendente = await cadastrar("atleta", comTecnico.id);
  const tecnicoPendente = await cadastrar("tecnico");
  const dadosTecnico = { id: tecnico.id, nomeCompleto: "Pessoa Fictícia" };
  const daLista = async (cookie: string) => {
    const response = await request("GET", "/clubes/visao-geral", cookie);
    assert.equal(response.status, 200, await response.clone().text());
    const lista = await response.json() as { id: string }[];
    return [comTecnico.id, semTecnico.id].map(id => lista.find(c => c.id === id));
  };

  // Presidente: técnico com situação da conta e dados administrativos.
  assert.deepEqual(await daLista(presidente.cookie), [
    { id: comTecnico.id, nome: "Clube visível com técnico", cidade: "Natal", criadoPorPresidenteId: presidente.id, tecnico: { ...dadosTecnico, ativo: true } },
    { id: semTecnico.id, nome: "Clube visível sem técnico", cidade: null, criadoPorPresidenteId: presidente.id, tecnico: null },
  ]);
  // Técnico e atleta, inclusive pendentes: mesma lista sem `ativo` nem criador.
  const semAdministrativo = [
    { id: comTecnico.id, nome: "Clube visível com técnico", cidade: "Natal", tecnico: dadosTecnico },
    { id: semTecnico.id, nome: "Clube visível sem técnico", cidade: null, tecnico: null },
  ];
  for (const { cookie } of [tecnico, atletaPendente, tecnicoPendente]) {
    assert.deepEqual(await daLista(cookie), semAdministrativo);
    const detalhe = await request("GET", `/clubes/${comTecnico.id}`, cookie);
    assert.equal(detalhe.status, 200);
    assert.deepEqual(await detalhe.json(), semAdministrativo[0]);
  }
  // Situação da conta do técnico refletida apenas para o presidente.
  await prisma.usuario.update({ where: { id: tecnico.id }, data: { ativo: false } });
  assert.deepEqual((await (await request("GET", `/clubes/${comTecnico.id}`, presidente.cookie)).json()).tecnico, { ...dadosTecnico, ativo: false });
  assert.deepEqual((await daLista(atletaPendente.cookie))[0], semAdministrativo[0]);

  // Sem sessão e conta desativada: 401. A rota pública continua mínima, sem técnico.
  const atletaDesativado = await cadastrar("atleta", semTecnico.id);
  await prisma.usuario.update({ where: { id: atletaDesativado.id }, data: { ativo: false } });
  for (const cookie of ["", tecnico.cookie, atletaDesativado.cookie]) {
    assert.equal((await request("GET", "/clubes/visao-geral", cookie)).status, 401);
    assert.equal((await request("GET", `/clubes/${comTecnico.id}`, cookie)).status, 401);
  }
  const publica = await (await request("GET", "/clubes")).json() as Record<string, unknown>[];
  assert.deepEqual(publica.find(c => c.id === comTecnico.id), { id: comTecnico.id, nome: "Clube visível com técnico", cidade: "Natal" });
});

test("técnico atribuído com conta desativada continua no clube e pode ser substituído ou desvinculado", async () => {
  const clube = await criarClube("Clube com técnico desativado");
  const [inativo, substituto] = [await tecnicoAprovado(), await tecnicoAprovado()];
  assert.equal((await atribuir(clube.id, inativo.id)).status, 200);
  await prisma.usuario.update({ where: { id: inativo.id }, data: { ativo: false } });
  assert.equal(await clubeDoTecnico(inativo.id), clube.id);

  // Substituição informando o técnico inativo como atual.
  const trocado = await atribuir(clube.id, substituto.id, inativo.id);
  assert.equal(trocado.status, 200, await trocado.clone().text());
  assert.deepEqual((await trocado.json()).tecnico, { id: substituto.id, nomeCompleto: "Pessoa Fictícia", ativo: true });
  assert.equal(await clubeDoTecnico(inativo.id), null);
  // Atribuir técnico inativo continua recusado.
  const outroClube = await criarClube("Clube sem técnico inativo");
  assert.equal((await atribuir(outroClube.id, inativo.id)).status, 409);
  assert.equal((await atribuir(clube.id, inativo.id, substituto.id)).status, 409);

  // Desvincular técnico atribuído que teve a conta desativada.
  await prisma.usuario.update({ where: { id: substituto.id }, data: { ativo: false } });
  const desvinculado = await request("DELETE", `/clubes/${clube.id}/tecnico/${substituto.id}`, presidente.cookie);
  assert.equal(desvinculado.status, 200, await desvinculado.clone().text());
  assert.equal((await desvinculado.json()).tecnico, null);
  assert.equal(await clubeDoTecnico(substituto.id), null);
});
