import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import { createApp } from "../dist/app.js";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import {
  ArmazenamentoFotos, ArmazenamentoLocal, ArmazenamentoNaoConfigurado, ArmazenamentoSupabase, criarArmazenamentoFotos, ErroArmazenamento,
} from "../dist/modules/fotos/armazenamento.js";
import { detectarImagem, LIMITE_FOTO_BYTES } from "../dist/modules/fotos/fotos.js";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const diretorio = await mkdtemp(join(tmpdir(), "handebol-fotos-"));
for (const nome of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_FOTOS_BUCKET"]) delete process.env[nome];
process.env.FOTOS_DIRETORIO = diretorio;
const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
const prisma = app.get(PrismaService);
const armazenamento = app.get(ArmazenamentoFotos) as ArmazenamentoLocal;
const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
let base: string;
const password = "Senha-local-de-teste-2026";
const emails: string[] = [];
const clubes: string[] = [];
const campeonatos: string[] = [];
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const novoEmail = () => { const email = `${randomUUID()}@example.invalid`; emails.push(email); return email; };

// Fixtures 2×2 decodificáveis; o JPEG contém EXIF fictício para comprovar a preservação dos bytes originais.
const png = readFileSync(new URL("./fixtures/foto.png", import.meta.url));
const jpeg = readFileSync(new URL("./fixtures/foto.jpg", import.meta.url));
const webp = readFileSync(new URL("./fixtures/foto.webp", import.meta.url));
const inicioScan = jpeg.indexOf(Buffer.from([0xff, 0xda]));
const jpegSemPixels = Buffer.concat([jpeg.subarray(0, inicioScan + 2 + jpeg.readUInt16BE(inicioScan + 2)), Buffer.from([0xff, 0xd9])]);
/** PNG válido com chunk auxiliar de enchimento até `tamanho` bytes. */
function pngComTamanho(tamanho: number) {
  const dados = tamanho - png.length - 12;
  const chunk = Buffer.concat([Buffer.alloc(4), Buffer.from("npAD"), Buffer.alloc(dados), Buffer.alloc(4)]);
  chunk.writeUInt32BE(dados, 0);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
}

type Metodo = "GET" | "POST" | "PUT" | "DELETE";
const request = (method: Metodo, path: string, cookie = "", body?: unknown, comOrigem = true) => fetch(`${base}${path}`, {
  method,
  headers: { ...(comOrigem ? { Origin: origin } : {}), "X-Forwarded-For": ip(), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const enviarFoto = (atletaId: string, cookie: string, conteudo: Buffer, tipo: string | null = "image/png", comOrigem = true) => fetch(`${base}/atletas/${atletaId}/foto`, {
  method: "PUT",
  headers: { ...(comOrigem ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(tipo ? { "Content-Type": tipo } : {}) },
  body: new Uint8Array(conteudo),
});
const lerFoto = (atletaId: string, cookie: string) => request("GET", `/atletas/${atletaId}/foto`, cookie);
const lerFotoArbitragem = (jogoId: string, atletaId: string, cookie: string) => request("GET", `/arbitragem/jogos/${jogoId}/atletas/${atletaId}/foto`, cookie);
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
    await tx.authUser.create({ data: { id: authId, name: "Presidente das fotos", email } });
    await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: await hashPassword(password) } });
    await tx.usuario.create({ data: { id, authId, nomeCompleto: "Presidente das fotos", perfil: "presidente", presidente: { create: {} } } });
  });
  return { id, email, cookie: await login(email) };
}
let presidente: Awaited<ReturnType<typeof criarPresidente>>;
type Conta = { id: string; email: string; cookie: string };

async function cadastrar(perfil: "atleta" | "tecnico", { clubeId, decisao = "aprovacao", nome = "Pessoa Fictícia" }: { clubeId?: string; decisao?: "aprovacao" | null; nome?: string } = {}): Promise<Conta> {
  const email = novoEmail();
  throttler.onApplicationShutdown(); // zera os limites por IP (ver auth.integration.ts)
  const response = await request("POST", "/cadastros", "", { nomeCompleto: nome, email, password, perfil, ...(clubeId ? { clubeId } : {}) });
  assert.equal(response.status, 201, await response.clone().text());
  const id = (await response.json()).usuario.id as string;
  if (decisao) assert.equal((await request("POST", `/verificacoes/${id}/${decisao}`, presidente.cookie, {})).status, 200);
  return { id, email, cookie: await login(email) };
}
async function criarClube(nome: string) {
  const clube = await prisma.clube.create({ data: { nome, criadoPorPresidenteId: presidente.id } });
  clubes.push(clube.id);
  return clube.id;
}
async function comTecnico(clubeId: string, nome: string) {
  const tecnico = await cadastrar("tecnico", { nome });
  assert.equal((await request("PUT", `/clubes/${clubeId}/tecnico`, presidente.cookie, { tecnicoId: tecnico.id })).status, 200);
  return tecnico;
}
async function campeonatoCom(clubesInscritos: string[]) {
  const response = await request("POST", "/campeonatos", presidente.cookie, { nome: "Campeonato das fotos", edicao: "2026", categoria: "Adulto" });
  assert.equal(response.status, 201);
  const { id } = await response.json() as { id: string };
  campeonatos.push(id);
  for (const clubeId of clubesInscritos) assert.equal((await request("POST", `/campeonatos/${id}/inscricoes`, presidente.cookie, { clubeId })).status, 201);
  return id;
}
const dataLocal = (fuso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function agendar(campeonatoId: string, clubeAId: string, clubeBId: string) {
  const response = await request("POST", `/campeonatos/${campeonatoId}/jogos`, presidente.cookie, { clubeAId, clubeBId, inicioPrevisto: `${dataLocal("America/Recife")}T12:00`, fusoHorario: "America/Recife" });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id as string;
}
async function arbitrar(jogoId: string) {
  const senha = (await (await request("GET", `/jogos/${jogoId}/arbitragem/senha`, presidente.cookie)).json()).senha as string;
  throttler.onApplicationShutdown();
  const response = await request("POST", `/arbitragem/jogos/${jogoId}/entrada/senha`, "", { nomeCompleto: "Árbitra Externa", senha });
  assert.equal(response.status, 201, await response.clone().text());
  return response.headers.getSetCookie().find(c => c.startsWith(`handebol.arbitragem.${jogoId}=`))!.split(";")[0];
}

async function status(response: Promise<Response>, esperado: number, mensagem?: RegExp) {
  const resolvida = await response;
  const texto = await resolvida.text();
  assert.equal(resolvida.status, esperado, texto);
  if (mensagem) assert.match(JSON.parse(texto).message, mensagem);
  return texto;
}
async function foto(response: Promise<Response>) {
  const resolvida = await response;
  assert.equal(resolvida.status, 200, await resolvida.clone().text());
  return { tipo: resolvida.headers.get("content-type"), conteudo: Buffer.from(await resolvida.arrayBuffer()), headers: resolvida.headers };
}
const arquivos = async (atletaId: string) => (await readdir(join(diretorio, "atletas", atletaId)).catch(() => [] as string[])).sort();
const chaveAtual = async (atletaId: string) => (await prisma.atleta.findUniqueOrThrow({ where: { usuarioId: atletaId } })).fotoChave;
const nomeDaChave = (chave: string | null) => chave?.split("/").at(-1);

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
  await rm(diretorio, { recursive: true, force: true });
});

test("atleta envia e substitui a própria foto sem nova aprovação; arquivo anterior removido; resposta sem chave ou URL", async () => {
  const clube = await criarClube("Clube da foto própria");
  const ana = await cadastrar("atleta", { clubeId: clube, nome: "Ana" });
  const carteirinhaAntes = await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: ana.id } });
  await status(lerFoto(ana.id, ana.cookie), 404, /sem foto/);

  const primeira = await status(enviarFoto(ana.id.toUpperCase(), ana.cookie, png), 200);
  assert.deepEqual(JSON.parse(primeira), { atletaId: ana.id, foto: { tipo: "image/png", tamanho: png.length }, substituida: false });
  const chave1 = await chaveAtual(ana.id);
  assert.match(chave1!, new RegExp(`^atletas/${ana.id}/[0-9a-f-]{36}\\.png$`));
  assert.doesNotMatch(primeira, /atletas\/|https?:|storage/i);
  assert.deepEqual(await arquivos(ana.id), [nomeDaChave(chave1)]);

  const lida = await foto(lerFoto(ana.id, ana.cookie));
  assert.deepEqual([lida.tipo, lida.conteudo, lida.headers.get("cache-control"), lida.headers.get("x-content-type-options")], ["image/png", png, "no-store", "nosniff"]);

  const segunda = JSON.parse(await status(enviarFoto(ana.id, ana.cookie, jpeg, "image/jpeg"), 200));
  assert.equal(segunda.substituida, true);
  const chave2 = await chaveAtual(ana.id);
  assert.notEqual(chave2, chave1);
  assert.deepEqual(await arquivos(ana.id), [nomeDaChave(chave2)]);
  assert.deepEqual((await foto(lerFoto(ana.id, ana.cookie))).conteudo, jpeg);
  assert.ok(jpeg.includes(Buffer.from("Exif\0\0")), "fixture JPEG contém EXIF preservado na leitura");
  await status(enviarFoto(ana.id, ana.cookie, webp, "image/webp"), 200);
  assert.equal((await foto(lerFoto(ana.id, ana.cookie))).tipo, "image/webp");

  // A troca não toca aprovação nem carteirinha.
  const atleta = await prisma.atleta.findUniqueOrThrow({ where: { usuarioId: ana.id } });
  assert.equal(atleta.statusVerificacao, "aprovado");
  assert.deepEqual(await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: ana.id } }), carteirinhaAntes);
});

test("presidente envia foto de atleta pendente; técnico e outros atletas não enviam; atleta inexistente e origem ausente recusados", async () => {
  const clube = await criarClube("Clube do envio");
  const pendente = await cadastrar("atleta", { clubeId: clube, nome: "Pendente", decisao: null });
  const outra = await cadastrar("atleta", { clubeId: clube, nome: "Outra" });
  const tecnico = await comTecnico(clube, "Técnico do envio");

  // Foto não é exigida para aprovação, e o próprio atleta pendente também pode enviá-la.
  await status(enviarFoto(pendente.id, pendente.cookie, png), 200);
  await status(enviarFoto(pendente.id, presidente.cookie, jpeg, "image/jpeg"), 200);
  assert.equal((await prisma.atleta.findUniqueOrThrow({ where: { usuarioId: pendente.id } })).statusVerificacao, "pendente");
  assert.equal((await foto(lerFoto(pendente.id, presidente.cookie))).tipo, "image/jpeg");

  await status(enviarFoto(pendente.id, outra.cookie, png), 403, /próprio atleta ou um presidente/);
  await status(enviarFoto(pendente.id, tecnico.cookie, png), 403);
  await status(enviarFoto(randomUUID(), presidente.cookie, png), 404, /Atleta não encontrado/);
  await status(enviarFoto(tecnico.id, presidente.cookie, png), 404, /Atleta não encontrado/);
  await status(enviarFoto(pendente.id, "", png), 401);
  await status(enviarFoto(pendente.id, pendente.cookie, png, "image/png", false), 403, /Origem não autorizada/);
  await status(enviarFoto("nao-e-uuid", presidente.cookie, png), 400);
  assert.equal((await arquivos(pendente.id)).length, 1);
  assert.equal(await prisma.atleta.count({ where: { usuarioId: { in: [tecnico.id] } } }), 0);
});

test("conteúdo real, tipo declarado e limite de 5 MB são conferidos; recusas preservam a foto atual", async () => {
  const clube = await criarClube("Clube da validação");
  const bia = await cadastrar("atleta", { clubeId: clube, nome: "Bia" });
  await status(enviarFoto(bia.id, bia.cookie, png), 200);
  const chave = await chaveAtual(bia.id);

  await status(enviarFoto(bia.id, bia.cookie, png, null), 415, /Content-Type/);
  await status(enviarFoto(bia.id, bia.cookie, png, "image/gif"), 415);
  await status(enviarFoto(bia.id, bia.cookie, Buffer.from("{\"foto\":true}"), "application/json"), 415);
  await status(enviarFoto(bia.id, bia.cookie, Buffer.from("não sou uma imagem, apenas texto"), "image/png"), 415, /não é uma imagem/);
  await status(enviarFoto(bia.id, bia.cookie, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/webp"), 415);
  await status(enviarFoto(bia.id, bia.cookie, png.subarray(0, 30), "image/png"), 415); // PNG truncado
  const jpegFalso = Buffer.from([0xff, 0xd8, 0xff, 0, 0xff, 0xd9]);
  const pngFalso = Buffer.alloc(45);
  png.copy(pngFalso, 0, 0, 16);
  pngFalso.write("IEND", 37);
  const webpFalso = Buffer.alloc(20);
  webpFalso.write("RIFF");
  webpFalso.writeUInt32LE(12, 4);
  webpFalso.write("WEBPVP8 ", 8);
  const pngCorrompido = Buffer.from(png);
  const idat = pngCorrompido.indexOf(Buffer.from("IDAT"));
  const tamanhoIdat = pngCorrompido.readUInt32BE(idat - 4);
  pngCorrompido[idat + 4] ^= 0xff; // mantém cabeçalho e CRC válidos, mas danifica os pixels comprimidos
  pngCorrompido.writeUInt32BE(crc32(pngCorrompido.subarray(idat, idat + 4 + tamanhoIdat)), idat + 4 + tamanhoIdat);
  for (const [conteudo, tipo] of [[jpegFalso, "image/jpeg"], [pngFalso, "image/png"], [webpFalso, "image/webp"], [jpegSemPixels, "image/jpeg"], [pngCorrompido, "image/png"]] as const) {
    await status(enviarFoto(bia.id, bia.cookie, conteudo, tipo), 415, /não é uma imagem/);
    assert.equal(await chaveAtual(bia.id), chave, "imagem inválida não substitui a foto boa");
    assert.deepEqual(await arquivos(bia.id), [nomeDaChave(chave)]);
    assert.deepEqual((await foto(lerFoto(bia.id, bia.cookie))).conteudo, png);
  }
  await status(enviarFoto(bia.id, bia.cookie, png, "image/jpeg"), 415, /diferente do Content-Type/);
  await status(enviarFoto(bia.id, bia.cookie, Buffer.alloc(0)), 400, /Envie o arquivo/);
  await status(enviarFoto(bia.id, bia.cookie, pngComTamanho(LIMITE_FOTO_BYTES + 1)), 413, /5 MB/);
  assert.equal(await chaveAtual(bia.id), chave);
  assert.deepEqual(await arquivos(bia.id), [nomeDaChave(chave)]);

  const noLimite = pngComTamanho(LIMITE_FOTO_BYTES);
  assert.equal(JSON.parse(await status(enviarFoto(bia.id, bia.cookie, noLimite), 200)).foto.tamanho, 5 * 1024 * 1024);
  assert.equal((await foto(lerFoto(bia.id, presidente.cookie))).conteudo.length, LIMITE_FOTO_BYTES);
});

test("imagens repetidas e concorrentes não compartilham avisos nem aceitam pixels corrompidos do cache", async () => {
  const candidatos = [jpegSemPixels, jpeg, png, jpegSemPixels, webp];
  for (let rodada = 0; rodada < 30; rodada++) {
    const conteudos = rodada % 2 ? candidatos.map(conteudo => Buffer.from(conteudo)) : candidatos;
    assert.deepEqual(await Promise.all(conteudos.map(detectarImagem)), [null, "image/jpeg", "image/png", null, "image/webp"]);
  }
});

test("leitura por conta: próprio atleta, presidente e técnico atual; negada a colegas, outros técnicos e ao técnico anterior após transferência", async () => {
  const [a, b] = [await criarClube("Clube A das fotos"), await criarClube("Clube B das fotos")];
  const [tecnicoA, tecnicoB] = [await comTecnico(a, "Técnico A"), await comTecnico(b, "Técnico B")];
  const tecnicoPendente = await cadastrar("tecnico", { nome: "Técnico pendente", decisao: null });
  const caio = await cadastrar("atleta", { clubeId: a, nome: "Caio" });
  const colega = await cadastrar("atleta", { clubeId: a, nome: "Colega" });
  await status(enviarFoto(caio.id, caio.cookie, png), 200);

  for (const cookie of [caio.cookie, presidente.cookie, tecnicoA.cookie]) assert.deepEqual((await foto(lerFoto(caio.id, cookie))).conteudo, png);
  for (const cookie of [colega.cookie, tecnicoB.cookie, tecnicoPendente.cookie]) await status(lerFoto(caio.id, cookie), 403, /Sem permissão/);
  await status(lerFoto(caio.id, ""), 401);
  await status(lerFoto(randomUUID(), tecnicoA.cookie), 403); // sem revelar existência
  await status(lerFoto(randomUUID(), presidente.cookie), 404, /Atleta não encontrado/);
  await status(lerFoto(colega.id, colega.cookie), 404, /sem foto/);

  // Transferência: o técnico do novo clube passa a ver a foto, o anterior deixa de ver.
  const transferencia = await request("POST", `/atletas/${caio.id}/transferencia`, presidente.cookie, { clubeAtualId: a, clubeDestinoId: b });
  assert.equal(transferencia.status, 200, await transferencia.clone().text());
  await status(lerFoto(caio.id, tecnicoA.cookie), 403);
  assert.deepEqual((await foto(lerFoto(caio.id, tecnicoB.cookie))).conteudo, png);
});

test("arbitragem do jogo vê foto de escalado ou credenciado; não vê sem sessão do jogo, de outro jogo ou de atleta fora do jogo; QR não expõe foto", async () => {
  const [a, b, c] = [await criarClube("Clube A da arbitragem"), await criarClube("Clube B da arbitragem"), await criarClube("Clube C da arbitragem")];
  const tecnicoA = await comTecnico(a, "Técnico A da arbitragem");
  const campeonato = await campeonatoCom([a, b, c]);
  const [jogo, outroJogo] = [await agendar(campeonato, a, b), await agendar(campeonato, a, c)];
  const [escalada, credenciada, ausente, deFora] = [
    await cadastrar("atleta", { clubeId: a, nome: "Escalada" }), await cadastrar("atleta", { clubeId: b, nome: "Credenciada" }),
    await cadastrar("atleta", { clubeId: a, nome: "Ausente" }), await cadastrar("atleta", { clubeId: c, nome: "De fora" }),
  ];
  for (const atleta of [escalada, credenciada, ausente, deFora]) await status(enviarFoto(atleta.id, atleta.cookie, png), 200);
  assert.equal((await request("POST", `/jogos/${jogo}/escalacao`, tecnicoA.cookie, { atletaId: escalada.id })).status, 200);
  const [arbitro, arbitroOutro] = [await arbitrar(jogo), await arbitrar(outroJogo)];
  const credenciamento = await request("POST", `/arbitragem/jogos/${jogo}/credenciamentos`, arbitro, { atletaId: credenciada.id, numeroCamisa: 7 });
  assert.equal(credenciamento.status, 200, await credenciamento.clone().text());

  for (const atleta of [escalada, credenciada]) assert.deepEqual((await foto(lerFotoArbitragem(jogo, atleta.id, arbitro))).conteudo, png);
  await status(lerFotoArbitragem(jogo, ausente.id, arbitro), 403, /não escalado nem credenciado/);
  await status(lerFotoArbitragem(jogo, deFora.id, arbitro), 403);
  await status(lerFotoArbitragem(jogo, escalada.id, ""), 401);
  await status(lerFotoArbitragem(jogo, escalada.id, arbitroOutro), 401); // cookie de outro jogo
  await status(lerFotoArbitragem(outroJogo, credenciada.id, arbitroOutro), 403);
  // A sessão de arbitragem não é conta: a rota de conta não a aceita.
  await status(lerFoto(escalada.id, arbitro), 401);

  // Leitura do QR identifica a carteirinha sem foto nem acesso a ela.
  const tokenQr = (await prisma.carteirinha.findUniqueOrThrow({ where: { atletaId: ausente.id } })).tokenQr;
  assert.doesNotMatch(await status(request("POST", `/arbitragem/jogos/${jogo}/leitura-qr`, arbitro, { tokenQr }), 200), /foto/i);
  assert.doesNotMatch(await status(request("POST", "/carteirinhas/leitura", presidente.cookie, { tokenQr }), 200), /foto/i);

  // Saída da arbitragem revoga também a leitura das fotos.
  assert.equal((await request("POST", `/arbitragem/jogos/${jogo}/saida`, arbitro, {})).status, 200);
  await status(lerFotoArbitragem(jogo, escalada.id, arbitro), 401);
});

test("falhas: Storage indisponível preserva a foto; falha na persistência remove o arquivo novo; falha ao remover o anterior deixa órfão sem referência inválida", async () => {
  const clube = await criarClube("Clube das falhas");
  const duda = await cadastrar("atleta", { clubeId: clube, nome: "Duda" });
  await status(enviarFoto(duda.id, duda.cookie, png), 200);
  const original = await chaveAtual(duda.id);
  const { enviar, ler, remover } = armazenamento;
  try {
    armazenamento.enviar = async () => { throw new ErroArmazenamento("simulada"); };
    await status(enviarFoto(duda.id, duda.cookie, jpeg, "image/jpeg"), 503, /Armazenamento de fotos indisponível/);
    assert.equal(await chaveAtual(duda.id), original);
    assert.deepEqual(await arquivos(duda.id), [nomeDaChave(original)]);

    // O presidente é desativado enquanto o arquivo sobe: a transação revalida, recusa e o arquivo novo é removido.
    const outroPresidente = await criarPresidente();
    armazenamento.enviar = async (...args) => {
      await enviar.apply(armazenamento, args);
      await prisma.usuario.update({ where: { id: outroPresidente.id }, data: { ativo: false } });
    };
    await status(enviarFoto(duda.id, outroPresidente.cookie, jpeg, "image/jpeg"), 401);
    assert.equal(await chaveAtual(duda.id), original);
    assert.deepEqual(await arquivos(duda.id), [nomeDaChave(original)]);
    armazenamento.enviar = enviar;

    armazenamento.ler = async () => { throw new ErroArmazenamento("simulada"); };
    await status(lerFoto(duda.id, duda.cookie), 503);
    armazenamento.ler = ler;

    armazenamento.remover = async () => { throw new ErroArmazenamento("simulada"); };
    assert.equal(JSON.parse(await status(enviarFoto(duda.id, duda.cookie, jpeg, "image/jpeg"), 200)).substituida, true);
    const nova = await chaveAtual(duda.id);
    assert.deepEqual(await arquivos(duda.id), [nomeDaChave(original), nomeDaChave(nova)].sort()); // órfão: o original
    assert.deepEqual((await foto(lerFoto(duda.id, duda.cookie))).conteudo, jpeg);
  } finally {
    Object.assign(armazenamento, { enviar, ler, remover });
  }
  // A limpeza documentada remove objetos sem referência no banco.
  const referenciada = nomeDaChave(await chaveAtual(duda.id));
  for (const arquivo of await arquivos(duda.id)) if (arquivo !== referenciada) await armazenamento.remover(`atletas/${duda.id}/${arquivo}`);
  assert.deepEqual(await arquivos(duda.id), [referenciada]);
});

test("envios simultâneos se sucedem: o banco referencia o último e somente ele permanece no armazenamento", async () => {
  const clube = await criarClube("Clube da concorrência");
  const eva = await cadastrar("atleta", { clubeId: clube, nome: "Eva" });
  const respostas = await Promise.all([png, jpeg, webp, png].map((conteudo, i) => enviarFoto(eva.id, i % 2 ? presidente.cookie : eva.cookie, conteudo, ["image/png", "image/jpeg", "image/webp", "image/png"][i])));
  assert.deepEqual(respostas.map(r => r.status), [200, 200, 200, 200]);
  const substituicoes = (await Promise.all(respostas.map(r => r.json()))).filter(r => r.substituida).length;
  assert.equal(substituicoes, 3);
  assert.deepEqual(await arquivos(eva.id), [nomeDaChave(await chaveAtual(eva.id))]);
  assert.equal((await foto(lerFoto(eva.id, eva.cookie))).headers.get("content-type")?.startsWith("image/"), true);
});

test("adaptador Supabase usa o endpoint autenticado do bucket privado, sem upsert nem URL pública", async () => {
  const pedidos: { metodo: string; url: string; headers: IncomingMessage["headers"]; corpo: Buffer }[] = [];
  let respostaLeitura: [number, string | Buffer] = [200, png];
  const servidor = createServer(async (req, res) => {
    const partes: Buffer[] = [];
    for await (const parte of req) partes.push(parte as Buffer);
    pedidos.push({ metodo: req.method!, url: req.url!, headers: req.headers, corpo: Buffer.concat(partes) });
    if (req.method === "GET") { res.writeHead(respostaLeitura[0]); res.end(respostaLeitura[1]); return; }
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as { port: number };
  try {
    const supabase = new ArmazenamentoSupabase(`http://127.0.0.1:${port}/`, "sb_secret_ficticia", "fotos-teste", 2000);
    const chave = `atletas/${randomUUID()}/${randomUUID()}.png`;
    await supabase.enviar(chave, png, "image/png");
    assert.deepEqual(await supabase.ler(chave), { conteudo: png, tipo: "image/png" });
    await supabase.remover(chave);
    assert.deepEqual(pedidos.map(p => [p.metodo, p.url]), [
      ["POST", `/storage/v1/object/fotos-teste/${chave}`], ["GET", `/storage/v1/object/authenticated/fotos-teste/${chave}`], ["DELETE", `/storage/v1/object/fotos-teste/${chave}`],
    ]);
    assert.deepEqual([pedidos[0].headers["x-upsert"], pedidos[0].headers["content-type"], pedidos[0].corpo], ["false", "image/png", png]);
    for (const pedido of pedidos) {
      assert.deepEqual([pedido.headers.apikey, pedido.headers.authorization], ["sb_secret_ficticia", "Bearer sb_secret_ficticia"]);
      assert.doesNotMatch(pedido.url, /public|sign|sb_secret/);
    }

    respostaLeitura = [400, JSON.stringify({ statusCode: "404", error: "not_found" })];
    assert.equal(await supabase.ler(chave), null);
    respostaLeitura = [500, "erro"];
    await assert.rejects(supabase.ler(chave), ErroArmazenamento);
    await assert.rejects(supabase.enviar("../fora-do-bucket.png", png, "image/png"), ErroArmazenamento);
    await assert.rejects(new ArmazenamentoSupabase("http://127.0.0.1:1", "x", "b", 500).ler(chave), ErroArmazenamento);
  } finally {
    await new Promise(resolve => servidor.close(resolve));
  }

  assert.ok(criarArmazenamentoFotos({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "k", SUPABASE_FOTOS_BUCKET: "b", FOTOS_DIRETORIO: diretorio }) instanceof ArmazenamentoSupabase);
  assert.ok(criarArmazenamentoFotos({ FOTOS_DIRETORIO: diretorio }) instanceof ArmazenamentoLocal);
  assert.ok(criarArmazenamentoFotos({ FOTOS_DIRETORIO: diretorio, NODE_ENV: "production" }) instanceof ArmazenamentoNaoConfigurado);
  assert.ok(criarArmazenamentoFotos({}) instanceof ArmazenamentoNaoConfigurado);
  assert.throws(() => criarArmazenamentoFotos({ SUPABASE_URL: "https://x.supabase.co" }), /juntas/);
  await assert.rejects(new ArmazenamentoNaoConfigurado().ler(), ErroArmazenamento);
});

test("contrato OpenAPI documenta envio, leitura por conta e leitura pela arbitragem", async () => {
  const contrato = await (await request("GET", "/openapi.json")).json();
  const envio = contrato.paths["/atletas/{atletaId}/foto"];
  assert.deepEqual(Object.keys(envio.put.requestBody.content), ["image/jpeg", "image/png", "image/webp"]);
  assert.deepEqual(Object.keys(envio.put.responses), ["200", "400", "401", "403", "404", "413", "415", "503"]);
  assert.ok(envio.get.responses["200"].content["image/png"]);
  assert.deepEqual(contrato.paths["/arbitragem/jogos/{jogoId}/atletas/{atletaId}/foto"].get.security, [{ arbitragemCookie: [] }]);
});
