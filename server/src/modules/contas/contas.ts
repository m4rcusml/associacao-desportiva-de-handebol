import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Serializa desativações e reativações de contas no banco. Sem esse lock, dois presidentes que
 * desativam um ao outro bloqueariam linhas em ordem inversa (deadlock) e a proteção do último
 * presidente ativo dependeria da ordem dos commits.
 */
const LOCK_ATIVACAO_CONTAS = 600060;

/**
 * Checagem de conta ativa reutilizável por operações que dependem da conta (ex.: arbitragem por
 * designação). Bloqueia a linha `Usuario` em modo compartilhado: uma desativação concorrente aguarda
 * o commit da transação chamadora ou é observada por ela. Não se aplica à entrada por senha
 * compartilhada da arbitragem, que independe de conta (RN-025).
 */
export async function contaAtiva(tx: Prisma.TransactionClient, usuarioId: string): Promise<boolean> {
  const [linha] = await tx.$queryRaw<{ ativo: boolean }[]>`SELECT ativo FROM "Usuario" WHERE id = ${usuarioId}::uuid FOR SHARE`;
  return linha?.ativo === true;
}

/** Presidentes ativos com credencial de login, exceto o informado. O presidente fictício do seed, sem credencial, não conta. */
async function outrosPresidentesComAcesso(tx: Prisma.TransactionClient, exceto: string) {
  const ativos = await tx.usuario.findMany({ where: { perfil: "presidente", ativo: true, presidente: { isNot: null }, id: { not: exceto } }, select: { authId: true } });
  if (ativos.length === 0) return 0;
  return tx.authAccount.count({ where: { userId: { in: ativos.map(a => a.authId) }, providerId: "credential", password: { not: null } } });
}

export interface ResultadoAtivacao {
  usuario: { id: string; perfil: string; ativo: boolean };
  /** false quando a conta já estava no estado pedido (repetição sem efeito). */
  alterado: boolean;
}

/**
 * Desativa ou reativa a conta alvo na transação recebida, sem apagar histórico nem vínculos.
 * O chamador revalida o presidente na mesma transação, depois de `bloquearAtivacao`.
 * Sessões da conta alvo são revogadas nas duas operações: desativar encerra o acesso já aberto
 * e reativar exige novo login (descarta sessão eventualmente gravada durante a desativação).
 */
export async function alterarAtivacao(tx: Prisma.TransactionClient, presidenteId: string, alvoId: string, ativo: boolean): Promise<ResultadoAtivacao> {
  if (alvoId.toLowerCase() === presidenteId.toLowerCase()) throw new ForbiddenException("O presidente administra somente outras contas");
  const [alvo] = await tx.$queryRaw<{ id: string; authId: string; perfil: string; ativo: boolean }[]>`
    SELECT id, "authId", perfil::text AS perfil, ativo FROM "Usuario" WHERE id = ${alvoId}::uuid FOR UPDATE`;
  if (!alvo) throw new NotFoundException("Conta não encontrada");
  if (alvo.ativo === ativo) return { usuario: { id: alvo.id, perfil: alvo.perfil, ativo }, alterado: false };
  if (!ativo && alvo.perfil === "presidente" && await outrosPresidentesComAcesso(tx, alvo.id) === 0) {
    throw new ConflictException("Não é possível desativar o último presidente ativo");
  }
  // Nova versão: login iniciado antes desta alteração não consegue mais gravar sessão (trigger em AuthSession).
  await tx.usuario.update({ where: { id: alvo.id }, data: { ativo, versaoAtivacao: { increment: 1 } } });
  await tx.authSession.deleteMany({ where: { userId: alvo.authId } });
  return { usuario: { id: alvo.id, perfil: alvo.perfil, ativo }, alterado: true };
}

/** Primeiro comando da transação de ativação/desativação. */
export async function bloquearAtivacao(tx: Prisma.TransactionClient) {
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK_ATIVACAO_CONTAS})::text`);
}
