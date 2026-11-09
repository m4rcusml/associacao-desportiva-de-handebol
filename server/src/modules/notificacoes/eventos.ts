import type { Prisma, TipoEventoJogo } from "../../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;

/**
 * Registra o aviso de mudança do jogo na caixa de saída `EventoJogo` (MAR-73), dentro da transação da própria
 * mudança: só existe se ela for confirmada, e o trigger avisa o publicador somente no commit. Chamar apenas quando
 * a operação de fato alterou algo (`alterado: true`); reenvios e repetições não geram novo evento.
 */
export async function registrarEvento(tx: Tx, jogoId: string, tipo: TipoEventoJogo, referenciaId: string | null = null) {
  await tx.$executeRaw`
    INSERT INTO "EventoJogo" ("jogoId", tipo, "referenciaId") VALUES (${jogoId}::uuid, ${tipo}::"TipoEventoJogo", ${referenciaId}::uuid)`;
}
