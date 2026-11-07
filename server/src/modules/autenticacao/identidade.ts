import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";

/** Campos de uma conta com credencial própria: cadastro público e criação de presidente. */
export const camposConta = z.strictObject({
  nomeCompleto: z.string().trim().min(3).max(150),
  email: z.email().max(254).toLowerCase(),
  password: z.string().min(8).max(128),
});

/**
 * Cria a identidade técnica do Better Auth (`AuthUser` + `AuthAccount` credential) na transação recebida,
 * para que identidade, credencial e domínio sejam gravados atomicamente. O hash deve vir de `better-auth/crypto`.
 */
export async function criarIdentidade(tx: Prisma.TransactionClient, dados: { nomeCompleto: string; email: string; passwordHash: string }) {
  const authId = randomUUID();
  await tx.authUser.create({ data: { id: authId, name: dados.nomeCompleto, email: dados.email } });
  await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: dados.passwordHash } });
  return authId;
}

/** Converte conflitos de e-mail e de restrições SQL em 409; demais erros são devolvidos sem alteração. */
export function traduzirErroIdentidade(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictException("E-mail já cadastrado. Entre com sua senha.");
  }
  // CHECK, EXCLUDE e triggers diferidos chegam sem código Prisma próprio: no comando, dentro de
  // meta.driverAdapterError; no COMMIT, como DriverAdapterError direto.
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo === "23514" || codigo === "23P01") return new ConflictException("Não foi possível concluir o cadastro por conflito com os dados existentes.");
  return error;
}
