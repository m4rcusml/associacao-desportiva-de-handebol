import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type MotivoRevogacaoArbitragem, type StatusJogo, type VisualizacaoArbitragem } from "../../generated/prisma/client.js";
import { type Ator, carregarAtor } from "../autorizacao/ator.js";
import { clubeImpeditivo } from "../jogos/jogos.js";
import { horaLocal } from "../jogos/fuso.js";
import { type CofreSenhaArbitragem, conferirSenha, gerarSenha, hashSenha, hashToken, novoToken } from "./senha.js";

type Tx = Prisma.TransactionClient;

/** Expiração técnica da sessão temporária; não substitui a revogação ao encerrar, adiar ou cancelar. */
export const DURACAO_SESSAO_MS = 24 * 60 * 60 * 1000;

const visualizacao = z.enum(["linha", "banco"]);
export const entradaDesignacaoSchema = z.strictObject({ visualizacao: visualizacao.optional() });
export const entradaSenhaSchema = z.strictObject({
  nomeCompleto: z.string().trim().min(2).max(120),
  senha: z.string().min(1).max(64),
  visualizacao: visualizacao.optional(),
});
export const visualizacaoSchema = z.strictObject({ visualizacao });

interface JogoAcesso {
  id: string;
  status: StatusJogo;
  fusoHorario: string;
  inicioPrevistoEm: Date | null;
  iniciadoEm: Date | null;
  clubeA: string;
  clubeB: string;
  /** Comparação de datas no fuso do local, com o relógio do banco (PEN-021). */
  dia: "antes" | "hoje" | "passou" | "sem_data";
}

/**
 * Lê o jogo com bloqueio compartilhado: início, encerramento, adiamento e cancelamento (que alteram a
 * linha) aguardam esta transação ou já estão visíveis. Primeiro bloqueio de toda operação da arbitragem.
 */
async function bloquearJogo(tx: Tx, jogoId: string): Promise<JogoAcesso> {
  const [jogo] = await tx.$queryRaw<JogoAcesso[]>`
    SELECT j.id, j.status, j."fusoHorario", j."inicioPrevistoEm", j."iniciadoEm", a."clubeId" AS "clubeA", b."clubeId" AS "clubeB",
      CASE
        WHEN j."inicioPrevistoEm" IS NULL THEN 'sem_data'
        WHEN (now() AT TIME ZONE j."fusoHorario")::date < (j."inicioPrevistoEm" AT TIME ZONE j."fusoHorario")::date THEN 'antes'
        WHEN (now() AT TIME ZONE j."fusoHorario")::date = (j."inicioPrevistoEm" AT TIME ZONE j."fusoHorario")::date THEN 'hoje'
        ELSE 'passou'
      END AS dia
    FROM "Jogo" j
    JOIN "InscricaoClube" a ON a.id = j."inscricaoClubeAId"
    JOIN "InscricaoClube" b ON b.id = j."inscricaoClubeBId"
    WHERE j.id = ${jogoId}::uuid
    FOR SHARE OF j`;
  if (!jogo) throw new NotFoundException("Jogo não encontrado");
  return jogo;
}

/**
 * Disponibilidade do acesso (RF-025/029/030, seção 11): jogo em andamento continua acessível, inclusive
 * após a meia-noite local; jogo agendado só no dia marcado no fuso do local. Sem início até a virada do
 * dia, o acesso termina e depende de reagendamento. Encerrado ou cancelado não tem acesso.
 */
function exigirDisponivel(jogo: JogoAcesso) {
  if (jogo.status === "em_andamento") return;
  if (jogo.status !== "agendado") throw new ForbiddenException(`Jogo ${jogo.status}: o acesso da arbitragem está encerrado.`);
  if (jogo.dia === "hoje") return;
  throw new ForbiddenException({
    antes: "O acesso da arbitragem abre somente no dia do jogo, no fuso do local da partida.",
    passou: "O dia do jogo terminou sem início da partida; o acesso depende de reagendamento pelo presidente.",
    sem_data: "O jogo está sem data; o acesso depende de reagendamento pelo presidente.",
  }[jogo.dia]);
}

const statusGestaoSenha: StatusJogo[] = ["agendado", "em_andamento"];

/**
 * Conta designada apta (RN-025/027): conta ativa e aprovada (linha `Usuario` em FOR SHARE: desativação,
 * transferência e atribuição de técnico aguardam ou são vistas) e sem vínculo atual com os clubes do jogo.
 */
async function contaDesignadaApta(tx: Tx, usuarioId: string, jogo: JogoAcesso): Promise<Ator> {
  await tx.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${usuarioId}::uuid FOR SHARE`;
  const conta = await carregarAtor(tx, { id: usuarioId });
  if (!conta) throw new UnauthorizedException("Cadastro indisponível");
  if (!conta.aprovado) throw new ForbiddenException("Operação disponível somente após aprovação do cadastro");
  if (await clubeImpeditivo(tx, usuarioId, [jogo.clubeA, jogo.clubeB])) {
    throw new ForbiddenException("Atleta ou técnico de um dos clubes do jogo não pode arbitrá-lo pela designação.");
  }
  return conta;
}

/** Sessão de conta de origem ainda existente, não expirada e da mesma conta (FOR SHARE: logout aguarda). */
async function exigirSessaoDeOrigem(tx: Tx, authSessionId: string, authId: string) {
  const [origem] = await tx.$queryRaw<{ valida: boolean }[]>`
    SELECT ("userId" = ${authId} AND "expiresAt" > now()) AS valida FROM "AuthSession" WHERE id = ${authSessionId} FOR SHARE`;
  if (!origem?.valida) throw new UnauthorizedException("A sessão da conta que abriu este acesso terminou. Entre novamente.");
}

async function abrirSessao(tx: Tx, arbitragemId: string, metodoEntrada: "designacao" | "senha", authSessionId: string | null) {
  const { token, tokenHash } = novoToken();
  const criadaEm = new Date();
  const expiraEm = new Date(criadaEm.getTime() + DURACAO_SESSAO_MS);
  await tx.sessaoArbitragem.create({ data: { arbitragemId, metodoEntrada, authSessionId, tokenHash, criadaEm, expiraEm } });
  return { token, expiraEm };
}

/**
 * Entrada sem senha (RF-026, RN-025/027): sessão de conta ativa, designação para este jogo e ausência de
 * vínculo impeditivo, no dia do jogo. Ordem de bloqueios: jogo → designação → conta → sessão de origem.
 * A designação é bloqueada para atualização: dois dispositivos da mesma conta entram em sequência.
 */
export async function entrarPorDesignacao(tx: Tx, jogoId: string, ator: Ator, authSessionId: string, dados: z.infer<typeof entradaDesignacaoSchema>) {
  const jogo = await bloquearJogo(tx, jogoId);
  exigirDisponivel(jogo);
  if (ator.perfil === "presidente") throw new ForbiddenException("Presidente não é designado como árbitro; consulte a senha do jogo para distribuí-la.");
  const [arbitragem] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Arbitragem" WHERE "jogoId" = ${jogoId}::uuid AND "usuarioId" = ${ator.usuarioId}::uuid FOR NO KEY UPDATE`;
  if (!arbitragem) throw new ForbiddenException("Conta sem designação para este jogo. Sem designação, a entrada é pela senha do jogo.");
  const conta = await contaDesignadaApta(tx, ator.usuarioId, jogo);
  await exigirSessaoDeOrigem(tx, authSessionId, conta.authId);
  await registrarAcesso(tx, arbitragem.id, dados.visualizacao);
  const sessao = await abrirSessao(tx, arbitragem.id, "designacao", authSessionId);
  return { ...sessao, resumo: await resumirSessao(tx, jogoId, sessao.token) };
}

async function registrarAcesso(tx: Tx, arbitragemId: string, visualizacao?: VisualizacaoArbitragem) {
  await tx.$executeRaw`
    UPDATE "Arbitragem" SET "acessouEm" = COALESCE("acessouEm", now()), visualizacao = COALESCE(${visualizacao ?? null}::"VisualizacaoArbitragem", visualizacao)
    WHERE id = ${arbitragemId}::uuid`;
}

/** Erro único para senha errada ou inexistente: não revela se a senha já foi emitida. */
const senhaInvalida = () => new UnauthorizedException("Nome ou senha inválidos para este jogo.");

/**
 * Entrada pela senha compartilhada (RF-027, RN-025/026): exige nome completo e dispensa conta e conferência
 * de vínculo, mesmo para pessoa cadastrada. Cada entrada cria um registro de arbitragem próprio, sem
 * presumir identidade pelo nome. O acesso é lido em FOR SHARE: uma troca de senha concorrente (FOR UPDATE)
 * ou vem antes (a senha antiga falha) ou depois (e revoga esta sessão).
 */
export async function entrarPorSenha(tx: Tx, jogoId: string, dados: z.infer<typeof entradaSenhaSchema>) {
  const jogo = await bloquearJogo(tx, jogoId);
  exigirDisponivel(jogo);
  const [acesso] = await tx.$queryRaw<{ senhaHash: string; revogadoEm: Date | null }[]>`
    SELECT "senhaHash", "revogadoEm" FROM "AcessoArbitragem" WHERE "jogoId" = ${jogoId}::uuid FOR SHARE`;
  if (!acesso || acesso.revogadoEm || !await conferirSenha(acesso.senhaHash, dados.senha)) throw senhaInvalida();
  const { id } = await tx.arbitragem.create({ data: { jogoId, nomeCompleto: dados.nomeCompleto, visualizacao: dados.visualizacao ?? null, acessouEm: new Date() }, select: { id: true } });
  const sessao = await abrirSessao(tx, id, "senha", null);
  return { ...sessao, resumo: await resumirSessao(tx, jogoId, sessao.token) };
}

export interface ArbitragemAutorizada {
  situacao: "autorizada";
  sessaoId: string;
  arbitragemId: string;
  jogoId: string;
  status: StatusJogo;
  metodoEntrada: "designacao" | "senha";
  /** Conta designada; null na entrada por senha. */
  usuarioId: string | null;
  nomeCompleto: string;
}

interface SessaoLida {
  id: string; arbitragemId: string; metodoEntrada: "designacao" | "senha"; authSessionId: string | null;
  revogadaEm: Date | null; motivoRevogacao: MotivoRevogacaoArbitragem | null; expirada: boolean;
  usuarioId: string | null; nomeCompleto: string | null;
}

const acessoIndisponivel = () => new UnauthorizedException("Acesso de arbitragem indisponível. Entre novamente pela designação ou pela senha do jogo.");

async function revalidar(tx: Tx, jogoId: string, token: string | undefined, reconhecerEncerramento: boolean): Promise<ArbitragemAutorizada | { situacao: "jogo_encerrado"; jogoId: string }> {
  if (!token) throw acessoIndisponivel();
  const jogo = await bloquearJogo(tx, jogoId);
  const [sessao] = await tx.$queryRaw<SessaoLida[]>`
    SELECT s.id, s."arbitragemId", s."metodoEntrada", s."authSessionId", s."revogadaEm", s."motivoRevogacao", s."expiraEm" <= now() AS expirada,
      a."usuarioId", a."nomeCompleto"
    FROM "SessaoArbitragem" s JOIN "Arbitragem" a ON a.id = s."arbitragemId"
    WHERE s."tokenHash" = ${hashToken(token)} AND a."jogoId" = ${jogoId}::uuid
    FOR SHARE OF s`;
  if (!sessao) throw acessoIndisponivel();
  if (sessao.revogadaEm) {
    // Reenvio do encerramento já confirmado: reconhecido sem devolver permissão alguma (seção 11).
    if (reconhecerEncerramento && sessao.motivoRevogacao === "jogo_encerrado" && jogo.status === "finalizado") return { situacao: "jogo_encerrado", jogoId };
    throw acessoIndisponivel();
  }
  if (sessao.expirada) throw acessoIndisponivel();
  exigirDisponivel(jogo);
  let nomeCompleto = sessao.nomeCompleto;
  if (sessao.metodoEntrada === "designacao") {
    // Sem conta designada ou sessão de origem, nega; nunca se converte em acesso por senha.
    if (!sessao.usuarioId || !sessao.authSessionId) throw acessoIndisponivel();
    const conta = await contaDesignadaApta(tx, sessao.usuarioId, jogo);
    await exigirSessaoDeOrigem(tx, sessao.authSessionId, conta.authId);
    nomeCompleto = conta.nomeCompleto;
  }
  return {
    situacao: "autorizada", sessaoId: sessao.id, arbitragemId: sessao.arbitragemId, jogoId, status: jogo.status,
    metodoEntrada: sessao.metodoEntrada, usuarioId: sessao.usuarioId, nomeCompleto: nomeCompleto ?? "",
  };
}

/**
 * Autorização da arbitragem para operações esportivas (RNF-003), a chamar dentro da transação de escrita,
 * antes de gravar. Bloqueia em modo compartilhado, nesta ordem: jogo → sessão temporária → conta designada →
 * sessão de conta de origem. Encerramento, adiamento, cancelamento, troca de senha, retirada da designação,
 * desativação e logout alteram ou removem essas linhas; por isso aguardam esta transação ou já são vistos
 * por ela, e uma autorização anterior não permite gravação posterior à revogação. A operação chamadora
 * ainda confere o status exigido (ex.: lançamentos só com o jogo em andamento).
 */
export async function revalidarArbitragem(tx: Tx, jogoId: string, token: string | undefined): Promise<ArbitragemAutorizada> {
  return await revalidar(tx, jogoId, token, false) as ArbitragemAutorizada;
}

/**
 * Variante para o encerramento (MAR-69): o reenvio de quem encerrou o jogo, cuja sessão foi revogada pelo
 * próprio encerramento, é reconhecido como `jogo_encerrado`, para responder "já encerrado" com o estado
 * atual, sem autorizar nenhuma outra operação. Qualquer outra revogação continua negada.
 */
export function revalidarArbitragemOuEncerramento(tx: Tx, jogoId: string, token: string | undefined) {
  return revalidar(tx, jogoId, token, true);
}

/** Estado da sessão para a página temporária. Não expõe a senha nem dados cadastrais além do nome. */
export async function resumirSessao(tx: Tx, jogoId: string, token: string | undefined) {
  const autorizada = await revalidarArbitragem(tx, jogoId, token);
  const [jogo, arbitragem, sessao] = await Promise.all([
    tx.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: {
      id: true, status: true, local: true, fusoHorario: true, inicioPrevistoEm: true, iniciadoEm: true,
      inscricaoClubeA: { select: { id: true, clube: { select: { id: true, nome: true } } } },
      inscricaoClubeB: { select: { id: true, clube: { select: { id: true, nome: true } } } },
    } }),
    tx.arbitragem.findUniqueOrThrow({ where: { id: autorizada.arbitragemId }, select: { id: true, visualizacao: true } }),
    tx.sessaoArbitragem.findUniqueOrThrow({ where: { id: autorizada.sessaoId }, select: { expiraEm: true } }),
  ]);
  const { inscricaoClubeA, inscricaoClubeB, ...dados } = jogo;
  return {
    jogo: {
      ...dados, inicioPrevistoLocal: dados.inicioPrevistoEm ? horaLocal(dados.inicioPrevistoEm, dados.fusoHorario) : null,
      clubeA: { inscricaoId: inscricaoClubeA.id, clube: inscricaoClubeA.clube }, clubeB: { inscricaoId: inscricaoClubeB.id, clube: inscricaoClubeB.clube },
    },
    arbitragem: { id: arbitragem.id, nomeCompleto: autorizada.nomeCompleto, visualizacao: arbitragem.visualizacao },
    sessao: { metodoEntrada: autorizada.metodoEntrada, expiraEm: sessao.expiraEm },
    // Troca e consulta da senha dependem da conta designada autenticada, não deste cookie (seção 10).
    podeGerirSenhaPelaConta: autorizada.metodoEntrada === "designacao",
  };
}

/** Linha ou banco (RF-028): muda só a tela apresentada (RN-029), para todos os dispositivos desta arbitragem. */
export async function alterarVisualizacao(tx: Tx, jogoId: string, token: string | undefined, visualizacao: VisualizacaoArbitragem) {
  const { arbitragemId } = await revalidarArbitragem(tx, jogoId, token);
  await tx.arbitragem.update({ where: { id: arbitragemId }, data: { visualizacao } });
  return resumirSessao(tx, jogoId, token);
}

/** Encerra somente a sessão deste dispositivo; repetir ou usar cookie já inválido não tem efeito. */
export async function sairDaArbitragem(tx: Tx, jogoId: string, token: string | undefined) {
  if (!token) return { encerrada: false };
  const encerradas = await tx.$executeRaw`
    UPDATE "SessaoArbitragem" s SET "revogadaEm" = now(), "motivoRevogacao" = 'saida'
    FROM "Arbitragem" a
    WHERE a.id = s."arbitragemId" AND a."jogoId" = ${jogoId}::uuid AND s."tokenHash" = ${hashToken(token)} AND s."revogadaEm" IS NULL`;
  return { encerrada: encerradas > 0 };
}

/**
 * Consulta e troca da senha (seção 10/11): presidente ou conta autenticada, designada para o jogo, ativa,
 * aprovada e sem vínculo impeditivo. A sessão temporária (inclusive por senha) não concede essa permissão.
 * Ordem de bloqueios: jogo → designação → conta, a mesma da entrada por designação.
 */
async function exigirGestorDaSenha(tx: Tx, jogoId: string, ator: Ator) {
  const jogo = await bloquearJogo(tx, jogoId);
  const [designacao] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Arbitragem" WHERE "jogoId" = ${jogoId}::uuid AND "usuarioId" = ${ator.usuarioId}::uuid FOR SHARE`;
  if (ator.perfil === "presidente") {
    await tx.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${ator.usuarioId}::uuid FOR SHARE`;
    const presidente = await carregarAtor(tx, { id: ator.usuarioId });
    if (!presidente) throw new UnauthorizedException("Cadastro indisponível");
  } else {
    if (!designacao) throw new ForbiddenException("Somente o presidente ou conta designada para este jogo consulta ou troca a senha.");
    await contaDesignadaApta(tx, ator.usuarioId, jogo);
  }
  if (!statusGestaoSenha.includes(jogo.status)) throw new ConflictException(`Jogo ${jogo.status}: o acesso da arbitragem está encerrado e a senha não é mais usada.`);
}

/** Acesso do jogo bloqueado para atualização; a primeira senha é gerada automaticamente (RN-028). */
async function bloquearAcesso(tx: Tx, cofre: CofreSenhaArbitragem, jogoId: string) {
  const ler = () => tx.$queryRaw<{ senhaCifrada: string; geradaEm: Date; revogadoEm: Date | null }[]>`
    SELECT "senhaCifrada", "geradaEm", "revogadoEm" FROM "AcessoArbitragem" WHERE "jogoId" = ${jogoId}::uuid FOR UPDATE`;
  let [acesso] = await ler();
  if (!acesso) {
    const senha = gerarSenha();
    // Emissões simultâneas: a primeira vale, e a outra lê a senha já gravada.
    await tx.$executeRaw`
      INSERT INTO "AcessoArbitragem" ("jogoId", "senhaHash", "senhaCifrada", "geradaEm")
      VALUES (${jogoId}::uuid, ${await hashSenha(senha)}, ${cofre.cifrar(jogoId, senha)}, now())
      ON CONFLICT ("jogoId") DO NOTHING`;
    [acesso] = await ler();
  }
  if (acesso.revogadoEm) throw new ConflictException("O acesso da arbitragem deste jogo foi encerrado.");
  return acesso;
}

/** Senha atual para distribuição; gerada na primeira consulta. Resposta sem cache (`Cache-Control: no-store`). */
export async function consultarSenha(tx: Tx, cofre: CofreSenhaArbitragem, jogoId: string, ator: Ator) {
  await exigirGestorDaSenha(tx, jogoId, ator);
  const acesso = await bloquearAcesso(tx, cofre, jogoId);
  return { jogoId, senha: cofre.decifrar(jogoId, acesso.senhaCifrada), geradaEm: acesso.geradaEm };
}

/**
 * Gera nova senha (hash e cópia cifrada juntos) e revoga as sessões abertas por senha, preservando as por
 * designação (seção 10). Para a troca manual e para o adiamento (MAR-69, que revoga também as designadas).
 */
export async function renovarSenha(tx: Tx, cofre: CofreSenhaArbitragem, jogoId: string, motivo: "troca_senha" | "jogo_adiado" = "troca_senha") {
  await bloquearAcesso(tx, cofre, jogoId);
  const senha = gerarSenha();
  const { geradaEm } = await tx.acessoArbitragem.update({
    where: { jogoId }, data: { senhaHash: await hashSenha(senha), senhaCifrada: cofre.cifrar(jogoId, senha), geradaEm: new Date() }, select: { geradaEm: true },
  });
  const sessoesRevogadas = await revogarSessoes(tx, [jogoId], motivo, "senha");
  return { jogoId, senha, geradaEm, sessoesRevogadas };
}

/** Troca manual pelo presidente ou pela conta designada (RN-028). */
export async function trocarSenha(tx: Tx, cofre: CofreSenhaArbitragem, jogoId: string, ator: Ator) {
  await exigirGestorDaSenha(tx, jogoId, ator);
  return renovarSenha(tx, cofre, jogoId, "troca_senha");
}

/** Revoga as sessões ainda válidas dos jogos (todas ou só as de um método), com o motivo informado. */
export async function revogarSessoes(tx: Tx, jogoIds: string[], motivo: MotivoRevogacaoArbitragem, metodo?: "designacao" | "senha") {
  if (jogoIds.length === 0) return 0;
  return tx.$executeRaw`
    UPDATE "SessaoArbitragem" s SET "revogadaEm" = now(), "motivoRevogacao" = ${motivo}::"MotivoRevogacaoArbitragem"
    FROM "Arbitragem" a
    WHERE a.id = s."arbitragemId" AND a."jogoId" = ANY(${jogoIds}::uuid[]) AND s."revogadaEm" IS NULL
      ${metodo ? Prisma.sql`AND s."metodoEntrada" = ${metodo}::"MetodoEntradaArbitragem"` : Prisma.empty}`;
}

/**
 * Encerramento ou cancelamento do jogo (RF-029, RN-031): revoga a senha e todas as sessões temporárias, de
 * ambos os métodos, na transação que muda o status. Contas permanentes e outros jogos não são afetados.
 */
export async function encerrarAcessoArbitragem(tx: Tx, jogoIds: string[], motivo: "jogo_encerrado" | "jogo_cancelado") {
  if (jogoIds.length === 0) return 0;
  await tx.acessoArbitragem.updateMany({ where: { jogoId: { in: jogoIds }, revogadoEm: null }, data: { revogadoEm: new Date() } });
  return revogarSessoes(tx, jogoIds, motivo);
}

/** Violações de trigger/CHECK por corrida com mudança de status chegam como 409. */
export function traduzirErroArbitragem(error: unknown): unknown {
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo === "23503" || codigo === "23514") return new ConflictException("Operação recusada por conflito com o estado atual do jogo ou da arbitragem. Consulte-o e tente novamente.");
  return error;
}
