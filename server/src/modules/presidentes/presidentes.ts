import { hashPassword } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { camposConta, criarIdentidade } from "../autenticacao/identidade.js";

export const novoPresidenteSchema = camposConta;
export type NovoPresidente = { nomeCompleto: string; email: string; password: string };

/** Serializa execuções concorrentes do procedimento de presidente inicial no mesmo banco. */
const LOCK_PRESIDENTE_INICIAL = 550055;

export class PresidenteInicialRecusado extends Error {}

/**
 * Identidade técnica, credencial, `Usuario` e extensão `Presidente` na transação recebida.
 * `criadoPorPresidenteId` é nulo somente no procedimento de presidente inicial (e no seed fictício).
 */
export async function criarPresidente(tx: Prisma.TransactionClient, dados: Omit<NovoPresidente, "password"> & { passwordHash: string }, criadoPorPresidenteId: string | null) {
  const authId = await criarIdentidade(tx, dados);
  return tx.usuario.create({
    data: { authId, nomeCompleto: dados.nomeCompleto, perfil: "presidente", presidente: { create: { criadoPorPresidenteId } } },
    select: { id: true, nomeCompleto: true, perfil: true, presidente: { select: { criadoPorPresidenteId: true } } },
  });
}

/** Há presidente ativo capaz de entrar? O presidente fictício do seed não possui credencial e não conta. */
async function existePresidenteComAcesso(tx: Prisma.TransactionClient) {
  const ativos = await tx.usuario.findMany({ where: { perfil: "presidente", ativo: true, presidente: { isNot: null } }, select: { authId: true } });
  if (ativos.length === 0) return false;
  return await tx.authAccount.count({ where: { userId: { in: ativos.map(a => a.authId) }, providerId: "credential", password: { not: null } } }) > 0;
}

/**
 * Procedimento restrito de implantação: cria o primeiro presidente com credencial, atomicamente.
 * Recusa quando já existe presidente ativo com credencial; a partir daí, presidentes são criados
 * somente por outro presidente autenticado (`POST /api/presidentes`).
 */
export async function criarPresidenteInicial(prisma: PrismaClient, entrada: NovoPresidente) {
  const parsed = novoPresidenteSchema.safeParse(entrada);
  if (!parsed.success) throw new PresidenteInicialRecusado("Dados inválidos: nome de 3 a 150 caracteres, e-mail válido e senha de 8 a 128 caracteres.");
  const { nomeCompleto, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async tx => {
    // Após obter o lock, a próxima leitura enxerga o commit de uma execução concorrente anterior.
    await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK_PRESIDENTE_INICIAL})::text`);
    if (await existePresidenteComAcesso(tx)) {
      throw new PresidenteInicialRecusado("Já existe presidente ativo com credencial. Novos presidentes devem ser criados por um presidente autenticado.");
    }
    return criarPresidente(tx, { nomeCompleto, email, passwordHash }, null);
  });
}
