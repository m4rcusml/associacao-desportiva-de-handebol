-- Correção e anulação de lançamentos preservando histórico (MAR-70; RF-034/036, RN-031/034, seção 11/PEN-023).
-- Anulação lógica: o lançamento continua gravado, com a data e a operação que o anulou. A correção anula o
-- original e cria o substituto (substituiLancamentoId) na mesma transação; a anulação simples só anula.
ALTER TABLE "LancamentoJogo"
  ADD COLUMN "substituiLancamentoId" UUID,
  ADD COLUMN "anuladoEm" TIMESTAMPTZ,
  ADD COLUMN "anulacaoOperacaoId" UUID;

-- Cada lançamento é substituído no máximo uma vez; cada operação anula no máximo um lançamento.
CREATE UNIQUE INDEX "LancamentoJogo_substituiLancamentoId_key" ON "LancamentoJogo"("substituiLancamentoId");
CREATE UNIQUE INDEX "LancamentoJogo_anulacaoOperacaoId_key" ON "LancamentoJogo"("anulacaoOperacaoId");

ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_substituiLancamentoId_fkey"
  FOREIGN KEY ("substituiLancamentoId") REFERENCES "LancamentoJogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_anulacao_completa"
  CHECK (("anuladoEm" IS NULL) = ("anulacaoOperacaoId" IS NULL));
ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_nao_substitui_a_si"
  CHECK ("substituiLancamentoId" IS NULL OR "substituiLancamentoId" <> "id");

-- Regras repetidas no banco:
-- * inclusão nova (sem substituiLancamentoId) somente com o jogo em andamento, como na MAR-68; após o
--   encerramento o presidente apenas corrige ou anula (decisão de Marcus, MAR-70);
-- * anulação (única alteração permitida) com o jogo em andamento ou finalizado, uma vez, sem mudar mais nada;
-- * substituto com o jogo em andamento ou finalizado, apontando um lançamento do mesmo jogo já anulado pela
--   mesma operação (anulacaoOperacaoId = operacaoId do substituto), com participação credenciada do mesmo jogo.
-- Quem pode cada operação (arbitragem durante o jogo, presidente depois) é verificado na API.
-- Os bloqueios FOR SHARE do jogo e da participação seguem a MAR-68: encerramento, adiamento, cancelamento e
-- estorno de credenciamento aguardam a gravação ou são vistos por ela.
CREATE OR REPLACE FUNCTION validar_lancamento() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF OLD."anuladoEm" IS NOT NULL OR NEW."anuladoEm" IS NULL
      OR (NEW.id, NEW."operacaoId", NEW."jogoId", NEW."participacaoId", NEW.tipo, NEW.valor, NEW."registradoEm", NEW."substituiLancamentoId")
        IS DISTINCT FROM (OLD.id, OLD."operacaoId", OLD."jogoId", OLD."participacaoId", OLD.tipo, OLD.valor, OLD."registradoEm", OLD."substituiLancamentoId") THEN
      RAISE EXCEPTION 'Lançamento só pode ser anulado, uma vez, sem alterar seus dados' USING ERRCODE = '23514';
    END IF;
    SELECT status INTO situacao FROM "Jogo" WHERE id = NEW."jogoId" FOR SHARE;
    IF situacao NOT IN ('em_andamento', 'finalizado') THEN
      RAISE EXCEPTION 'Anulação exige jogo em andamento ou finalizado' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."anuladoEm" IS NOT NULL OR NEW."anulacaoOperacaoId" IS NOT NULL THEN
    RAISE EXCEPTION 'Lançamento não nasce anulado' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO situacao FROM "Jogo" WHERE id = NEW."jogoId" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo do lançamento não encontrado' USING ERRCODE = '23503';
  END IF;
  IF NEW."substituiLancamentoId" IS NULL THEN
    IF situacao <> 'em_andamento' THEN
      RAISE EXCEPTION 'Lançamento exige jogo em andamento' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF situacao NOT IN ('em_andamento', 'finalizado') THEN
      RAISE EXCEPTION 'Correção exige jogo em andamento ou finalizado' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "LancamentoJogo"
      WHERE id = NEW."substituiLancamentoId" AND "jogoId" = NEW."jogoId" AND "anulacaoOperacaoId" = NEW."operacaoId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Correção exige lançamento do mesmo jogo anulado pela mesma operação' USING ERRCODE = '23514';
    END IF;
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

-- Projeções passam a desconsiderar os lançamentos anulados (o filtro fica na junção, preservando os zeros).
CREATE OR REPLACE VIEW "EstatisticasDoJogo" AS
SELECT j.id AS "jogoId",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol' AND p."inscricaoClubeId" = j."inscricaoClubeAId"), 0)::int AS "temp_placarClubeA",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol' AND p."inscricaoClubeId" = j."inscricaoClubeBId"), 0)::int AS "temp_placarClubeB"
FROM "Jogo" j
LEFT JOIN "LancamentoJogo" l ON l."jogoId" = j.id AND l."anuladoEm" IS NULL
LEFT JOIN "Participacao" p ON p.id = l."participacaoId"
WHERE j."iniciadoEm" IS NOT NULL
GROUP BY j.id;

CREATE OR REPLACE VIEW "DesempenhoDoAtleta" AS
SELECT p.id AS "participacaoId",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_gol'), 0)::int AS "temp_gols",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_cartaoAmarelo'), 0)::int AS "temp_cartoesAmarelos",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_exclusaoDoisMinutos'), 0)::int AS "temp_exclusoesDoisMinutos",
  COALESCE(SUM(l."valor") FILTER (WHERE l."tipo" = 'temp_cartaoVermelho'), 0)::int AS "temp_cartoesVermelhos"
FROM "Participacao" p
LEFT JOIN "LancamentoJogo" l ON l."participacaoId" = p.id AND l."anuladoEm" IS NULL
WHERE p."credenciadoEm" IS NOT NULL
GROUP BY p.id;
