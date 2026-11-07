import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Perfil, Prisma } from "../../generated/prisma/client.js";

/** Ator autenticado no domínio. Construído somente a partir da sessão persistida, nunca da entrada. */
export interface Ator {
  usuarioId: string;
  authId: string;
  nomeCompleto: string;
  perfil: Perfil;
  statusVerificacao: "pendente" | "aprovado" | "rejeitado" | null;
  /** Presidente sempre; atleta/técnico somente com verificação aprovada. */
  aprovado: boolean;
  /** Clube atual: vínculo aberto do atleta ou clube do técnico. Presidente não possui. */
  clubeId: string | null;
}

export interface Requisito {
  perfis?: readonly Perfil[];
  /** Exige aprovação esportiva (privilégios dos módulos esportivos). */
  aprovado?: boolean;
}

type Leitor = Pick<Prisma.TransactionClient, "usuario">;

/** Carrega o ator; null para identidade sem domínio, cadastro inativo ou extensão ausente. */
export async function carregarAtor(db: Leitor, where: { authId: string } | { id: string }): Promise<Ator | null> {
  const usuario = await db.usuario.findUnique({ where, select: {
    id: true, authId: true, nomeCompleto: true, perfil: true, ativo: true,
    atleta: { select: { statusVerificacao: true, vinculos: { where: { fim: null }, select: { clubeId: true }, take: 1 } } },
    tecnico: { select: { statusVerificacao: true, clubeId: true } },
    presidente: { select: { usuarioId: true } },
  } });
  if (!usuario?.ativo || !usuario[usuario.perfil]) return null;
  const statusVerificacao = usuario.atleta?.statusVerificacao ?? usuario.tecnico?.statusVerificacao ?? null;
  return {
    usuarioId: usuario.id, authId: usuario.authId, nomeCompleto: usuario.nomeCompleto, perfil: usuario.perfil, statusVerificacao,
    aprovado: usuario.perfil === "presidente" || statusVerificacao === "aprovado",
    clubeId: usuario.atleta?.vinculos[0]?.clubeId ?? usuario.tecnico?.clubeId ?? null,
  };
}

export function exigirRequisito(ator: Ator | null, requisito: Requisito = {}): Ator {
  if (!ator) throw new UnauthorizedException("Cadastro indisponível");
  if (requisito.perfis && !requisito.perfis.includes(ator.perfil)) throw new ForbiddenException("Operação não permitida para o seu perfil");
  if (requisito.aprovado && !ator.aprovado) throw new ForbiddenException("Operação disponível somente após aprovação do cadastro");
  return ator;
}

/**
 * Acesso a dados ou operações de um clube: presidente acessa qualquer clube; atleta/técnico aprovado,
 * somente o próprio clube atual. O clube autorizado vem do cadastro, nunca da requisição.
 */
export function exigirAcessoClube(ator: Ator, clubeId: string, perfis: readonly Perfil[] = ["presidente", "tecnico", "atleta"]): Ator {
  exigirRequisito(ator, { perfis, aprovado: true });
  if (ator.perfil !== "presidente" && ator.clubeId?.toLowerCase() !== clubeId.toLowerCase()) throw new ForbiddenException("Acesso restrito ao seu clube");
  return ator;
}
