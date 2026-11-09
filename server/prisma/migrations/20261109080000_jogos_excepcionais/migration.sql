-- Jogos excepcionais, vencedor separado e retomada (MAR-72; PEN-012, RF-035/036, RN-031/039/040, seção 11).
-- * O encerramento definitivo grava `resultado` (normal, interrompido definitivamente, abandono ou W.O.) e o vencedor
--   (inscrição A ou B; vazio = nenhum vencedor, decidido explicitamente), separados do placar, que continua vindo dos
--   lançamentos. W.O. é o único encerramento sem início (agendado → finalizado) e tem placar 0 a 0.
-- * Interrupção temporária não muda o status: o jogo continua em andamento, com os mesmos registros e acessos, e
--   `InterrupcaoJogo` guarda cada interrupção e retomada. Durante a interrupção, novos lançamentos e entradas em quadra
--   são recusados; correções, anulações e credenciamentos continuam. Só o encerramento definitivo cumpre suspensões.
-- * Após o encerramento, somente o presidente corrige resultado/vencedor ou invalida o jogo, com o registro em
--   `AlteracaoResultadoJogo` gravado antes na mesma transação. A invalidação é definitiva e preserva placar,
--   estatísticas e cumprimentos.

-- CreateEnum
CREATE TYPE "ResultadoJogo" AS ENUM ('normal', 'interrompido', 'abandono', 'wo');

-- CreateEnum
CREATE TYPE "TipoAlteracaoResultado" AS ENUM ('correcao', 'invalidacao');

-- AlterTable
ALTER TABLE "Jogo" ADD COLUMN     "inscricaoClubeVencedorId" UUID,
ADD COLUMN     "invalidadoEm" TIMESTAMPTZ,
ADD COLUMN     "resultado" "ResultadoJogo";

-- CreateTable
CREATE TABLE "InterrupcaoJogo" (
    "id" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "interrompidoEm" TIMESTAMPTZ NOT NULL,
    "retomadoEm" TIMESTAMPTZ,

    CONSTRAINT "InterrupcaoJogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlteracaoResultadoJogo" (
    "id" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "tipo" "TipoAlteracaoResultado" NOT NULL,
    "resultadoAnterior" "ResultadoJogo" NOT NULL,
    "inscricaoVencedorAnteriorId" UUID,
    "resultadoNovo" "ResultadoJogo" NOT NULL,
    "inscricaoVencedorNovoId" UUID,
    "motivo" TEXT,
    "presidenteId" UUID NOT NULL,
    "registradaEm" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AlteracaoResultadoJogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterrupcaoJogo_jogoId_interrompidoEm_idx" ON "InterrupcaoJogo"("jogoId", "interrompidoEm");

-- CreateIndex
CREATE INDEX "AlteracaoResultadoJogo_jogoId_registradaEm_idx" ON "AlteracaoResultadoJogo"("jogoId", "registradaEm");

-- CreateIndex
CREATE INDEX "AlteracaoResultadoJogo_presidenteId_idx" ON "AlteracaoResultadoJogo"("presidenteId");

-- AddForeignKey
ALTER TABLE "InterrupcaoJogo" ADD CONSTRAINT "InterrupcaoJogo_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoResultadoJogo" ADD CONSTRAINT "AlteracaoResultadoJogo_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoResultadoJogo" ADD CONSTRAINT "AlteracaoResultadoJogo_presidenteId_fkey" FOREIGN KEY ("presidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Jogos já finalizados antes desta migração (todos iniciados): resultado normal e vencedor pelo placar (empate = nenhum).
UPDATE "Jogo" j SET
  "resultado" = CASE WHEN j."iniciadoEm" IS NULL THEN 'wo'::"ResultadoJogo" ELSE 'normal'::"ResultadoJogo" END,
  "inscricaoClubeVencedorId" = (
    SELECT CASE WHEN e."temp_placarClubeA" > e."temp_placarClubeB" THEN j."inscricaoClubeAId"
                WHEN e."temp_placarClubeB" > e."temp_placarClubeA" THEN j."inscricaoClubeBId" END
    FROM "EstatisticasDoJogo" e WHERE e."jogoId" = j.id)
WHERE j.status = 'finalizado';

-- Resultado e vencedor existem somente no jogo finalizado; W.O. somente sem início e os demais somente com início;
-- vencedor é uma das duas inscrições do jogo; invalidação somente de jogo finalizado.
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_resultado_check" CHECK (
  ("status" = 'finalizado') = ("resultado" IS NOT NULL)
  AND ("resultado" IS NULL OR ("resultado" = 'wo') = ("iniciadoEm" IS NULL))
  AND ("status" = 'finalizado' OR ("inscricaoClubeVencedorId" IS NULL AND "invalidadoEm" IS NULL))
  AND ("inscricaoClubeVencedorId" IS NULL OR "inscricaoClubeVencedorId" IN ("inscricaoClubeAId", "inscricaoClubeBId"))
);

-- Correção: resultado/vencedor mudam e o tipo de resultado permanece compatível com o início (W.O. só muda o vencedor).
-- Invalidação: motivo obrigatório; resultado e vencedor apenas copiados.
ALTER TABLE "AlteracaoResultadoJogo" ADD CONSTRAINT "AlteracaoResultadoJogo_dados_check" CHECK (
  CASE "tipo"
    WHEN 'correcao' THEN ("resultadoNovo", "inscricaoVencedorNovoId") IS DISTINCT FROM ("resultadoAnterior", "inscricaoVencedorAnteriorId")
      AND ("resultadoNovo" = 'wo') = ("resultadoAnterior" = 'wo')
    ELSE "motivo" IS NOT NULL AND btrim("motivo") <> ''
      AND "resultadoNovo" = "resultadoAnterior" AND "inscricaoVencedorNovoId" IS NOT DISTINCT FROM "inscricaoVencedorAnteriorId"
  END
);

-- Histórico somente de inclusão, gravado na transação da alteração (registradaEm = now()) a partir do jogo finalizado
-- vigente. Exclusão só na cascata da remoção do jogo.
CREATE FUNCTION validar_alteracao_resultado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Histórico do resultado não pode ser alterado' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Jogo" WHERE id = OLD."jogoId") THEN
      RAISE EXCEPTION 'Histórico do resultado não pode ser excluído' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."registradaEm" <> now() THEN
    RAISE EXCEPTION 'Alteração do resultado é registrada na própria transação' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "Jogo"
    WHERE id = NEW."jogoId" AND status = 'finalizado' AND (NEW.tipo = 'correcao' OR "invalidadoEm" IS NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alteração do resultado exige jogo finalizado (e ainda não invalidado, na invalidação)' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM "Jogo" WHERE id = NEW."jogoId" AND "resultado" = NEW."resultadoAnterior"
      AND "inscricaoClubeVencedorId" IS NOT DISTINCT FROM NEW."inscricaoVencedorAnteriorId"
      AND (NEW."inscricaoVencedorNovoId" IS NULL OR NEW."inscricaoVencedorNovoId" IN ("inscricaoClubeAId", "inscricaoClubeBId"))
  ) THEN
    RAISE EXCEPTION 'Alteração deve partir do resultado vigente e indicar inscrição do jogo' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AlteracaoResultadoJogo_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "AlteracaoResultadoJogo"
  FOR EACH ROW EXECUTE FUNCTION validar_alteracao_resultado();

-- Mudanças do jogo finalizado: resultado/vencedor somente com a correção registrada nesta transação; invalidação uma
-- vez, com o registro correspondente. A arbitragem grava resultado e vencedor junto do encerramento (sem histórico).
CREATE FUNCTION validar_resultado_jogo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."invalidadoEm" IS NOT NULL AND NEW."invalidadoEm" IS DISTINCT FROM OLD."invalidadoEm" THEN
    RAISE EXCEPTION 'Invalidação do jogo é definitiva' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'finalizado'
     AND (NEW."resultado", NEW."inscricaoClubeVencedorId") IS DISTINCT FROM (OLD."resultado", OLD."inscricaoClubeVencedorId")
     AND NOT EXISTS(
       SELECT 1 FROM "AlteracaoResultadoJogo"
       WHERE "jogoId" = OLD.id AND tipo = 'correcao' AND "registradaEm" = now()
         AND "resultadoAnterior" = OLD."resultado" AND "inscricaoVencedorAnteriorId" IS NOT DISTINCT FROM OLD."inscricaoClubeVencedorId"
         AND "resultadoNovo" = NEW."resultado" AND "inscricaoVencedorNovoId" IS NOT DISTINCT FROM NEW."inscricaoClubeVencedorId") THEN
    RAISE EXCEPTION 'Correção do resultado exige o registro no histórico' USING ERRCODE = '23514';
  END IF;
  IF OLD."invalidadoEm" IS NULL AND NEW."invalidadoEm" IS NOT NULL
     AND (NEW."invalidadoEm" <> now() OR NOT EXISTS(
       SELECT 1 FROM "AlteracaoResultadoJogo" WHERE "jogoId" = OLD.id AND tipo = 'invalidacao' AND "registradaEm" = now())) THEN
    RAISE EXCEPTION 'Invalidação do jogo exige o registro no histórico' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Jogo_resultado_validacao" BEFORE UPDATE ON "Jogo"
  FOR EACH ROW EXECUTE FUNCTION validar_resultado_jogo();

-- Interrupções: no máximo uma aberta por jogo; abertura e retomada somente com o jogo em andamento (FOR SHARE: o
-- encerramento, que bloqueia o jogo para atualização, aguarda ou é visto). A retomada é a única alteração.
CREATE UNIQUE INDEX "InterrupcaoJogo_aberta_key" ON "InterrupcaoJogo"("jogoId") WHERE "retomadoEm" IS NULL;
ALTER TABLE "InterrupcaoJogo" ADD CONSTRAINT "InterrupcaoJogo_periodo_check" CHECK ("retomadoEm" IS NULL OR "retomadoEm" >= "interrompidoEm");

CREATE FUNCTION validar_interrupcao_jogo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Jogo" WHERE id = OLD."jogoId") THEN
      RAISE EXCEPTION 'Interrupção do jogo não pode ser excluída' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."retomadoEm" IS NOT NULL OR NEW."retomadoEm" IS NULL
     OR (NEW.id, NEW."jogoId", NEW."interrompidoEm") IS DISTINCT FROM (OLD.id, OLD."jogoId", OLD."interrompidoEm")) THEN
    RAISE EXCEPTION 'Interrupção só recebe a retomada, uma vez' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."retomadoEm" IS NOT NULL THEN
    RAISE EXCEPTION 'Interrupção nasce aberta' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "Jogo" WHERE id = NEW."jogoId" AND status = 'em_andamento' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interrupção e retomada exigem jogo em andamento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InterrupcaoJogo_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "InterrupcaoJogo"
  FOR EACH ROW EXECUTE FUNCTION validar_interrupcao_jogo();

-- Durante a interrupção: recusa lançamento novo (não a correção, que cria substituto) e entrada em quadra.
CREATE FUNCTION exigir_jogo_sem_interrupcao(jogo UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "Jogo" WHERE id = jogo FOR SHARE;
  IF EXISTS(SELECT 1 FROM "InterrupcaoJogo" WHERE "jogoId" = jogo AND "retomadoEm" IS NULL) THEN
    RAISE EXCEPTION 'Jogo interrompido: retome a partida antes de novos lançamentos ou entradas em quadra' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION validar_lancamento_sem_interrupcao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."substituiLancamentoId" IS NULL THEN
    PERFORM exigir_jogo_sem_interrupcao(NEW."jogoId");
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validar_entrada_sem_interrupcao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entrouEmQuadraEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."entrouEmQuadraEm" IS NULL) THEN
    PERFORM exigir_jogo_sem_interrupcao(NEW."jogoId");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LancamentoJogo_interrupcao" BEFORE INSERT ON "LancamentoJogo"
  FOR EACH ROW EXECUTE FUNCTION validar_lancamento_sem_interrupcao();
CREATE TRIGGER "Participacao_interrupcao" BEFORE INSERT OR UPDATE OF "entrouEmQuadraEm" ON "Participacao"
  FOR EACH ROW EXECUTE FUNCTION validar_entrada_sem_interrupcao();

-- Placar 0 a 0 também no W.O. sem início; os demais continuam exigindo início (MAR-68/MAR-70).
CREATE OR REPLACE VIEW "EstatisticasDoJogo" AS
SELECT j.id AS "jogoId",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol' AND p."inscricaoClubeId" = j."inscricaoClubeAId"), 0)::int AS "temp_placarClubeA",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol' AND p."inscricaoClubeId" = j."inscricaoClubeBId"), 0)::int AS "temp_placarClubeB"
FROM "Jogo" j
LEFT JOIN "LancamentoJogo" l ON l."jogoId" = j.id AND l."anuladoEm" IS NULL
LEFT JOIN "Participacao" p ON p.id = l."participacaoId"
WHERE j."iniciadoEm" IS NOT NULL OR j."resultado" = 'wo'
GROUP BY j.id;
