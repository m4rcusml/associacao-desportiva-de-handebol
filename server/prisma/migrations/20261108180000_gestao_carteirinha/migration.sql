-- Gestão da carteirinha (MAR-58): invalidação, reativação e substituição do QR na mesma carteirinha,
-- com histórico somente de inclusão (responsável e data de cada operação).

-- CreateEnum
CREATE TYPE "TipoEventoCarteirinha" AS ENUM ('invalidacao', 'reativacao', 'substituicao_qr');

-- AlterTable: carteirinhas existentes estão na primeira versão do QR.
ALTER TABLE "Carteirinha" ADD COLUMN "versaoQr" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Carteirinha" ADD CONSTRAINT "Carteirinha_versaoQr_check" CHECK ("versaoQr" >= 1);

-- CreateTable
CREATE TABLE "EventoCarteirinha" (
    "id" UUID NOT NULL,
    "carteirinhaId" UUID NOT NULL,
    "tipo" "TipoEventoCarteirinha" NOT NULL,
    "versaoQr" INTEGER NOT NULL,
    "presidenteId" UUID NOT NULL,
    "ocorridoEm" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EventoCarteirinha_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventoCarteirinha_versaoQr_check" CHECK ("versaoQr" >= 1)
);

-- CreateIndex
CREATE INDEX "EventoCarteirinha_carteirinhaId_ocorridoEm_idx" ON "EventoCarteirinha"("carteirinhaId", "ocorridoEm");

-- AddForeignKey: a exclusão em cascata só ocorre junto da carteirinha, que não pode ser removida de atleta aprovado.
ALTER TABLE "EventoCarteirinha" ADD CONSTRAINT "EventoCarteirinha_carteirinhaId_fkey" FOREIGN KEY ("carteirinhaId") REFERENCES "Carteirinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoCarteirinha" ADD CONSTRAINT "EventoCarteirinha_presidenteId_fkey" FOREIGN KEY ("presidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Identificação permanente: atleta, código e emissão não mudam após a emissão. O QR só muda junto
-- com o avanço de exatamente uma versão, e a versão nunca volta.
CREATE FUNCTION validar_alteracao_carteirinha() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW."atletaId" <> OLD."atletaId" OR NEW.codigo <> OLD.codigo
     OR NEW."emitidaEm" <> OLD."emitidaEm" OR NEW."emitidaPorPresidenteId" <> OLD."emitidaPorPresidenteId" THEN
    RAISE EXCEPTION 'Identificação e emissão da carteirinha não podem ser alteradas' USING ERRCODE = '23514';
  END IF;
  IF NEW."versaoQr" NOT IN (OLD."versaoQr", OLD."versaoQr" + 1)
     OR (NEW."versaoQr" = OLD."versaoQr") <> (NEW."tokenQr" = OLD."tokenQr") THEN
    RAISE EXCEPTION 'Substituição do QR exige novo token e avanço de uma versão' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Carteirinha_alteracao_check" BEFORE UPDATE ON "Carteirinha"
  FOR EACH ROW EXECUTE FUNCTION validar_alteracao_carteirinha();

-- Histórico somente de inclusão: eventos não são alterados nem removidos enquanto a carteirinha existir.
CREATE FUNCTION preservar_evento_carteirinha() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS(SELECT 1 FROM "Carteirinha" WHERE id = OLD."carteirinhaId") THEN
    RAISE EXCEPTION 'Histórico da carteirinha não pode ser alterado ou removido' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "EventoCarteirinha_preservacao" BEFORE UPDATE OR DELETE ON "EventoCarteirinha"
  FOR EACH ROW EXECUTE FUNCTION preservar_evento_carteirinha();
