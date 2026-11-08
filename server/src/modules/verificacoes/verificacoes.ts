import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
type Status = "pendente" | "aprovado" | "rejeitado";

/** Filtros da consulta de solicitações pelo presidente; sem status, lista as pendentes. */
export const filtroSolicitacoesSchema = z.strictObject({
  status: z.enum(["pendente", "aprovado", "rejeitado"]).default("pendente"),
  perfil: z.enum(["atleta", "tecnico"]).optional(),
});

/** Alfabeto sem caracteres ambíguos (0/O, 1/I/L), para conferência manual do código. */
const ALFABETO_CODIGO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Código opaco e aleatório: não deriva de nome, e-mail, clube ou ordem de emissão. */
export function gerarCodigoCarteirinha() {
  return Array.from({ length: 10 }, () => ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]).join("");
}

/** Token opaco do QR (256 bits). Identifica a carteirinha; não autoriza operações (RNF-004). */
export function gerarTokenQr() {
  return randomBytes(32).toString("base64url");
}

const selecaoSolicitacao = {
  id: true, nomeCompleto: true, perfil: true, ativo: true,
  atleta: { select: {
    statusVerificacao: true, verificacaoSolicitadaEm: true, verificadoPorPresidenteId: true, verificadoEm: true,
    vinculos: { where: { fim: null }, select: { clube: { select: { id: true, nome: true } } }, take: 1 },
    carteirinha: { select: { id: true, codigo: true, status: true, emitidaEm: true, emitidaPorPresidenteId: true } },
  } },
  tecnico: { select: {
    statusVerificacao: true, verificacaoSolicitadaEm: true, verificadoPorPresidenteId: true, verificadoEm: true,
    clube: { select: { id: true, nome: true } },
  } },
} as const;
type SolicitacaoLida = Prisma.UsuarioGetPayload<{ select: typeof selecaoSolicitacao }>;

/**
 * Visão administrativa da solicitação. Sem e-mail, credenciais ou `tokenQr` (RNF-012): o QR é
 * consultado em operação própria. Atleta traz o clube do vínculo aberto; técnico, o clube atribuído.
 */
function apresentar(usuario: SolicitacaoLida) {
  const extensao = usuario.atleta ?? usuario.tecnico!;
  return {
    usuarioId: usuario.id, nomeCompleto: usuario.nomeCompleto, perfil: usuario.perfil, ativo: usuario.ativo,
    statusVerificacao: extensao.statusVerificacao, verificacaoSolicitadaEm: extensao.verificacaoSolicitadaEm,
    verificadoPorPresidenteId: extensao.verificadoPorPresidenteId, verificadoEm: extensao.verificadoEm,
    clube: usuario.atleta ? usuario.atleta.vinculos[0]?.clube ?? null : usuario.tecnico!.clube,
    ...(usuario.atleta ? { carteirinha: usuario.atleta.carteirinha } : {}),
  };
}

export async function listarSolicitacoes(db: Pick<Tx, "usuario">, { status, perfil }: z.infer<typeof filtroSolicitacoesSchema>) {
  const filtro = { statusVerificacao: status };
  const usuarios = await db.usuario.findMany({
    where: perfil === "atleta" ? { atleta: filtro } : perfil === "tecnico" ? { tecnico: filtro } : { OR: [{ atleta: filtro }, { tecnico: filtro }] },
    select: selecaoSolicitacao,
  });
  return usuarios.map(apresentar).sort((a, b) =>
    (a.verificacaoSolicitadaEm?.getTime() ?? 0) - (b.verificacaoSolicitadaEm?.getTime() ?? 0) || a.usuarioId.localeCompare(b.usuarioId));
}

async function detalhar(db: Pick<Tx, "usuario">, usuarioId: string) {
  return apresentar(await db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: selecaoSolicitacao }));
}

/**
 * Bloqueia a conta alvo (convenção da autorização: mudar aprovação bloqueia a linha `Usuario` com
 * FOR UPDATE). Decisões simultâneas sobre a mesma conta são serializadas; a segunda enxerga o estado
 * já decidido. Presidente não tem solicitação de verificação.
 */
async function bloquearSolicitante(tx: Tx, usuarioId: string) {
  const [alvo] = await tx.$queryRaw<{ perfil: string; ativo: boolean }[]>`
    SELECT perfil::text AS perfil, ativo FROM "Usuario" WHERE id = ${usuarioId}::uuid FOR UPDATE`;
  if (!alvo || (alvo.perfil !== "atleta" && alvo.perfil !== "tecnico")) throw new NotFoundException("Solicitação não encontrada");
  if (!alvo.ativo) throw new ConflictException("A conta está desativada. Reative-a antes de decidir a solicitação.");
  const perfil = alvo.perfil as "atleta" | "tecnico";
  const extensao = perfil === "atleta"
    ? await tx.atleta.findUniqueOrThrow({ where: { usuarioId }, select: { statusVerificacao: true } })
    : await tx.tecnico.findUniqueOrThrow({ where: { usuarioId }, select: { statusVerificacao: true } });
  return { perfil, status: extensao.statusVerificacao as Status };
}

export interface ResultadoDecisao {
  solicitacao: Awaited<ReturnType<typeof detalhar>>;
  /** false quando a mesma decisão já havia sido tomada (repetição sem efeito). */
  alterado: boolean;
}

/**
 * Aprova atleta ou técnico pendente (RF-003/004). Para atleta, na mesma transação: confirma o vínculo
 * inicial (registra o presidente em `definidoPorPresidenteId`) e emite a carteirinha única (RN-011).
 * Técnico não recebe carteirinha (RN-012). Repetir a aprovação devolve o estado sem duplicar nada.
 */
export async function aprovar(tx: Tx, presidenteId: string, usuarioId: string): Promise<ResultadoDecisao> {
  const { perfil, status } = await bloquearSolicitante(tx, usuarioId);
  if (status === "aprovado") return { solicitacao: await detalhar(tx, usuarioId), alterado: false };
  if (status === "rejeitado") throw new ConflictException("A solicitação foi rejeitada. A pessoa precisa solicitar nova análise antes da aprovação.");

  const decisao = { statusVerificacao: "aprovado" as const, verificadoPorPresidenteId: presidenteId, verificadoEm: new Date() };
  if (perfil === "tecnico") {
    await tx.tecnico.update({ where: { usuarioId }, data: decisao });
  } else {
    await tx.atleta.update({ where: { usuarioId }, data: decisao });
    const confirmados = await tx.vinculoClube.updateMany({ where: { atletaId: usuarioId, fim: null }, data: { definidoPorPresidenteId: presidenteId } });
    if (confirmados.count !== 1) throw new ConflictException("Atleta sem vínculo atual com clube.");
    await tx.carteirinha.create({ data: {
      atletaId: usuarioId, codigo: gerarCodigoCarteirinha(), tokenQr: gerarTokenQr(),
      emitidaEm: decisao.verificadoEm, emitidaPorPresidenteId: presidenteId,
    } });
  }
  return { solicitacao: await detalhar(tx, usuarioId), alterado: true };
}

/** Rejeita solicitação pendente, sem motivo obrigatório. Não há retirada de aprovação (PEN-013). */
export async function rejeitar(tx: Tx, presidenteId: string, usuarioId: string): Promise<ResultadoDecisao> {
  const { perfil, status } = await bloquearSolicitante(tx, usuarioId);
  if (status === "rejeitado") return { solicitacao: await detalhar(tx, usuarioId), alterado: false };
  if (status === "aprovado") throw new ConflictException("O cadastro já foi aprovado. Não há retirada de aprovação.");
  const decisao = { statusVerificacao: "rejeitado" as const, verificadoPorPresidenteId: presidenteId, verificadoEm: new Date() };
  if (perfil === "tecnico") await tx.tecnico.update({ where: { usuarioId }, data: decisao });
  else await tx.atleta.update({ where: { usuarioId }, data: decisao });
  return { solicitacao: await detalhar(tx, usuarioId), alterado: true };
}

/**
 * O próprio atleta/técnico rejeitado solicita nova análise na mesma conta: volta a pendente, com nova
 * data de solicitação; a decisão anterior deixa de constar na solicitação. Não altera perfil, clube ou dados.
 */
export async function solicitarNovamente(tx: Tx, usuarioId: string) {
  const { perfil, status } = await bloquearSolicitante(tx, usuarioId);
  const resposta = async (alterado: boolean) => {
    const { statusVerificacao, verificacaoSolicitadaEm } = await detalhar(tx, usuarioId);
    return { statusVerificacao, verificacaoSolicitadaEm, alterado };
  };
  if (status === "pendente") return resposta(false);
  if (status === "aprovado") throw new ConflictException("O cadastro já está aprovado.");
  const data = { statusVerificacao: "pendente" as const, verificacaoSolicitadaEm: new Date(), verificadoPorPresidenteId: null, verificadoEm: null };
  if (perfil === "tecnico") await tx.tecnico.update({ where: { usuarioId }, data });
  else await tx.atleta.update({ where: { usuarioId }, data });
  return resposta(true);
}

/** Conflitos de unicidade e restrições do banco (carteirinha duplicada, aprovação sem carteirinha) chegam como 409. */
export function traduzirErroVerificacao(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictException("A solicitação foi decidida por outra operação. Consulte-a e tente novamente.");
  }
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  if (driver?.cause?.originalCode === "23514") return new ConflictException("Não foi possível concluir a decisão por conflito com os dados existentes.");
  return error;
}
