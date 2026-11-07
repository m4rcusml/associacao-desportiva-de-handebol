import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";

const nome = z.string().trim().min(2).max(120);
const cidade = z.string().trim().min(2).max(120).nullable();
const uuid = z.uuid().transform(id => id.toLowerCase());

/** Criação: nome obrigatório (não precisa ser único); cidade opcional. Clube nasce sem técnico. */
export const novoClubeSchema = z.strictObject({ nome, cidade: cidade.optional() });
/** Edição de nome/cidade; `cidade: null` remove a cidade. Vínculos e histórico não são alterados. */
export const edicaoClubeSchema = z.strictObject({ nome: nome.optional(), cidade: cidade.optional() })
  .refine(dados => dados.nome !== undefined || dados.cidade !== undefined, { message: "Informe nome ou cidade" });
/**
 * Atribuição ou substituição. Com o clube já ocupado, `substituirTecnicoId` deve indicar o técnico
 * atual: evita que duas atribuições simultâneas à mesma vaga se sobrescrevam silenciosamente.
 */
export const atribuicaoSchema = z.strictObject({ tecnicoId: uuid, substituirTecnicoId: uuid.optional() });

type Tx = Prisma.TransactionClient;

const selecaoClube = {
  id: true, nome: true, cidade: true, criadoPorPresidenteId: true,
  tecnico: { select: { usuarioId: true, usuario: { select: { nomeCompleto: true, ativo: true } } } },
} as const;
type ClubeLido = Prisma.ClubeGetPayload<{ select: typeof selecaoClube }>;

/** Somente o presidente recebe `criadoPorPresidenteId` e a situação da conta do técnico (`ativo`). */
function apresentarClube({ tecnico, criadoPorPresidenteId, ...dados }: ClubeLido, paraPresidente: boolean) {
  return { ...dados, ...(paraPresidente ? { criadoPorPresidenteId } : {}), tecnico: tecnico ? {
    id: tecnico.usuarioId, nomeCompleto: tecnico.usuario.nomeCompleto,
    ...(paraPresidente ? { ativo: tecnico.usuario.ativo } : {}),
  } : null };
}

export async function detalharClube(db: Pick<Tx, "clube">, clubeId: string, paraPresidente = true) {
  const clube = await db.clube.findUnique({ where: { id: clubeId }, select: selecaoClube });
  if (!clube) throw new NotFoundException("Clube não encontrado");
  return apresentarClube(clube, paraPresidente);
}

/** Visão geral para contas autenticadas: todos os clubes com o técnico atual (ou null). */
export async function listarClubes(db: Pick<Tx, "clube">, paraPresidente: boolean) {
  const clubes = await db.clube.findMany({ select: selecaoClube, orderBy: [{ nome: "asc" }, { id: "asc" }] });
  return clubes.map(clube => apresentarClube(clube, paraPresidente));
}

/** Serializa alterações da vaga de técnico do clube (lock da linha `Clube`). */
async function bloquearClube(tx: Tx, clubeId: string) {
  const linhas = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Clube" WHERE id = ${clubeId}::uuid FOR UPDATE`;
  if (linhas.length === 0) throw new NotFoundException("Clube não encontrado");
}

/** Convenção da autorização: alterar o clube de uma conta bloqueia sua linha `Usuario` (ordem fixa contra deadlock). */
async function bloquearUsuarios(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function atribuirTecnico(tx: Tx, clubeId: string, { tecnicoId, substituirTecnicoId }: z.infer<typeof atribuicaoSchema>) {
  await bloquearClube(tx, clubeId);
  const atual = await tx.tecnico.findUnique({ where: { clubeId }, select: { usuarioId: true } });
  if (atual?.usuarioId === tecnicoId) return detalharClube(tx, clubeId);
  if (atual && atual.usuarioId !== substituirTecnicoId) {
    throw new ConflictException("O clube já possui técnico. Para substituí-lo, informe o técnico atual em substituirTecnicoId.");
  }
  if (!atual && substituirTecnicoId) throw new ConflictException("O técnico informado para substituição não está atribuído a este clube.");

  await bloquearUsuarios(tx, atual ? [tecnicoId, atual.usuarioId] : [tecnicoId]);
  const novo = await tx.usuario.findUnique({ where: { id: tecnicoId }, select: { ativo: true, tecnico: { select: { statusVerificacao: true, clubeId: true } } } });
  if (!novo?.tecnico) throw new NotFoundException("Técnico não encontrado");
  if (!novo.ativo || novo.tecnico.statusVerificacao !== "aprovado") throw new ConflictException("Somente técnico aprovado e com conta ativa pode ser atribuído.");
  if (novo.tecnico.clubeId) throw new ConflictException("O técnico já está atribuído a outro clube. Desvincule-o antes de atribuí-lo.");

  if (atual) await tx.tecnico.update({ where: { usuarioId: atual.usuarioId }, data: { clubeId: null } });
  await tx.tecnico.update({ where: { usuarioId: tecnicoId }, data: { clubeId } });
  return detalharClube(tx, clubeId);
}

export async function desvincularTecnico(tx: Tx, clubeId: string, tecnicoId: string) {
  await bloquearClube(tx, clubeId);
  const atual = await tx.tecnico.findUnique({ where: { clubeId }, select: { usuarioId: true } });
  if (atual?.usuarioId !== tecnicoId) throw new ConflictException("O técnico informado não está atribuído a este clube.");
  await bloquearUsuarios(tx, [tecnicoId]);
  await tx.tecnico.update({ where: { usuarioId: tecnicoId }, data: { clubeId: null } });
  return detalharClube(tx, clubeId);
}

/** Violação das restrições do banco (vaga/técnico já ocupados ou técnico não aprovado) chega como 409. */
export function traduzirErroClube(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictException("A vaga de técnico ou o técnico já foi ocupado por outra atribuição. Consulte o clube e tente novamente.");
  }
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  if (driver?.cause?.originalCode === "23514") return new ConflictException("Somente técnico aprovado pode ser atribuído.");
  return error;
}
