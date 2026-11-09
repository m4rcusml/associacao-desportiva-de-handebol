-- Suspensão automática por desqualificação com relatório disciplinar (MAR-79; RF-039, RN-041/042/043,
-- requisitos seção 12, PEN-004/009). Critério único aprovado: vermelho com relatório (cartão azul) gera um jogo de
-- suspensão no mesmo campeonato, uma vez por atleta/jogo/regra, após o encerramento definitivo.

-- 1. Relatório disciplinar no próprio lançamento do vermelho: o azul informa o relatório da mesma desqualificação,
-- não uma segunda infração. Obrigatório (true/false) somente no vermelho; vermelhos anteriores ficam sem relatório
-- (nada permite inferi-lo). Muda apenas por correção (anula e cria substituto), como tipo e atleta (MAR-70).
ALTER TABLE "LancamentoJogo" ADD COLUMN "relatorioDisciplinar" BOOLEAN;
UPDATE "LancamentoJogo" SET "relatorioDisciplinar" = false WHERE tipo = 'temp_cartaoVermelho';
ALTER TABLE "LancamentoJogo" ADD CONSTRAINT "LancamentoJogo_relatorio_somente_vermelho"
  CHECK (("tipo" = 'temp_cartaoVermelho') = ("relatorioDisciplinar" IS NOT NULL));

CREATE FUNCTION validar_relatorio_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."relatorioDisciplinar" IS DISTINCT FROM OLD."relatorioDisciplinar" THEN
    RAISE EXCEPTION 'Relatório disciplinar do lançamento só muda por correção' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LancamentoJogo_relatorio_imutavel" BEFORE UPDATE ON "LancamentoJogo"
  FOR EACH ROW EXECUTE FUNCTION validar_relatorio_imutavel();

-- 2. Origem da suspensão. Manual: presidente responsável, sem jogo nem regra. Automática: sem presidente, com jogo de
-- origem e regra. `anuladaEm` (somente automática) registra a retirada da ocorrência de origem por correção ou
-- anulação: encerra o saldo indevido, preserva cumprimentos e é distinto de revogação e de término com o campeonato.
CREATE TYPE "OrigemSuspensao" AS ENUM ('manual', 'automatica');
CREATE TYPE "RegraSuspensao" AS ENUM ('desqualificacao_com_relatorio');

ALTER TABLE "Suspensao"
  ADD COLUMN "origem" "OrigemSuspensao" NOT NULL DEFAULT 'manual',
  ADD COLUMN "jogoOrigemId" UUID,
  ADD COLUMN "regra" "RegraSuspensao",
  ADD COLUMN "anuladaEm" TIMESTAMPTZ,
  ALTER COLUMN "aplicadaPorPresidenteId" DROP NOT NULL;

ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_jogoOrigemId_fkey"
  FOREIGN KEY ("jogoOrigemId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
CREATE INDEX "Suspensao_jogoOrigemId_idx" ON "Suspensao"("jogoOrigemId");

ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_origem_check" CHECK (
  CASE "origem"
    WHEN 'manual' THEN "aplicadaPorPresidenteId" IS NOT NULL AND "jogoOrigemId" IS NULL AND "regra" IS NULL AND "anuladaEm" IS NULL
    ELSE "aplicadaPorPresidenteId" IS NULL AND "jogoOrigemId" IS NOT NULL AND "regra" IS NOT NULL
  END
  AND ("anuladaEm" IS NULL OR ("revogadaEm" IS NULL AND "saldoEncerradoEm" IS NULL))
);

-- Uma automática não anulada por atleta/jogo/regra: repetição e encerramentos concorrentes não duplicam. Depois da
-- anulação, uma nova correção que restaure a ocorrência gera outra suspensão, a partir dela.
CREATE UNIQUE INDEX "Suspensao_automatica_unica" ON "Suspensao"("atletaId", "jogoOrigemId", "regra")
  WHERE "anuladaEm" IS NULL;

-- Mesmas regras da MAR-66, acrescidas da origem: automática nasce com jogo de origem finalizado do mesmo
-- campeonato; origem, jogo, regra e anulação são imutáveis, e a anulação é definitiva.
CREATE OR REPLACE FUNCTION validar_suspensao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusCampeonato";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Campeonato" WHERE id = OLD."campeonatoId")
       AND (OLD."jogoOrigemId" IS NULL OR EXISTS(SELECT 1 FROM "Jogo" WHERE id = OLD."jogoOrigemId")) THEN
      RAISE EXCEPTION 'Suspensão não pode ser excluída; revogue-a para preservar o histórico' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO situacao FROM "Campeonato" WHERE id = NEW."campeonatoId" FOR SHARE;
    IF situacao IS NULL OR situacao NOT IN ('planejado', 'em_andamento') THEN
      RAISE EXCEPTION 'Suspensão só é aplicada em campeonato planejado ou em andamento' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "Atleta" WHERE "usuarioId" = NEW."atletaId" AND "statusVerificacao" = 'aprovado') THEN
      RAISE EXCEPTION 'Somente atleta aprovado pode ser suspenso' USING ERRCODE = '23514';
    END IF;
    IF NEW."revogadaEm" IS NOT NULL OR NEW."saldoEncerradoEm" IS NOT NULL OR NEW."anuladaEm" IS NOT NULL THEN
      RAISE EXCEPTION 'Suspensão nasce vigente' USING ERRCODE = '23514';
    END IF;
    IF NEW."origem" = 'automatica' AND NOT EXISTS(
      SELECT 1 FROM "Jogo" WHERE id = NEW."jogoOrigemId" AND "campeonatoId" = NEW."campeonatoId" AND status = 'finalizado'
    ) THEN
      RAISE EXCEPTION 'Suspensão automática exige jogo de origem finalizado do mesmo campeonato' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."atletaId" <> OLD."atletaId" OR NEW."campeonatoId" <> OLD."campeonatoId"
     OR NEW."quantidadeJogos" <> OLD."quantidadeJogos" OR NEW."motivo" <> OLD."motivo"
     OR NEW."aplicadaPorPresidenteId" IS DISTINCT FROM OLD."aplicadaPorPresidenteId" OR NEW."aplicadaEm" <> OLD."aplicadaEm"
     OR NEW."origem" <> OLD."origem" OR NEW."jogoOrigemId" IS DISTINCT FROM OLD."jogoOrigemId"
     OR NEW."regra" IS DISTINCT FROM OLD."regra" THEN
    RAISE EXCEPTION 'Os dados da aplicação da suspensão não podem ser alterados' USING ERRCODE = '23514';
  END IF;
  IF OLD."revogadaEm" IS NOT NULL AND (NEW."revogadaEm" IS DISTINCT FROM OLD."revogadaEm"
     OR NEW."revogadaPorPresidenteId" IS DISTINCT FROM OLD."revogadaPorPresidenteId") THEN
    RAISE EXCEPTION 'Revogação da suspensão é definitiva' USING ERRCODE = '23514';
  END IF;
  IF OLD."saldoEncerradoEm" IS NOT NULL AND NEW."saldoEncerradoEm" IS DISTINCT FROM OLD."saldoEncerradoEm" THEN
    RAISE EXCEPTION 'Término do saldo da suspensão é definitivo' USING ERRCODE = '23514';
  END IF;
  IF OLD."anuladaEm" IS NOT NULL AND NEW."anuladaEm" IS DISTINCT FROM OLD."anuladaEm" THEN
    RAISE EXCEPTION 'Anulação da suspensão automática é definitiva' USING ERRCODE = '23514';
  END IF;
  IF OLD."saldoEncerradoEm" IS NULL AND NEW."saldoEncerradoEm" IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM "Campeonato" WHERE id = NEW."campeonatoId" AND status IN ('encerrado', 'cancelado')) THEN
    RAISE EXCEPTION 'O saldo só termina com o campeonato encerrado ou cancelado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Cumprimento (MAR-66) passa a recusar suspensão anulada e o próprio jogo de origem (RN-041).
CREATE OR REPLACE FUNCTION validar_cumprimento_suspensao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s "Suspensao"%ROWTYPE;
  j "Jogo"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Cumprimento de suspensão não pode ser alterado' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Jogo" WHERE id = OLD."jogoId") AND EXISTS(SELECT 1 FROM "Suspensao" WHERE id = OLD."suspensaoId") THEN
      RAISE EXCEPTION 'Cumprimento de suspensão não pode ser excluído' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO s FROM "Suspensao" WHERE id = NEW."suspensaoId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suspensão não encontrada' USING ERRCODE = '23503';
  END IF;
  IF EXISTS(SELECT 1 FROM "CumprimentoSuspensao" WHERE "suspensaoId" = NEW."suspensaoId" AND "jogoId" = NEW."jogoId") THEN
    RETURN NEW;
  END IF;
  SELECT * INTO j FROM "Jogo" WHERE id = NEW."jogoId" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado' USING ERRCODE = '23503';
  END IF;
  IF j."campeonatoId" <> s."campeonatoId" OR j.status <> 'finalizado' OR j."encerradoEm" <= s."aplicadaEm" THEN
    RAISE EXCEPTION 'Somente jogo finalizado do campeonato, encerrado após a aplicação, cumpre a suspensão' USING ERRCODE = '23514';
  END IF;
  IF j.id = s."jogoOrigemId" THEN
    RAISE EXCEPTION 'O jogo de origem não cumpre a suspensão automática' USING ERRCODE = '23514';
  END IF;
  IF s."revogadaEm" IS NOT NULL OR s."saldoEncerradoEm" IS NOT NULL OR s."anuladaEm" IS NOT NULL THEN
    RAISE EXCEPTION 'Suspensão revogada, anulada ou com saldo encerrado não recebe cumprimento' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM "CumprimentoSuspensao" WHERE "suspensaoId" = s.id) >= s."quantidadeJogos" THEN
    RAISE EXCEPTION 'Suspensão já cumprida' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM "VinculoClube" v JOIN "InscricaoClube" i ON i."clubeId" = v."clubeId"
    WHERE v."atletaId" = s."atletaId" AND i.id IN (j."inscricaoClubeAId", j."inscricaoClubeBId")
      AND v.inicio <= j."encerradoEm" AND (v.fim IS NULL OR v.fim > j."encerradoEm")
  ) THEN
    RAISE EXCEPTION 'O jogo não é do clube do atleta' USING ERRCODE = '23514';
  END IF;
  IF EXISTS(
    SELECT 1 FROM "Participacao" WHERE "jogoId" = j.id AND "atletaId" = s."atletaId" AND "credenciadoEm" <= s."aplicadaEm"
  ) THEN
    RAISE EXCEPTION 'Jogo em que o atleta já estava credenciado antes da suspensão não a cumpre' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
