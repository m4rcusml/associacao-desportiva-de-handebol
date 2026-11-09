import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import type { Prisma } from "../dist/generated/prisma/client.js";
import { alterarVisualizacao, encerrarAcessoArbitragem, revalidarArbitragem, revalidarArbitragemOuEncerramento } from "../dist/modules/arbitragem/acesso.js";
import { CofreSenhaArbitragem } from "../dist/modules/arbitragem/senha.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
const cofre = app.get(CofreSenhaArbitragem);
let base: string;
const password = "Senha-local-de-teste-2026";
const emails: string[] = [];
const clubes: string[] = [];
const campeonatos: string[] = [];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };

type Metodo = "GET" | "POST" | "PUT" | "DELETE";
const request = (method: Metodo, path: string, cookie = "", body?: unknown, comOrigem = true) => fetch(`${base}${path}`, {
  method,
  headers: { ...(comOrigem ? { Origin: origin } : {}), "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const cookies = (response: Response) => response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
async function login(email: string) {
  const response = await request("POST", "/auth/sign-in/email", "", { email, password });
  assert.equal(response.status, 200, await response.clone().text());
  return cookies(response);
}
async function criarPresidente() {
  const email = novoEmail();
  const authId = randomUUID();
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.authUser.create({ data: { id: authId, name: "Presidente da arbitragem", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente da arbitragem", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
let presidente: Awaited<ReturnType<typeof criarPresidente>>;

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, nome = "Árbitra Cadastrada" }: { clubeId?: string; nome?: string } = {}) {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  assert.equal((await request("POST", `/verificacoes/${id}/aprovacao`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function campeonatoComClubes() {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato da arbitragem", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  campeonatos.push(id);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const clube = await prisma.clube.create({ data: { nome: `Clube arbitragem ${i}`, criadoPorPresidenteId: presidente.id } });
    clubes.push(clube.id);
    assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId: clube.id })).status, 201);
    ids.push(clube.id);
  }
  return { id: id as string, clubes: ids };
}

/** Data local (AAAA-MM-DD) no fuso, deslocada em dias a partir de agora. */
const dataLocal = (fuso: string, dias = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + dias * 86_400_000));

async function jogo({ fuso = "America/Recife", data = dataLocal(fuso), campeonato }: { fuso?: string; data?: string; campeonato?: Awaited<ReturnType<typeof campeonatoComClubes>> } = {}) {
  campeonato ??= await campeonatoComClubes();
  const response = await request("POST", `/campeonatos/${campeonato.id}/jogos`, presidente.cookie, { clubeAId: campeonato.clubes[0], clubeBId: campeonato.clubes[1], inicioPrevisto: `${data}T12:00`, fusoHorario: fuso });
  assert.equal(response.status, 201, await response.clone().text());
  return { id: (await response.json()).id as string, campeonato };
}
async function designar(jogoId: string, usuarioId: string) {
  const response = await request("POST", `/jogos/${jogoId}/arbitragens`, presidente.cookie, { usuarioId });
  assert.equal(response.status, 201, await response.clone().text());
  return ((await response.json()).arbitragens as { id: string; usuario: { id: string } | null }[]).find(a => a.usuario?.id === usuarioId)!.id;
}
const nomeCookie = (jogoId: string) => `handebol.arbitragem.${jogoId}`;
const cookieArbitragem = (response: Response, jogoId: string) => {
  const linha = response.headers.getSetCookie().find(c => c.startsWith(`${nomeCookie(jogoId)}=`));
  assert.ok(linha, "cookie temporário ausente");
  return linha;
};
async function entrarDesignado(jogoId: string, conta: { cookie: string }, esperado = 201) {
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/designacao`, conta.cookie, {});
  assert.equal(response.status, esperado, await response.clone().text());
  return esperado === 201 ? cookieArbitragem(response, jogoId).split(";")[0] : "";
}
async function entrarComSenha(jogoId: string, senha: string, esperado = 201, nomeCompleto = "Pessoa Externa", cookie = "") {
  throttler.onApplicationShutdown();
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, cookie, { nomeCompleto, senha });
  assert.equal(response.status, esperado, await response.clone().text());
  return esperado === 201 ? cookieArbitragem(response, jogoId).split(";")[0] : "";
}
async function consultarSenha(jogoId: string, cookie = presidente.cookie) {
  const response = await request("GET", `/jogos/${jogoId}/arbitragem/senha`, cookie);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).senha as string;
}
const sessao = (jogoId: string, cookie: string) => request("GET", `/arbitragem/jogos/${jogoId}/sessao`, cookie);
const tokenDe = (cookie: string) => decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
const status = (erro: unknown) => (erro as { getStatus?: () => number }).getStatus?.();

before(async () => {
  await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/api`;
  presidente = await criarPresidente();
});

after(async () => {
  await prisma.$transaction(async tx => {
    // Arbitragens, sessões temporárias e senha saem em cascata com o jogo.
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

test("conta designada entra sem senha no dia do jogo, com cookie próprio por jogo e vários dispositivos", async () => {
  const { id } = await jogo();
  const tecnico = await cadastrar("tecnico", { nome: "Técnica Árbitra" });
  const arbitragemId = await designar(id, tecnico.id);

  const response = await request("POST", `/arbitragem/jogos/${id}/entrada/designacao`, tecnico.cookie, { visualizacao: "banco" });
  assert.equal(response.status, 201, await response.clone().text());
  // Somente o cookie temporário é emitido: o da conta não é sobrescrito.
  assert.deepEqual(response.headers.getSetCookie().map(c => c.split("=")[0]), [nomeCookie(id)]);
  const linha = cookieArbitragem(response, id);
  assert.match(linha, /HttpOnly/i);
  assert.match(linha, /SameSite=Lax/i);
  assert.match(linha, /Path=\//i);
  assert.match(linha, /Expires=/i);
  assert.doesNotMatch(linha, /Domain=/i);
  const corpo = await response.json();
  assert.equal(corpo.arbitragem.nomeCompleto, "Técnica Árbitra");
  assert.equal(corpo.arbitragem.visualizacao, "banco");
  assert.equal(corpo.sessao.metodoEntrada, "designacao");
  assert.equal(corpo.podeGerirSenhaPelaConta, true);
  assert.equal(JSON.stringify(corpo).includes("senha\":"), false);
  const temporario = linha.split(";")[0];

  // Somente o hash do token é persistido.
  const token = tokenDe(temporario);
  const gravada = await prisma.sessaoArbitragem.findFirstOrThrow({ where: { arbitragemId } });
  assert.equal(gravada.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.equal(await prisma.sessaoArbitragem.count({ where: { tokenHash: token } }), 0);
  assert.equal(gravada.metodoEntrada, "designacao");
  assert.ok(gravada.authSessionId);

  // O cookie temporário sozinho revalida a sessão; o da conta continua funcionando à parte.
  assert.equal((await sessao(id, temporario)).status, 200);
  assert.equal((await request("GET", "/sessao", tecnico.cookie)).status, 200);
  assert.equal((await sessao(id, tecnico.cookie)).status, 401, "cookie da conta não é sessão de arbitragem");

  // Segundo dispositivo da mesma conta: nova sessão, a anterior continua válida; mesma designação.
  const segundo = await entrarDesignado(id, { cookie: await login(tecnico.email) });
  assert.notEqual(segundo, temporario);
  assert.equal((await sessao(id, temporario)).status, 200);
  assert.equal((await sessao(id, segundo)).status, 200);
  assert.equal(await prisma.arbitragem.count({ where: { jogoId: id } }), 1);
  assert.ok((await prisma.arbitragem.findUniqueOrThrow({ where: { id: arbitragemId } })).acessouEm);

  // Linha/banco muda só a tela, para a designação.
  const troca = await request("PUT", `/arbitragem/jogos/${id}/visualizacao`, segundo, { visualizacao: "linha" });
  assert.equal(troca.status, 200);
  assert.equal((await troca.json()).arbitragem.visualizacao, "linha");
  assert.equal((await request("PUT", `/arbitragem/jogos/${id}/visualizacao`, segundo, { visualizacao: "mesa" })).status, 400);

  // Cookie de um jogo não vale para outro.
  const outro = await jogo();
  await designar(outro.id, tecnico.id);
  const doOutro = await entrarDesignado(outro.id, tecnico);
  assert.equal((await sessao(id, doOutro.replace(nomeCookie(outro.id), nomeCookie(id)))).status, 401);
  assert.equal((await sessao(id, temporario)).status, 200);

  // Saída encerra só este dispositivo e remove o cookie; repetir não tem efeito.
  const saida = await request("POST", `/arbitragem/jogos/${id}/saida`, temporario);
  assert.equal(saida.status, 200);
  assert.deepEqual(await saida.json(), { encerrada: true });
  assert.match(saida.headers.getSetCookie()[0], new RegExp(`^${nomeCookie(id)}=;`));
  assert.equal((await sessao(id, temporario)).status, 401);
  assert.equal((await sessao(id, segundo)).status, 200);
  assert.deepEqual(await (await request("POST", `/arbitragem/jogos/${id}/saida`, temporario)).json(), { encerrada: false });
});

test("entrada sem senha exige conta autenticada, designação e ausência de vínculo com os clubes do jogo", async () => {
  const { id, campeonato } = await jogo();
  const naoDesignado = await cadastrar("tecnico");
  const designado = await cadastrar("tecnico");
  await designar(id, designado.id);

  assert.equal((await request("POST", `/arbitragem/jogos/${id}/entrada/designacao`, "", {})).status, 401);
  await entrarDesignado(id, naoDesignado, 403);
  await entrarDesignado(id, presidente, 403);
  assert.equal((await request("POST", `/arbitragem/jogos/${randomUUID()}/entrada/designacao`, designado.cookie, {})).status, 404);
  assert.equal((await request("POST", `/arbitragem/jogos/${id}/entrada/designacao`, designado.cookie, { senha: "x" })).status, 400);
  assert.equal((await request("POST", `/arbitragem/jogos/${id}/entrada/designacao`, designado.cookie, {}, false)).status, 403, "origem obrigatória");

  const temporario = await entrarDesignado(id, designado);
  // Passa a ser técnico de um dos clubes do jogo: a sessão aberta e novas entradas são barradas.
  assert.equal((await request("PUT", `/clubes/${campeonato.clubes[0]}/tecnico`, presidente.cookie, { tecnicoId: designado.id })).status, 200);
  assert.equal((await sessao(id, temporario)).status, 403);
  await entrarDesignado(id, designado, 403);
  assert.equal((await request("GET", `/jogos/${id}/arbitragem/senha`, designado.cookie)).status, 403);
  assert.equal((await request("POST", `/jogos/${id}/arbitragem/senha/troca`, designado.cookie)).status, 403);
  assert.equal((await request("DELETE", `/clubes/${campeonato.clubes[0]}/tecnico/${designado.id}`, presidente.cookie)).status, 200);
  assert.equal((await sessao(id, temporario)).status, 200);
});

test("acesso no dia do jogo no fuso do local; após meia-noite só continua se o jogo começou", async () => {
  const tecnico = await cadastrar("tecnico");
  // Kiritimati (UTC+14) está sempre ao menos um dia à frente de Pago Pago (UTC−11).
  const diaKiritimati = dataLocal("Pacific/Kiritimati");
  const kiritimati = await jogo({ fuso: "Pacific/Kiritimati", data: diaKiritimati });
  const pagoPago = await jogo({ fuso: "Pacific/Pago_Pago", data: diaKiritimati });
  for (const { id } of [kiritimati, pagoPago]) await designar(id, tecnico.id);
  await entrarDesignado(kiritimati.id, tecnico);
  const antes = await request("POST", `/arbitragem/jogos/${pagoPago.id}/entrada/designacao`, tecnico.cookie, {});
  assert.equal(antes.status, 403);
  assert.match((await antes.json()).message, /somente no dia do jogo/);

  // Jogo de ontem sem início: acesso terminou e depende de reagendamento.
  const ontem = await jogo({ data: dataLocal("America/Recife", -1) });
  await designar(ontem.id, tecnico.id);
  const passou = await request("POST", `/arbitragem/jogos/${ontem.id}/entrada/designacao`, tecnico.cookie, {});
  assert.equal(passou.status, 403);
  assert.match((await passou.json()).message, /reagendamento/);
  // Já iniciado, a virada do dia não encerra: novas entradas continuam até o encerramento.
  await prisma.jogo.update({ where: { id: ontem.id }, data: { status: "em_andamento", iniciadoEm: new Date() } });
  await entrarDesignado(ontem.id, tecnico);

  // Sessão aberta no dia; o dia passa sem início (simulado movendo a data prevista): deixa de valer.
  const hoje = await jogo();
  await designar(hoje.id, tecnico.id);
  const temporario = await entrarDesignado(hoje.id, tecnico);
  const inicio = (await prisma.jogo.findUniqueOrThrow({ where: { id: hoje.id } })).inicioPrevistoEm!;
  await prisma.jogo.update({ where: { id: hoje.id }, data: { inicioPrevistoEm: new Date(inicio.getTime() - 86_400_000) } });
  assert.equal((await sessao(hoje.id, temporario)).status, 403);
  await prisma.jogo.update({ where: { id: hoje.id }, data: { status: "em_andamento", iniciadoEm: new Date() } });
  assert.equal((await sessao(hoje.id, temporario)).status, 200);

  // Amanhã: ainda não abriu. Sem data: depende de reagendamento.
  const amanha = await jogo({ data: dataLocal("America/Recife", 1) });
  await designar(amanha.id, tecnico.id);
  await entrarDesignado(amanha.id, tecnico, 403);
  await prisma.jogo.update({ where: { id: amanha.id }, data: { inicioPrevistoEm: null } });
  const semData = await request("POST", `/arbitragem/jogos/${amanha.id}/entrada/designacao`, tecnico.cookie, {});
  assert.equal(semData.status, 403);
  assert.match((await semData.json()).message, /sem data/);
});

test("senha automática: consulta por presidente e conta designada, entrada com nome e sem conferir vínculo", async () => {
  const { id, campeonato } = await jogo();
  const designado = await cadastrar("tecnico");
  const outraConta = await cadastrar("tecnico");
  await designar(id, designado.id);

  // Antes da primeira emissão não há senha para entrar.
  await entrarComSenha(id, "ABCDE-FGHJK", 401);
  const senha = await consultarSenha(id);
  assert.match(senha, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(await consultarSenha(id), senha, "consulta posterior devolve a mesma senha");
  assert.equal(await consultarSenha(id, designado.cookie), senha);
  const consulta = await request("GET", `/jogos/${id}/arbitragem/senha`, presidente.cookie);
  assert.equal(consulta.headers.get("cache-control"), "no-store");
  assert.equal((await request("GET", `/jogos/${id}/arbitragem/senha`, outraConta.cookie)).status, 403);
  assert.equal((await request("GET", `/jogos/${id}/arbitragem/senha`)).status, 401);

  // Armazenamento: hash e cópia cifrada autenticada; nada em texto.
  const acesso = await prisma.acessoArbitragem.findUniqueOrThrow({ where: { jogoId: id } });
  const normalizada = senha.replace("-", "");
  for (const valor of [acesso.senhaHash, acesso.senhaCifrada]) assert.equal(valor.includes(normalizada) || valor.includes(senha), false);
  assert.match(acesso.senhaCifrada, /^v1\./);
  assert.equal(cofre.decifrar(id, acesso.senhaCifrada), senha);
  assert.throws(() => cofre.decifrar(randomUUID(), acesso.senhaCifrada), "cópia de um jogo não decifra em outro");
  const [v, iv, tag, dados] = acesso.senhaCifrada.split(".");
  const adulterada = [v, iv, tag, Buffer.from(Buffer.from(dados, "base64url").map(b => b ^ 1)).toString("base64url")].join(".");
  assert.throws(() => cofre.decifrar(id, adulterada));

  // Entrada: nome obrigatório; senha errada recusada; maiúsculas/espaços/hífens ignorados.
  assert.equal((await request("POST", `/arbitragem/jogos/${id}/entrada/senha`, "", { senha })).status, 400);
  await entrarComSenha(id, "ZZZZZ-ZZZZZ", 401);
  const externo = await entrarComSenha(id, ` ${normalizada.toLowerCase()} `, 201, "Árbitro Externo");
  const corpo = await (await sessao(id, externo)).json();
  assert.equal(corpo.sessao.metodoEntrada, "senha");
  assert.equal(corpo.arbitragem.nomeCompleto, "Árbitro Externo");
  assert.equal(corpo.podeGerirSenhaPelaConta, false);

  // Pessoa cadastrada de um clube do jogo entra pela senha: sem conferência de vínculo (RN-025), sem conta.
  const atleta = await cadastrar("atleta", { clubeId: campeonato.clubes[0], nome: "Atleta do Clube A" });
  const doClube = await entrarComSenha(id, senha, 201, "Atleta do Clube A", atleta.cookie);
  const registro = await prisma.arbitragem.findMany({ where: { jogoId: id, designadoEm: null }, orderBy: { acessouEm: "asc" } });
  assert.deepEqual(registro.map(r => [r.nomeCompleto, r.usuarioId]), [["Árbitro Externo", null], ["Atleta do Clube A", null]]);
  const detalhe = await (await request("GET", `/jogos/${id}`, presidente.cookie)).json();
  assert.deepEqual(detalhe.arbitragens.map((a: { tipo: string }) => a.tipo), ["cadastrado", "entrada_por_senha", "entrada_por_senha"]);

  // Entrada pela senha não concede consulta nem troca, mesmo para pessoa cadastrada.
  for (const cookie of [externo, doClube]) {
    assert.equal((await request("GET", `/jogos/${id}/arbitragem/senha`, cookie)).status, 401);
    assert.equal((await request("POST", `/jogos/${id}/arbitragem/senha/troca`, cookie)).status, 401);
  }
  assert.equal((await request("GET", `/jogos/${id}/arbitragem/senha`, atleta.cookie)).status, 403);
  // Registro de entrada por senha não é retirado individualmente.
  assert.equal((await request("DELETE", `/jogos/${id}/arbitragens/${registro[0].id}`, presidente.cookie)).status, 409);
});

test("troca da senha revoga as sessões por senha e preserva as designadas; retirar designação revoga as dela", async () => {
  const { id } = await jogo();
  const designado = await cadastrar("tecnico");
  const arbitragemId = await designar(id, designado.id);
  const senha = await consultarSenha(id);
  const porSenha = [await entrarComSenha(id, senha), await entrarComSenha(id, senha, 201, "Outra Pessoa")];
  const porDesignacao = await entrarDesignado(id, designado);

  const troca = await request("POST", `/jogos/${id}/arbitragem/senha/troca`, designado.cookie);
  assert.equal(troca.status, 200, await troca.clone().text());
  const { senha: nova, sessoesRevogadas } = await troca.json();
  assert.notEqual(nova, senha);
  assert.equal(sessoesRevogadas, 2);
  for (const cookie of porSenha) assert.equal((await sessao(id, cookie)).status, 401);
  assert.equal((await sessao(id, porDesignacao)).status, 200);
  assert.equal(await consultarSenha(id), nova);
  await entrarComSenha(id, senha, 401);
  const depois = await entrarComSenha(id, nova);
  assert.deepEqual(
    (await prisma.sessaoArbitragem.findMany({ where: { arbitragem: { jogoId: id }, revogadaEm: { not: null } }, select: { motivoRevogacao: true } })).map(s => s.motivoRevogacao),
    ["troca_senha", "troca_senha"],
  );

  // Presidente também troca.
  assert.equal((await request("POST", `/jogos/${id}/arbitragem/senha/troca`, presidente.cookie)).status, 200);
  assert.equal((await sessao(id, depois)).status, 401);
  assert.equal((await request("POST", `/jogos/${id}/arbitragem/senha/troca`, presidente.cookie, undefined, false)).status, 403, "origem obrigatória");

  // Retirar a designação invalida as sessões dela.
  assert.equal((await request("DELETE", `/jogos/${id}/arbitragens/${arbitragemId}`, presidente.cookie)).status, 200);
  assert.equal((await sessao(id, porDesignacao)).status, 401);
  assert.equal(await prisma.sessaoArbitragem.count({ where: { arbitragemId } }), 0);
  assert.equal((await request("GET", `/jogos/${id}/arbitragem/senha`, designado.cookie)).status, 403);
});

test("logout ou desativação da conta invalida a entrada por designação; senha independe da conta", async () => {
  const { id } = await jogo();
  const tecnico = await cadastrar("tecnico");
  await designar(id, tecnico.id);
  const temporario = await entrarDesignado(id, tecnico);
  assert.equal((await request("POST", "/auth/sign-out", tecnico.cookie, {})).status, 200);
  assert.equal((await sessao(id, temporario)).status, 401, "sessão de origem encerrada");
  // A ausência da sessão de origem não converte a entrada em acesso por senha.
  assert.equal((await prisma.sessaoArbitragem.findFirstOrThrow({ where: { tokenHash: createHash("sha256").update(tokenDe(temporario)).digest("hex") } })).metodoEntrada, "designacao");

  const cookieConta = await login(tecnico.email);
  const novo = await entrarDesignado(id, { cookie: cookieConta });
  const externo = await entrarComSenha(id, await consultarSenha(id), 201, "Mesma Pessoa Pela Senha", cookieConta);
  assert.equal((await request("POST", `/contas/${tecnico.id}/desativacao`, presidente.cookie, {})).status, 200);
  assert.equal((await sessao(id, novo)).status, 401);
  assert.equal((await sessao(id, externo)).status, 200, "entrada por senha não depende da conta (RN-025)");
  assert.equal((await request("POST", `/contas/${tecnico.id}/reativacao`, presidente.cookie, {})).status, 200);
  assert.equal((await sessao(id, novo)).status, 401, "reativar não restaura sessões anteriores");
});

test("tentativas de senha limitadas por IP e entrada exige origem do cliente", async () => {
  const { id } = await jogo();
  await consultarSenha(id);
  throttler.onApplicationShutdown();
  for (let i = 0; i < 10; i++) {
    assert.equal((await request("POST", `/arbitragem/jogos/${id}/entrada/senha`, "", { nomeCompleto: "Tentativa", senha: `ERRADA${i}` })).status, 401);
  }
  const bloqueada = await request("POST", `/arbitragem/jogos/${id}/entrada/senha`, "", { nomeCompleto: "Tentativa", senha: "ERRADA" });
  assert.equal(bloqueada.status, 429);
  assert.match((await bloqueada.json()).message, /arbitragem/);
  throttler.onApplicationShutdown();
  assert.equal((await request("POST", `/arbitragem/jogos/${id}/entrada/senha`, "", { nomeCompleto: "Tentativa", senha: "ERRADA" }, false)).status, 403);
});

test("encerramento e cancelamento revogam tudo; reenvio do encerramento é reconhecido sem devolver permissão", async () => {
  const { id } = await jogo();
  const tecnico = await cadastrar("tecnico");
  await designar(id, tecnico.id);
  const senha = await consultarSenha(id);
  const designado = await entrarDesignado(id, tecnico);
  const porSenha = await entrarComSenha(id, senha);
  const saiu = await entrarComSenha(id, senha);
  await request("POST", `/arbitragem/jogos/${id}/saida`, saiu);

  // Encerramento (MAR-69 usará esta integração na transação que finaliza o jogo).
  await prisma.$transaction(async tx => {
    await tx.jogo.update({ where: { id }, data: { status: "em_andamento", iniciadoEm: new Date() } });
    await tx.jogo.update({ where: { id }, data: { status: "finalizado", encerradoEm: new Date(), resultado: "normal" } });
    assert.equal(await encerrarAcessoArbitragem(tx, [id], "jogo_encerrado"), 2);
  });
  for (const cookie of [designado, porSenha]) {
    assert.equal((await sessao(id, cookie)).status, 401);
    const token = tokenDe(cookie);
    assert.deepEqual(await prisma.$transaction(tx => revalidarArbitragemOuEncerramento(tx, id, token)), { situacao: "jogo_encerrado", jogoId: id });
    await assert.rejects(prisma.$transaction(tx => revalidarArbitragem(tx, id, token)), (e: unknown) => status(e) === 401);
  }
  // Sessão encerrada por outro motivo não é reconhecida como reenvio do encerramento.
  await assert.rejects(prisma.$transaction(tx => revalidarArbitragemOuEncerramento(tx, id, tokenDe(saiu))), (e: unknown) => status(e) === 401);
  await entrarComSenha(id, senha, 403);
  await entrarDesignado(id, tecnico, 403);
  assert.equal((await request("GET", `/jogos/${id}/arbitragem/senha`, presidente.cookie)).status, 409);
  assert.ok((await prisma.acessoArbitragem.findUniqueOrThrow({ where: { jogoId: id } })).revogadoEm);
  // Revogação é definitiva no banco.
  await assert.rejects(prisma.sessaoArbitragem.updateMany({ where: { arbitragem: { jogoId: id } }, data: { revogadaEm: null, motivoRevogacao: null } }));

  // Cancelar o campeonato cancela o jogo agendado e revoga seus acessos na mesma transação.
  const cancelado = await jogo();
  const senhaCancelado = await consultarSenha(cancelado.id);
  const acessoCancelado = await entrarComSenha(cancelado.id, senhaCancelado);
  assert.equal((await request("POST", `/campeonatos/${cancelado.campeonato.id}/cancelar`, presidente.cookie, {})).status, 200);
  assert.equal((await sessao(cancelado.id, acessoCancelado)).status, 401);
  assert.equal((await prisma.sessaoArbitragem.findFirstOrThrow({ where: { arbitragem: { jogoId: cancelado.id } } })).motivoRevogacao, "jogo_cancelado");
  assert.ok((await prisma.acessoArbitragem.findUniqueOrThrow({ where: { jogoId: cancelado.id } })).revogadoEm);
});

/** Mantém aberta uma transação que já revalidou a sessão, como faria uma escrita esportiva. */
function autorizacaoEmCurso(jogoId: string, cookie: string, gravar?: (tx: Prisma.TransactionClient) => Promise<void>) {
  let liberar!: () => void;
  const segurando = new Promise<void>(resolve => { liberar = resolve; });
  let autorizou!: () => void;
  const autorizada = new Promise<void>(resolve => { autorizou = resolve; });
  const transacao = prisma.$transaction(async tx => {
    await revalidarArbitragem(tx, jogoId, tokenDe(cookie));
    autorizou();
    await segurando;
    await gravar?.(tx);
    return "gravou";
  }, { timeout: 15_000 });
  return { autorizada, liberar, transacao };
}
async function aguardaAutorizacao(operacao: () => Promise<Response>, emCurso: ReturnType<typeof autorizacaoEmCurso>) {
  await emCurso.autorizada;
  let concluida = false;
  const pendente = operacao().then(response => { concluida = true; return response; });
  await esperar(400);
  assert.equal(concluida, false, "a revogação aguarda a transação já autorizada");
  emCurso.liberar();
  assert.equal(await emCurso.transacao, "gravou");
  return pendente;
}

test("revogação concorrente aguarda a autorização em curso e vale para a operação seguinte", async () => {
  const { id } = await jogo();
  const tecnico = await cadastrar("tecnico");
  const arbitragemId = await designar(id, tecnico.id);
  const porSenha = await entrarComSenha(id, await consultarSenha(id));

  const troca = await aguardaAutorizacao(() => request("POST", `/jogos/${id}/arbitragem/senha/troca`, presidente.cookie), autorizacaoEmCurso(id, porSenha));
  assert.equal(troca.status, 200);
  await assert.rejects(prisma.$transaction(tx => revalidarArbitragem(tx, id, tokenDe(porSenha))), (e: unknown) => status(e) === 401);

  const designado = await entrarDesignado(id, tecnico);
  const desativacao = await aguardaAutorizacao(() => request("POST", `/contas/${tecnico.id}/desativacao`, presidente.cookie, {}), autorizacaoEmCurso(id, designado));
  assert.equal(desativacao.status, 200);
  await assert.rejects(prisma.$transaction(tx => revalidarArbitragem(tx, id, tokenDe(designado))), (e: unknown) => status(e) === 401);

  assert.equal((await request("POST", `/contas/${tecnico.id}/reativacao`, presidente.cookie, {})).status, 200);
  const reativado = await entrarDesignado(id, { cookie: await login(tecnico.email) });
  // A retirada já está aguardando quando a operação autorizada atualiza Arbitragem.
  // Sem bloquear a arbitragem antes da sessão, a exclusão em cascata fecha um deadlock.
  const visualizacaoEmCurso = autorizacaoEmCurso(id, reativado, async tx => {
    const resultado = await alterarVisualizacao(tx, id, tokenDe(reativado), "banco");
    assert.equal(resultado.arbitragem.visualizacao, "banco");
  });
  const retirada = await aguardaAutorizacao(() => request("DELETE", `/jogos/${id}/arbitragens/${arbitragemId}`, presidente.cookie), visualizacaoEmCurso);
  assert.equal(retirada.status, 200);
  await assert.rejects(prisma.$transaction(tx => revalidarArbitragem(tx, id, tokenDe(reativado))), (e: unknown) => status(e) === 401);
  assert.equal((await request("PUT", `/arbitragem/jogos/${id}/visualizacao`, reativado, { visualizacao: "linha" })).status, 401);
});

test("emissões e trocas simultâneas não deixam senha divergente entre hash e cópia cifrada", async () => {
  const { id } = await jogo();
  const consultas = await Promise.all(Array.from({ length: 4 }, () => request("GET", `/jogos/${id}/arbitragem/senha`, presidente.cookie)));
  const senhas = await Promise.all(consultas.map(async r => { assert.equal(r.status, 200); return (await r.json()).senha as string; }));
  assert.equal(new Set(senhas).size, 1, "a primeira emissão vale para todas");
  const trocas = await Promise.all(Array.from({ length: 3 }, () => request("POST", `/jogos/${id}/arbitragem/senha/troca`, presidente.cookie)));
  for (const r of trocas) assert.equal(r.status, 200);
  const atual = await consultarSenha(id);
  await entrarComSenha(id, atual);
});
