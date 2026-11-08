import { randomUUID } from "node:crypto";

/**
 * Fixture para aprovar atleta diretamente no banco: o trigger diferido da migração `carteirinha`
 * exige que atleta aprovado tenha carteirinha. Valores fictícios; a emissão real usa a API (MAR-57).
 */
export const carteirinhaFicticia = (emitidaPorPresidenteId: string) => ({
  carteirinha: { create: { codigo: `TESTE-${randomUUID()}`, tokenQr: randomUUID(), emitidaEm: new Date(), emitidaPorPresidenteId } },
});
