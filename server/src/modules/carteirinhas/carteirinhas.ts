import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { gerarTokenQr } from "../verificacoes/verificacoes.js";

type Tx = Prisma.TransactionClient;
type Leitor = Pick<Tx, "carteirinha">;

/** Substituição informa a versão do QR que deve deixar de valer; repetir a mesma versão não gera outro QR. */
export const substituicaoQrSchema = z.strictObject({ versaoQr: z.int().min(1) });
/** O token lido vai no corpo, nunca na URL, para não aparecer em logs ou históricos de navegação. */
export const leituraQrSchema = z.strictObject({ tokenQr: z.string().trim().min(1).max(256) });

const selecaoDetalhe = {
  id: true, atletaId: true, codigo: true, tokenQr: true, versaoQr: true, status: true, emitidaEm: true, emitidaPorPresidenteId: true,
  atleta: { select: { usuario: { select: { nomeCompleto: true } } } },
  eventos: { select: { tipo: true, versaoQr: true, presidenteId: true, ocorridoEm: true }, orderBy: [{ ocorridoEm: "asc" }, { versaoQr: "asc" }] },
} satisfies Prisma.CarteirinhaSelect;

/**
 * Visão do presidente: identificação, QR vigente (para reapresentá-lo ao atleta após substituição) e
 * histórico completo de invalidações, reativações e substituições, com responsável e data.
 */
async function detalhar(db: Leitor, atletaId: string) {
  const { atleta, eventos, ...carteirinha } = await db.carteirinha.findUniqueOrThrow({ where: { atletaId }, select: selecaoDetalhe });
  return { ...carteirinha, nomeCompleto: atleta.usuario.nomeCompleto, historico: eventos };
}

export async function consultarCarteirinha(db: Leitor, atletaId: string) {
  if (!await db.carteirinha.findUnique({ where: { atletaId }, select: { id: true } })) throw new NotFoundException("Carteirinha não encontrada");
  return detalhar(db, atletaId);
}

/** Carteirinha do próprio atleta, com o QR vigente para apresentação no credenciamento (RF-005). */
export async function consultarPropria(db: Leitor, atletaId: string) {
  const carteirinha = await db.carteirinha.findUnique({ where: { atletaId }, select: {
    id: true, codigo: true, tokenQr: true, status: true, emitidaEm: true, atleta: { select: { usuario: { select: { nomeCompleto: true } } } },
  } });
  if (!carteirinha) throw new NotFoundException("Carteirinha ainda não emitida. Ela é emitida na aprovação do cadastro.");
  const { atleta, ...dados } = carteirinha;
  return { ...dados, nomeCompleto: atleta.usuario.nomeCompleto };
}

/**
 * Identificação mínima a partir do QR (RF-005, RNF-004/012): somente carteirinha, código, status e nome.
 * Não autentica ninguém, não expõe e-mail, foto, clube ou outros dados, e QR substituído não é reconhecido.
 * A decisão de elegibilidade fica no credenciamento (`participacoes/credenciamento.ts`).
 */
export async function identificarPorQr(db: Leitor, tokenQr: string) {
  const carteirinha = await db.carteirinha.findUnique({ where: { tokenQr }, select: {
    id: true, codigo: true, status: true, atleta: { select: { usuarioId: true, usuario: { select: { nomeCompleto: true } } } },
  } });
  if (!carteirinha) throw new NotFoundException("QR não reconhecido");
  return {
    carteirinhaId: carteirinha.id, codigo: carteirinha.codigo, status: carteirinha.status,
    atleta: { usuarioId: carteirinha.atleta.usuarioId, nomeCompleto: carteirinha.atleta.usuario.nomeCompleto },
  };
}

/**
 * Bloqueia a carteirinha (FOR UPDATE): operações simultâneas sobre ela são serializadas e a segunda
 * enxerga o estado já alterado. Futuros credenciamentos devem lê-la com FOR SHARE.
 */
async function bloquear(tx: Tx, atletaId: string) {
  const [carteirinha] = await tx.$queryRaw<{ id: string; status: "ativa" | "invalidada"; versaoQr: number }[]>`
    SELECT id, status::text AS status, "versaoQr" FROM "Carteirinha" WHERE "atletaId" = ${atletaId}::uuid FOR UPDATE`;
  if (!carteirinha) throw new NotFoundException("Carteirinha não encontrada");
  return carteirinha;
}

export interface ResultadoCarteirinha {
  carteirinha: Awaited<ReturnType<typeof detalhar>>;
  /** false quando a operação já estava aplicada (repetição sem efeito nem novo histórico). */
  alterado: boolean;
}

/**
 * Invalida ou reativa (RF-006, RN-013). Não altera a conta, a aprovação nem participações já
 * credenciadas; a invalidação impede apenas novos credenciamentos.
 */
export async function alterarStatus(tx: Tx, presidenteId: string, atletaId: string, status: "ativa" | "invalidada"): Promise<ResultadoCarteirinha> {
  const atual = await bloquear(tx, atletaId);
  if (atual.status === status) return { carteirinha: await detalhar(tx, atletaId), alterado: false };
  const ocorridoEm = new Date();
  await tx.carteirinha.update({ where: { id: atual.id }, data: { status } });
  await tx.eventoCarteirinha.create({ data: {
    carteirinhaId: atual.id, tipo: status === "invalidada" ? "invalidacao" : "reativacao", versaoQr: atual.versaoQr, presidenteId, ocorridoEm,
  } });
  return { carteirinha: await detalhar(tx, atletaId), alterado: true };
}

/**
 * Substitui o QR da mesma carteirinha (PEN-020): novo token, versão seguinte e evento no histórico.
 * O token anterior deixa de identificar a carteirinha; código, status e participações são mantidos.
 * Repetir a substituição da mesma versão (reenvio ou pedido simultâneo) devolve o QR já substituído.
 */
export async function substituirQr(tx: Tx, presidenteId: string, atletaId: string, versaoQr: number): Promise<ResultadoCarteirinha> {
  const atual = await bloquear(tx, atletaId);
  if (versaoQr > atual.versaoQr) throw new ConflictException(`Versão do QR inexistente; a versão vigente é ${atual.versaoQr}.`);
  if (versaoQr < atual.versaoQr) return { carteirinha: await detalhar(tx, atletaId), alterado: false };
  const nova = atual.versaoQr + 1;
  await tx.carteirinha.update({ where: { id: atual.id }, data: { tokenQr: gerarTokenQr(), versaoQr: nova } });
  await tx.eventoCarteirinha.create({ data: { carteirinhaId: atual.id, tipo: "substituicao_qr", versaoQr: nova, presidenteId, ocorridoEm: new Date() } });
  return { carteirinha: await detalhar(tx, atletaId), alterado: true };
}

/** Restrições do banco (identificação imutável, histórico preservado, token repetido) chegam como 409. */
export function traduzirErroCarteirinha(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictException("Não foi possível gerar o novo QR. Tente novamente.");
  }
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  if (driver?.cause?.originalCode === "23514") return new ConflictException("Operação recusada por conflito com os dados da carteirinha.");
  return error;
}
