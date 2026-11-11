/**
 * Dados locais para desenvolver a área do presidente; os outros atores são simulados pela API.
 * Em server/, após build e com a API local iniciada:
 *   node --env-file-if-exists=.env scripts/seed-frontend.ts
 * FRONTEND_SENHA é opcional na primeira execução. Sem ela, uma senha aleatória é guardada somente
 * em output/playwright/acesso-local.json (ignorado pelo Git), junto dos IDs para reutilização.
 * Nunca apaga dados, restaura decisões da interface ou muda a senha de uma conta existente.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";
import { criarIdentidade } from "../dist/modules/autenticacao/identidade.js";

const local = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
assert.notEqual(process.env.NODE_ENV, "production", "Dados de frontend não podem ser preparados em produção");
const banco = new URL(process.env.DATABASE_URL ?? "");
assert.ok(local(banco.hostname), "DATABASE_URL deve apontar para um PostgreSQL local");
const api = new URL(process.env.FRONTEND_API_URL ?? "http://localhost:3001/api");
assert.ok(local(api.hostname) && api.protocol === "http:", "FRONTEND_API_URL deve ser uma API HTTP local");
const origin = new URL(process.env.CLIENT_ORIGIN ?? "http://localhost:3000").origin;
assert.ok(local(new URL(origin).hostname), "CLIENT_ORIGIN deve ser local");
const diretorio = new URL("../../output/playwright/", import.meta.url);
const arquivo = new URL("acesso-local.json", diretorio);
const email = "frontend-presidente@example.invalid";

type Registro = { id: string; novo?: boolean };
type Acesso = {
  versao: 1; email: string; password: string; presidenteId?: string; concluido: boolean;
  usuarios: Record<string, Registro>; clubes: Record<string, Registro>;
  campeonatos: Record<string, Registro>; jogos: Record<string, Registro>;
};
await mkdir(diretorio, { recursive: true });
let acesso: Acesso;
try {
  acesso = JSON.parse(await readFile(arquivo, "utf8")) as Acesso;
  assert.equal(acesso.versao, 1, "Manifesto local incompatível");
  assert.equal(acesso.email, email, "Arquivo de acesso não pertence a este seed");
  assert.ok(!process.env.FRONTEND_SENHA || process.env.FRONTEND_SENHA === acesso.password,
    "FRONTEND_SENHA diverge do arquivo local; o seed não troca senhas existentes");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const password = process.env.FRONTEND_SENHA ?? randomBytes(24).toString("base64url");
  assert.ok(password.length >= 8 && password.length <= 128, "FRONTEND_SENHA deve ter de 8 a 128 caracteres");
  acesso = { versao: 1, email, password, concluido: false, usuarios: {}, clubes: {}, campeonatos: {}, jogos: {} };
  await writeFile(arquivo, JSON.stringify(acesso, null, 2), { flag: "wx", mode: 0o600 });
}
const salvar = () => writeFile(arquivo, JSON.stringify(acesso, null, 2), { mode: 0o600 });
const prisma = new PrismaService();
let presidenteCookie = "";

async function request(method: "GET" | "POST" | "PUT", path: string, cookie = presidenteCookie, body?: unknown) {
  return fetch(`${api}${path}`, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function pedir<T = unknown>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, cookie = presidenteCookie, status = 200): Promise<T> {
  const response = await request(method, path, cookie, body);
  assert.equal(response.status, status, `${method} ${path}: ${(await response.clone().text()).slice(0, 400)}`);
  return response.json() as Promise<T>;
}
async function login(loginEmail: string) {
  const response = await request("POST", "/auth/sign-in/email", "", { email: loginEmail, password: acesso.password });
  assert.equal(response.status, 200, "Login local falhou; o seed não altera credenciais preexistentes");
  return response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}
async function criarUsuario(chave: string, nomeCompleto: string, perfil: "presidente" | "atleta" | "tecnico", clubeId?: string) {
  if (acesso.usuarios[chave]) return acesso.usuarios[chave].id;
  const usuarioEmail = chave === "presidente" ? email : `frontend-${chave}@example.invalid`;
  const existente = await prisma.authUser.findUnique({ where: { email: usuarioEmail }, select: { id: true } });
  if (existente) throw new Error(`Identidade reservada já existe sem registro neste manifesto: ${usuarioEmail}. Nenhuma senha foi alterada.`);
  const passwordHash = await hashPassword(acesso.password);
  const usuario = await prisma.$transaction(async tx => {
    const authId = await criarIdentidade(tx, { nomeCompleto, email: usuarioEmail, passwordHash });
    return tx.usuario.create({ data: { authId, nomeCompleto, perfil,
      ...(perfil === "presidente" ? { presidente: { create: {} } }
        : perfil === "atleta" ? { atleta: { create: { verificacaoSolicitadaEm: new Date(), vinculos: { create: { clubeId: clubeId! } } } } }
          : { tecnico: { create: { verificacaoSolicitadaEm: new Date() } } }),
    }, select: { id: true } });
  });
  acesso.usuarios[chave] = { id: usuario.id, novo: true };
  await salvar();
  return usuario.id;
}
async function clube(chave: string, nome: string, cidade: string) {
  if (acesso.clubes[chave]) return acesso.clubes[chave].id;
  const existente = await prisma.clube.findFirst({ where: { nome, criadoPorPresidenteId: acesso.presidenteId }, select: { id: true } });
  const registro = existente ?? await pedir<{ id: string }>("POST", "/clubes", { nome, cidade }, presidenteCookie, 201);
  acesso.clubes[chave] = { id: registro.id };
  await salvar();
  return registro.id;
}
async function campeonato(chave: string, nome: string, clubes: string[]) {
  if (acesso.campeonatos[chave]) return acesso.campeonatos[chave].id;
  const existente = await prisma.campeonato.findFirst({ where: { nome, criadoPorPresidenteId: acesso.presidenteId }, select: { id: true } });
  const registro = existente ?? await pedir<{ id: string }>("POST", "/campeonatos", { nome, edicao: "2026", categoria: "Adulto" }, presidenteCookie, 201);
  acesso.campeonatos[chave] = { id: registro.id };
  await salvar();
  for (const clubeId of clubes) {
    if (!await prisma.inscricaoClube.findUnique({ where: { campeonatoId_clubeId: { campeonatoId: registro.id, clubeId } } })) {
      await pedir("POST", `/campeonatos/${registro.id}/inscricoes`, { clubeId }, presidenteCookie, 201);
    }
  }
  return registro.id;
}
async function jogo(chave: string, campeonatoId: string, clubeAId: string, clubeBId: string, hora: string) {
  if (acesso.jogos[chave]) return acesso.jogos[chave].id;
  const localJogo = chave === "finalizado" ? "Ginásio Central" : chave === "agendado" ? "Arena Municipal" : "Centro Esportivo";
  const existente = await prisma.jogo.findFirst({ where: { campeonatoId, local: localJogo, criadoPorPresidenteId: acesso.presidenteId }, select: { id: true } });
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const registro = existente ?? await pedir<{ id: string }>("POST", `/campeonatos/${campeonatoId}/jogos`, {
    clubeAId, clubeBId, inicioPrevisto: `${hoje}T${hora}`, fusoHorario: "America/Sao_Paulo", local: localJogo,
  }, presidenteCookie, 201);
  acesso.jogos[chave] = { id: registro.id };
  await salvar();
  return registro.id;
}
async function decidirNovo(chave: string, decisao: "aprovacao" | "rejeicao") {
  const usuario = acesso.usuarios[chave];
  if (!usuario.novo) return;
  const verificacao = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id }, select: { atleta: { select: { statusVerificacao: true } }, tecnico: { select: { statusVerificacao: true } } } });
  if ((verificacao.atleta ?? verificacao.tecnico)?.statusVerificacao === "pendente") {
    await pedir("POST", `/verificacoes/${usuario.id}/${decisao}`, {});
  }
  delete usuario.novo;
  await salvar();
}
async function resumo() {
  const usuarioIds = Object.values(acesso.usuarios).map(u => u.id);
  const clubeIds = Object.values(acesso.clubes).map(c => c.id);
  const campeonatoIds = Object.values(acesso.campeonatos).map(c => c.id);
  const jogoIds = Object.values(acesso.jogos).map(j => j.id);
  const contagens = {
    usuarios: await prisma.usuario.count({ where: { id: { in: usuarioIds } } }),
    clubes: await prisma.clube.count({ where: { id: { in: clubeIds } } }),
    campeonatos: await prisma.campeonato.count({ where: { id: { in: campeonatoIds } } }),
    jogos: await prisma.jogo.count({ where: { id: { in: jogoIds } } }),
    lancamentos: await prisma.lancamentoJogo.count({ where: { jogoId: { in: jogoIds } } }),
    suspensoes: await prisma.suspensao.count({ where: { campeonatoId: { in: campeonatoIds } } }),
  };
  assert.equal(contagens.usuarios, usuarioIds.length, "Um usuário do manifesto foi removido; dados não serão recriados automaticamente");
  console.log(JSON.stringify({ concluido: acesso.concluido, acessoLocal: fileURLToPath(arquivo), presidenteId: acesso.presidenteId, contagens, jogos: acesso.jogos }, null, 2));
}

try {
  await prisma.$connect();
  if (acesso.concluido) {
    await resumo();
  } else {
    await pedir("GET", "/health/ready", undefined, "");
    acesso.presidenteId = await criarUsuario("presidente", "Helena Martins", "presidente");
    await salvar();
    presidenteCookie = await login(email);
    const serra = await clube("serra", "Clube Atlético Serra Azul", "Serra Azul");
    const vale = await clube("vale", "Grêmio Esportivo Vale do Ipê", "Vale do Ipê");
    const porto = await clube("porto", "Associação Recreativa Porto Novo", "Porto Novo");
    const ana = await criarUsuario("ana", "Ana Luiza Monteiro", "atleta", serra);
    const bruno = await criarUsuario("bruno", "Bruno Antunes Prado", "atleta", serra);
    const carla = await criarUsuario("carla", "Carla Rocha Lima", "atleta", vale);
    const diego = await criarUsuario("diego", "Diego Nascimento Reis", "atleta", vale);
    await criarUsuario("elisa", "Elisa Ferraz Souto", "atleta", porto);
    await criarUsuario("felipe", "Felipe Sampaio Torres", "atleta", porto);
    await criarUsuario("gabriela", "Gabriela Teixeira Bastos", "atleta", porto);
    const marcos = await criarUsuario("marcos", "Marcos Carvalho Mendes", "tecnico");
    const paula = await criarUsuario("paula", "Paula Costa Arruda", "tecnico");
    await criarUsuario("tiago", "Tiago Pereira Alves", "tecnico");
    for (const chave of ["ana", "bruno", "carla", "diego", "gabriela", "marcos", "paula"]) await decidirNovo(chave, "aprovacao");
    await decidirNovo("felipe", "rejeicao");
    for (const [clubeId, tecnicoId] of [[serra, marcos], [vale, paula]]) {
      const atual = await prisma.tecnico.findUniqueOrThrow({ where: { usuarioId: tecnicoId }, select: { clubeId: true } });
      const vaga = await prisma.tecnico.findUnique({ where: { clubeId }, select: { usuarioId: true } });
      if (!atual.clubeId && !vaga) await pedir("PUT", `/clubes/${clubeId}/tecnico`, { tecnicoId });
    }
    const planejado = await campeonato("planejado", "Taça de Verão", [serra, vale, porto]);
    const andamento = await campeonato("andamento", "Copa Regional de Handebol", [serra, vale]);
    if ((await prisma.campeonato.findUniqueOrThrow({ where: { id: andamento }, select: { status: true } })).status === "planejado") {
      await pedir("POST", `/campeonatos/${andamento}/iniciar`, {});
    }
    const finalizado = await jogo("finalizado", andamento, serra, vale, "10:00");
    const agendado = await jogo("agendado", andamento, serra, vale, "19:00");
    await jogo("planejado", planejado, vale, porto, "20:00");
    const estado = await prisma.jogo.findUniqueOrThrow({ where: { id: finalizado }, select: { status: true, inscricaoClubeAId: true } });
    if (estado.status !== "finalizado") {
      const { senha } = await pedir<{ senha: string }>("GET", `/jogos/${finalizado}/arbitragem/senha`);
      const entrada = await request("POST", `/arbitragem/jogos/${finalizado}/entrada/senha`, "", { nomeCompleto: "Renata Oliveira", senha });
      assert.equal(entrada.status, 201, "Não foi possível simular o acesso da arbitragem");
      const arbitroCookie = entrada.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
      const rota = `/arbitragem/jogos/${finalizado}`;
      const tecnicoCookie = await login("frontend-marcos@example.invalid");
      if (estado.status === "agendado") {
        for (const atletaId of [ana, bruno]) await pedir("POST", `/jogos/${finalizado}/escalacao`, { atletaId }, tecnicoCookie);
      }
      const participacoes = new Map<string, string>();
      for (const [atletaId, numeroCamisa] of [[ana, 7], [bruno, 9], [carla, 11], [diego, 17]] as const) {
        const { participacao } = await pedir<{ participacao: { participacaoId: string } }>("POST", `${rota}/credenciamentos`, { atletaId, numeroCamisa }, arbitroCookie);
        participacoes.set(atletaId, participacao.participacaoId);
      }
      await pedir("POST", `${rota}/inicio`, {}, arbitroCookie);
      for (const atletaId of [ana, carla]) await pedir("POST", `${rota}/credenciamentos/${atletaId}/entrada`, {}, arbitroCookie);
      const ocorrencias = [
        { atletaId: ana, tipo: "gol" }, { atletaId: ana, tipo: "gol" }, { atletaId: carla, tipo: "gol" },
        { atletaId: carla, tipo: "cartaoAmarelo" }, { atletaId: ana, tipo: "cartaoVermelho", relatorioDisciplinar: true },
      ];
      for (const [indice, { atletaId, ...ocorrencia }] of ocorrencias.entries()) {
        await pedir("POST", `${rota}/lancamentos`, { operacaoId: `bf6e0000-0000-4000-8000-${String(indice + 1).padStart(12, "0")}`,
          participacaoId: participacoes.get(atletaId), ...ocorrencia }, arbitroCookie);
      }
      await pedir("POST", `${rota}/encerramento`, { resultado: "normal", vencedorInscricaoId: estado.inscricaoClubeAId }, arbitroCookie);
      await pedir("POST", "/auth/sign-out", {}, tecnicoCookie);
    }
    if (!await prisma.arbitragem.findFirst({ where: { jogoId: agendado, nomeCompleto: "Renata Oliveira" } })) {
      await pedir("POST", `/jogos/${agendado}/arbitragens`, { nomeCompleto: "Renata Oliveira" }, presidenteCookie, 201);
    }
    if (!await prisma.suspensao.findFirst({ where: { campeonatoId: andamento, atletaId: carla, motivo: "Decisão da comissão disciplinar" } })) {
      await pedir("POST", `/campeonatos/${andamento}/suspensoes`, { atletaId: carla, quantidadeJogos: 3, motivo: "Decisão da comissão disciplinar" }, presidenteCookie, 201);
    }
    await pedir("POST", `/contas/${diego}/desativacao`, {});
    await pedir("POST", "/auth/sign-out", {});
    acesso.concluido = true;
    await salvar();
    await resumo();
  }
} finally {
  await prisma.$disconnect();
}
