-- Carteirinha do atleta emitida na aprovação (MAR-57). Campos mínimos provisórios (PEN-008);
-- invalidação, reativação e substituição do QR com histórico ficam para a MAR-58.

-- Antes desta migração não havia fluxo de aprovação; recusar em vez de deixar atleta aprovado sem carteirinha.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Atleta" WHERE "statusVerificacao" = 'aprovado') THEN
    RAISE EXCEPTION 'Há atleta aprovado sem carteirinha; emita as carteirinhas antes de aplicar esta migração';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "StatusCarteirinha" AS ENUM ('ativa', 'invalidada');

-- CreateTable
CREATE TABLE "Carteirinha" (
    "id" UUID NOT NULL,
    "atletaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "tokenQr" TEXT NOT NULL,
    "status" "StatusCarteirinha" NOT NULL DEFAULT 'ativa',
    "emitidaEm" TIMESTAMPTZ NOT NULL,
    "emitidaPorPresidenteId" UUID NOT NULL,

    CONSTRAINT "Carteirinha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Carteirinha_atletaId_key" ON "Carteirinha"("atletaId");

-- CreateIndex
CREATE UNIQUE INDEX "Carteirinha_codigo_key" ON "Carteirinha"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Carteirinha_tokenQr_key" ON "Carteirinha"("tokenQr");

-- AddForeignKey
ALTER TABLE "Carteirinha" ADD CONSTRAINT "Carteirinha_atletaId_fkey" FOREIGN KEY ("atletaId") REFERENCES "Atleta"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carteirinha" ADD CONSTRAINT "Carteirinha_emitidaPorPresidenteId_fkey" FOREIGN KEY ("emitidaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Atleta aprovado ⇔ carteirinha existente, verificado no fim da transação (diferido): a aprovação
-- não é gravada sem identificação, a carteirinha não existe sem aprovação e não há retirada de
-- aprovação mantendo a carteirinha. A FK para "Atleta" já impede carteirinha de técnico (RN-012).
CREATE FUNCTION validar_carteirinha_atleta() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  atletas uuid[];
  pessoa uuid;
  aprovado boolean;
BEGIN
  IF TG_TABLE_NAME = 'Atleta' THEN
    atletas := ARRAY[NEW."usuarioId", OLD."usuarioId"];
  ELSE
    atletas := ARRAY[NEW."atletaId", OLD."atletaId"];
  END IF;
  FOREACH pessoa IN ARRAY atletas LOOP
    IF pessoa IS NULL THEN CONTINUE; END IF;
    SELECT "statusVerificacao" = 'aprovado' INTO aprovado FROM "Atleta" WHERE "usuarioId" = pessoa;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF aprovado <> EXISTS(SELECT 1 FROM "Carteirinha" WHERE "atletaId" = pessoa) THEN
      RAISE EXCEPTION 'Atleta aprovado exige exatamente uma carteirinha, e somente atleta aprovado a possui' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Atleta_carteirinha_check" AFTER INSERT OR UPDATE ON "Atleta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validar_carteirinha_atleta();
CREATE CONSTRAINT TRIGGER "Carteirinha_aprovacao_check" AFTER INSERT OR UPDATE OR DELETE ON "Carteirinha"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validar_carteirinha_atleta();
