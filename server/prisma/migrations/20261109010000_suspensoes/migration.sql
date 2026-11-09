-- Suspensões manuais e cumprimento por jogos (MAR-66; RF-038/040/041, RN-037 a RN-040 e RN-043,
-- PEN-006/009/010/011). O saldo não é armazenado: é `quantidadeJogos` menos os cumprimentos.
-- Origem automática, `RegraSuspensao` e jogo de origem ficam para a MAR-79 (critérios pendentes, PEN-004).

-- CreateTable
CREATE TABLE "Suspensao" (
    "id" UUID NOT NULL,
    "atletaId" UUID NOT NULL,
    "campeonatoId" UUID NOT NULL,
    "quantidadeJogos" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "aplicadaPorPresidenteId" UUID NOT NULL,
    "aplicadaEm" TIMESTAMPTZ NOT NULL,
    "revogadaEm" TIMESTAMPTZ,
    "revogadaPorPresidenteId" UUID,
    "saldoEncerradoEm" TIMESTAMPTZ,

    CONSTRAINT "Suspensao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CumprimentoSuspensao" (
    "suspensaoId" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "registradoEm" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CumprimentoSuspensao_pkey" PRIMARY KEY ("suspensaoId","jogoId")
);

-- CreateIndex
CREATE INDEX "Suspensao_atletaId_campeonatoId_idx" ON "Suspensao"("atletaId", "campeonatoId");

-- CreateIndex
CREATE INDEX "Suspensao_campeonatoId_idx" ON "Suspensao"("campeonatoId");

-- CreateIndex
CREATE INDEX "CumprimentoSuspensao_jogoId_idx" ON "CumprimentoSuspensao"("jogoId");

-- AddForeignKey
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_atletaId_fkey" FOREIGN KEY ("atletaId") REFERENCES "Atleta"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_campeonatoId_fkey" FOREIGN KEY ("campeonatoId") REFERENCES "Campeonato"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_aplicadaPorPresidenteId_fkey" FOREIGN KEY ("aplicadaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_revogadaPorPresidenteId_fkey" FOREIGN KEY ("revogadaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CumprimentoSuspensao" ADD CONSTRAINT "CumprimentoSuspensao_suspensaoId_fkey" FOREIGN KEY ("suspensaoId") REFERENCES "Suspensao"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CumprimentoSuspensao" ADD CONSTRAINT "CumprimentoSuspensao_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Quantidade positiva e motivo informado; revogação com responsável e data juntos. Revogação e término do
-- saldo com o campeonato são registros distintos: a suspensão tem no máximo um deles.
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_dados_check" CHECK (
  "quantidadeJogos" BETWEEN 1 AND 100
  AND char_length(btrim("motivo")) BETWEEN 1 AND 500
  AND ("revogadaEm" IS NULL) = ("revogadaPorPresidenteId" IS NULL)
  AND ("revogadaEm" IS NULL OR "saldoEncerradoEm" IS NULL)
);

-- Aplicação: atleta aprovado e campeonato planejado ou em andamento (bloqueio FOR SHARE da linha
-- `Campeonato`: encerramento/cancelamento concorrente aguarda ou já é visto). Os dados da aplicação não
-- mudam; revogação e término do saldo são definitivos, e o término só ocorre com o campeonato encerrado ou
-- cancelado. Exclusão somente na cascata da remoção do próprio campeonato.
CREATE FUNCTION validar_suspensao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusCampeonato";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Campeonato" WHERE id = OLD."campeonatoId") THEN
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
    IF NEW."revogadaEm" IS NOT NULL OR NEW."saldoEncerradoEm" IS NOT NULL THEN
      RAISE EXCEPTION 'Suspensão nasce vigente' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."atletaId" <> OLD."atletaId" OR NEW."campeonatoId" <> OLD."campeonatoId"
     OR NEW."quantidadeJogos" <> OLD."quantidadeJogos" OR NEW."motivo" <> OLD."motivo"
     OR NEW."aplicadaPorPresidenteId" <> OLD."aplicadaPorPresidenteId" OR NEW."aplicadaEm" <> OLD."aplicadaEm" THEN
    RAISE EXCEPTION 'Os dados da aplicação da suspensão não podem ser alterados' USING ERRCODE = '23514';
  END IF;
  IF OLD."revogadaEm" IS NOT NULL AND (NEW."revogadaEm" IS DISTINCT FROM OLD."revogadaEm"
     OR NEW."revogadaPorPresidenteId" IS DISTINCT FROM OLD."revogadaPorPresidenteId") THEN
    RAISE EXCEPTION 'Revogação da suspensão é definitiva' USING ERRCODE = '23514';
  END IF;
  IF OLD."saldoEncerradoEm" IS NOT NULL AND NEW."saldoEncerradoEm" IS DISTINCT FROM OLD."saldoEncerradoEm" THEN
    RAISE EXCEPTION 'Término do saldo da suspensão é definitivo' USING ERRCODE = '23514';
  END IF;
  IF OLD."saldoEncerradoEm" IS NULL AND NEW."saldoEncerradoEm" IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM "Campeonato" WHERE id = NEW."campeonatoId" AND status IN ('encerrado', 'cancelado')) THEN
    RAISE EXCEPTION 'O saldo só termina com o campeonato encerrado ou cancelado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Suspensao_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "Suspensao"
  FOR EACH ROW EXECUTE FUNCTION validar_suspensao();

-- Cumprimento somente de inclusão. O jogo é do campeonato da suspensão, está finalizado e terminou depois
-- da aplicação; o atleta tinha, no encerramento, vínculo com um dos clubes do jogo; o jogo em que ele já
-- estava credenciado antes da aplicação é preservado e não conta (PEN-011); a suspensão está vigente e o
-- saldo não fica negativo. A linha `Suspensao` é bloqueada (FOR UPDATE): cumprimentos concorrentes da mesma
-- suspensão se serializam e a contagem enxerga os já confirmados. Repetição do mesmo par fica para a chave
-- primária (ON CONFLICT na aplicação). Exclusão somente na cascata da remoção do jogo ou da suspensão.
CREATE FUNCTION validar_cumprimento_suspensao() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF s."revogadaEm" IS NOT NULL OR s."saldoEncerradoEm" IS NOT NULL THEN
    RAISE EXCEPTION 'Suspensão revogada ou com saldo encerrado não recebe cumprimento' USING ERRCODE = '23514';
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

CREATE TRIGGER "CumprimentoSuspensao_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "CumprimentoSuspensao"
  FOR EACH ROW EXECUTE FUNCTION validar_cumprimento_suspensao();
