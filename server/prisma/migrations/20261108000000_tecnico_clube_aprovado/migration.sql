-- Somente técnico aprovado pode ocupar a vaga de técnico de um clube (MAR-56).
-- A unicidade de "Tecnico"."clubeId" (migração inicial) já garante, inclusive sob concorrência,
-- no máximo um técnico por clube; a coluna única garante no máximo um clube por técnico.
ALTER TABLE "Tecnico" ADD CONSTRAINT "Tecnico_clube_aprovado_check" CHECK (
  "clubeId" IS NULL OR "statusVerificacao" = 'aprovado'
);
