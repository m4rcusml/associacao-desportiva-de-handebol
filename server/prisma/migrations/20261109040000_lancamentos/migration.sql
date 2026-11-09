-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('temp_gol', 'temp_cartaoAmarelo', 'temp_exclusaoDoisMinutos', 'temp_cartaoVermelho');

-- CreateTable
CREATE TABLE "LancamentoJogo" (
    "id" UUID NOT NULL,
    "operacaoId" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "participacaoId" UUID,
    "tipo" "TipoLancamento" NOT NULL,
    "valor" INTEGER NOT NULL DEFAULT 1,
    "registradoEm" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LancamentoJogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LancamentoJogo_operacaoId_key" ON "LancamentoJogo"("operacaoId");

-- CreateIndex
CREATE INDEX "LancamentoJogo_jogoId_registradoEm_idx" ON "LancamentoJogo"("jogoId", "registradoEm");

-- CreateIndex
CREATE INDEX "LancamentoJogo_participacaoId_idx" ON "LancamentoJogo"("participacaoId");

-- AddForeignKey
ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_participacaoId_fkey" FOREIGN KEY ("participacaoId") REFERENCES "Participacao"("id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- Restrições complementares (MAR-68; RF-031/032/037, RN-032 a 036, RNF-006/009/011).
-- valor é inteiro positivo; a API grava 1 por ocorrência.
ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_valor_positivo" CHECK ("valor" > 0);
-- Todos os tipos provisórios são ocorrências de atleta: gol e penalidades identificam a participação (RN-032).
ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_ocorrencia_de_atleta"
  CHECK ("tipo" NOT IN ('temp_gol', 'temp_cartaoAmarelo', 'temp_exclusaoDoisMinutos', 'temp_cartaoVermelho') OR "participacaoId" IS NOT NULL);

-- Lançamento nasce com o jogo em andamento e a participação credenciada do mesmo jogo. Os bloqueios FOR SHARE
-- fazem encerramento, adiamento ou cancelamento (que alteram a linha do jogo) e o estorno do credenciamento
-- (MAR-71) aguardarem a gravação ou serem vistos por ela. Nesta tarefa o lançamento é somente de inclusão:
-- anulação e correção preservando o original ficam para a MAR-70; exclusão só na cascata do jogo.
CREATE FUNCTION validar_lancamento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusJogo";
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "Jogo" WHERE id = OLD."jogoId";
    IF FOUND THEN
      RAISE EXCEPTION 'Lançamento não pode ser excluído' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Lançamento não pode ser alterado' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO situacao FROM "Jogo" WHERE id = NEW."jogoId" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo do lançamento não encontrado' USING ERRCODE = '23503';
  END IF;
  IF situacao <> 'em_andamento' THEN
    RAISE EXCEPTION 'Lançamento exige jogo em andamento' USING ERRCODE = '23514';
  END IF;
  IF NEW."participacaoId" IS NOT NULL THEN
    PERFORM 1 FROM "Participacao"
      WHERE id = NEW."participacaoId" AND "jogoId" = NEW."jogoId" AND "credenciadoEm" IS NOT NULL
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lançamento de atleta exige participação credenciada no mesmo jogo' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LancamentoJogo_validar"
  BEFORE INSERT OR UPDATE OR DELETE ON "LancamentoJogo"
  FOR EACH ROW EXECUTE FUNCTION validar_lancamento();

-- Projeções (RF-032/033, RNF-006/009): calculadas dos lançamentos a cada consulta, sem totais armazenados que
-- possam divergir. O clube do gol é o da participação. Placar existe a partir do início do jogo (0 a 0);
-- desempenho, a partir do credenciamento. A MAR-70 passará a desconsiderar os lançamentos anulados.
CREATE VIEW "EstatisticasDoJogo" AS
SELECT j.id AS "jogoId",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol' AND p."inscricaoClubeId" = j."inscricaoClubeAId"), 0)::int AS "temp_placarClubeA",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol' AND p."inscricaoClubeId" = j."inscricaoClubeBId"), 0)::int AS "temp_placarClubeB"
FROM "Jogo" j
LEFT JOIN "LancamentoJogo" l ON l."jogoId" = j.id
LEFT JOIN "Participacao" p ON p.id = l."participacaoId"
WHERE j."iniciadoEm" IS NOT NULL
GROUP BY j.id;

CREATE VIEW "DesempenhoDoAtleta" AS
SELECT p.id AS "participacaoId",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol'), 0)::int AS "temp_gols",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_cartaoAmarelo'), 0)::int AS "temp_cartoesAmarelos",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_exclusaoDoisMinutos'), 0)::int AS "temp_exclusoesDoisMinutos",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_cartaoVermelho'), 0)::int AS "temp_cartoesVermelhos"
FROM "Participacao" p
LEFT JOIN "LancamentoJogo" l ON l."participacaoId" = p.id
WHERE p."credenciadoEm" IS NOT NULL
GROUP BY p.id;
