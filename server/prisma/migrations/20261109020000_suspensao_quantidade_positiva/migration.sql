-- RF-038/MAR-66 exige quantidade positiva; não há teto de 100 jogos aprovado.
-- Preserva a migração já aplicada e todas as demais condições de integridade.
ALTER TABLE "Suspensao" DROP CONSTRAINT "Suspensao_dados_check";
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_dados_check" CHECK (
  "quantidadeJogos" > 0
  AND char_length(btrim("motivo")) BETWEEN 1 AND 500
  AND ("revogadaEm" IS NULL) = ("revogadaPorPresidenteId" IS NULL)
  AND ("revogadaEm" IS NULL OR "saldoEncerradoEm" IS NULL)
);
