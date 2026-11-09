-- Correção de camisa e estorno de credenciamento preservando histórico (MAR-71; seção 11, PEN-019 parcial).
-- * A camisa muda com o jogo agendado, em andamento ou finalizado (arbitragem até o encerramento, presidente depois;
--   a API separa as permissões), inclusive após a entrada em quadra, mantendo a camisa única no clube/jogo.
-- * O estorno retira o credenciamento com o jogo agendado ou em andamento, somente sem entrada em quadra e sem
--   gols/penalidades registrados (inclusive anulados, que continuam apontando a participação). A escolha do técnico,
--   se houver, permanece; sem ela, a participação é excluída.
-- * Cada alteração exige o registro correspondente em `AlteracaoCredenciamento`, gravado antes na mesma transação.
-- Correções complexas do presidente (atleta que entrou ou tem lançamentos) seguem pendentes (PEN-019 residual).

-- CreateEnum
CREATE TYPE "TipoAlteracaoCredenciamento" AS ENUM ('correcao_camisa', 'estorno');

-- CreateTable
CREATE TABLE "AlteracaoCredenciamento" (
    "id" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "inscricaoClubeId" UUID NOT NULL,
    "vinculoClubeId" UUID NOT NULL,
    "atletaId" UUID NOT NULL,
    "carteirinhaId" UUID NOT NULL,
    "credenciadoEm" TIMESTAMPTZ NOT NULL,
    "tipo" "TipoAlteracaoCredenciamento" NOT NULL,
    "numeroCamisaAnterior" INTEGER NOT NULL,
    "numeroCamisaNova" INTEGER,
    "registradaEm" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AlteracaoCredenciamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlteracaoCredenciamento_jogoId_registradaEm_idx" ON "AlteracaoCredenciamento"("jogoId", "registradaEm");

-- CreateIndex
CREATE INDEX "AlteracaoCredenciamento_atletaId_idx" ON "AlteracaoCredenciamento"("atletaId");

-- CreateIndex
CREATE INDEX "AlteracaoCredenciamento_vinculoClubeId_idx" ON "AlteracaoCredenciamento"("vinculoClubeId");

-- CreateIndex
CREATE INDEX "AlteracaoCredenciamento_inscricaoClubeId_idx" ON "AlteracaoCredenciamento"("inscricaoClubeId");

-- CreateIndex
CREATE INDEX "AlteracaoCredenciamento_carteirinhaId_idx" ON "AlteracaoCredenciamento"("carteirinhaId");

-- AddForeignKey
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_inscricaoClubeId_fkey" FOREIGN KEY ("inscricaoClubeId") REFERENCES "InscricaoClube"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_vinculoClubeId_fkey" FOREIGN KEY ("vinculoClubeId") REFERENCES "VinculoClube"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_atletaId_fkey" FOREIGN KEY ("atletaId") REFERENCES "Atleta"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_carteirinhaId_fkey" FOREIGN KEY ("carteirinhaId") REFERENCES "Carteirinha"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Correção: nova camisa inteira não negativa e diferente da anterior. Estorno: sem nova camisa.
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_camisas_check" CHECK (
  "numeroCamisaAnterior" >= 0
  AND CASE "tipo"
    WHEN 'correcao_camisa' THEN "numeroCamisaNova" IS NOT NULL AND "numeroCamisaNova" >= 0 AND "numeroCamisaNova" <> "numeroCamisaAnterior"
    ELSE "numeroCamisaNova" IS NULL
  END
);

-- Histórico somente de inclusão, gravado na transação da alteração (registradaEm = now()) e copiando exatamente o
-- credenciamento vigente. Exclusão só na cascata da remoção do jogo.
CREATE FUNCTION validar_alteracao_credenciamento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Histórico do credenciamento não pode ser alterado' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Jogo" WHERE id = OLD."jogoId") THEN
      RAISE EXCEPTION 'Histórico do credenciamento não pode ser excluído' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."registradaEm" <> now() THEN
    RAISE EXCEPTION 'Alteração do credenciamento é registrada na própria transação' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM "Participacao"
    WHERE "jogoId" = NEW."jogoId" AND "vinculoClubeId" = NEW."vinculoClubeId" AND "inscricaoClubeId" = NEW."inscricaoClubeId"
      AND "atletaId" = NEW."atletaId" AND "carteirinhaId" = NEW."carteirinhaId" AND "credenciadoEm" = NEW."credenciadoEm"
      AND "numeroCamisa" = NEW."numeroCamisaAnterior"
  ) THEN
    RAISE EXCEPTION 'Alteração deve corresponder ao credenciamento vigente' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AlteracaoCredenciamento_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "AlteracaoCredenciamento"
  FOR EACH ROW EXECUTE FUNCTION validar_alteracao_credenciamento();

-- Estorno: jogo agendado ou em andamento, sem entrada, sem lançamentos e com o registro desta transação.
-- O FOR SHARE da participação feito pelo lançamento (MAR-68) conflita com a alteração ou exclusão da linha:
-- o estorno aguarda o lançamento em curso e o vê, ou o lançamento aguarda e encontra o credenciamento desfeito.
CREATE FUNCTION exigir_estorno_permitido(p "Participacao", situacao "StatusJogo") RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF situacao NOT IN ('agendado', 'em_andamento') THEN
    RAISE EXCEPTION 'Estorno do credenciamento exige jogo agendado ou em andamento' USING ERRCODE = '23514';
  END IF;
  IF p."entrouEmQuadraEm" IS NOT NULL THEN
    RAISE EXCEPTION 'Estorno do credenciamento exige atleta sem entrada em quadra' USING ERRCODE = '23514';
  END IF;
  IF EXISTS(SELECT 1 FROM "LancamentoJogo" WHERE "participacaoId" = p.id) THEN
    RAISE EXCEPTION 'Estorno do credenciamento exige atleta sem gols ou penalidades registrados' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM "AlteracaoCredenciamento"
    WHERE "jogoId" = p."jogoId" AND "vinculoClubeId" = p."vinculoClubeId" AND "tipo" = 'estorno'
      AND "carteirinhaId" = p."carteirinhaId" AND "credenciadoEm" = p."credenciadoEm"
      AND "numeroCamisaAnterior" = p."numeroCamisa" AND "registradaEm" = now()
  ) THEN
    RAISE EXCEPTION 'Estorno do credenciamento exige o registro no histórico' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Substitui a função da migração `credenciamento`; mudam somente a exclusão de participação credenciada e a
-- alteração de credenciamento já realizado (camisa e estorno).
CREATE OR REPLACE FUNCTION validar_participacao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusJogo";
  campeonato_id uuid;
  inscricao_a uuid;
  inscricao_b uuid;
  jogo_id uuid;
  escolha_muda boolean;
  novo_credenciamento boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."jogoId" <> OLD."jogoId" OR NEW."inscricaoClubeId" <> OLD."inscricaoClubeId"
      OR NEW."vinculoClubeId" <> OLD."vinculoClubeId" OR NEW."atletaId" <> OLD."atletaId") THEN
    RAISE EXCEPTION 'Jogo, clube, vínculo e atleta da participação não podem ser alterados' USING ERRCODE = '23514';
  END IF;
  jogo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."jogoId" ELSE NEW."jogoId" END;
  SELECT status, "campeonatoId", "inscricaoClubeAId", "inscricaoClubeBId" INTO situacao, campeonato_id, inscricao_a, inscricao_b
    FROM "Jogo" WHERE id = jogo_id FOR SHARE;
  IF NOT FOUND THEN
    -- Somente na cascata da remoção do próprio jogo.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Jogo da participação não encontrado' USING ERRCODE = '23503';
  END IF;

  escolha_muda := CASE TG_OP
    WHEN 'INSERT' THEN NEW."escolhidaEm" IS NOT NULL
    WHEN 'DELETE' THEN OLD."escolhidaEm" IS NOT NULL
    ELSE NEW."escolhidaPorTecnicoId" IS DISTINCT FROM OLD."escolhidaPorTecnicoId" OR NEW."escolhidaEm" IS DISTINCT FROM OLD."escolhidaEm"
  END;
  IF escolha_muda AND situacao <> 'agendado' THEN
    RAISE EXCEPTION 'A escalação só muda até o início do jogo' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."credenciadoEm" IS NOT NULL THEN
      PERFORM exigir_estorno_permitido(OLD, situacao);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."inscricaoClubeId" NOT IN (inscricao_a, inscricao_b) THEN
      RAISE EXCEPTION 'A inscrição da participação deve ser de um dos clubes do jogo' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS(
      SELECT 1 FROM "VinculoClube" v JOIN "InscricaoClube" i ON i."clubeId" = v."clubeId"
      WHERE v.id = NEW."vinculoClubeId" AND v."atletaId" = NEW."atletaId" AND i.id = NEW."inscricaoClubeId"
    ) THEN
      RAISE EXCEPTION 'Vínculo, atleta e clube da participação não correspondem' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."credenciadoEm" IS NOT NULL THEN
    IF NEW."credenciadoEm" IS NULL THEN
      -- O CHECK de etapas exige carteirinha e camisa vazias junto com a data.
      PERFORM exigir_estorno_permitido(OLD, situacao);
    ELSIF NEW."credenciadoEm" <> OLD."credenciadoEm" OR NEW."carteirinhaId" IS DISTINCT FROM OLD."carteirinhaId" THEN
      RAISE EXCEPTION 'Credenciamento já realizado não pode ser alterado' USING ERRCODE = '23514';
    ELSIF NEW."numeroCamisa" IS DISTINCT FROM OLD."numeroCamisa" THEN
      IF situacao NOT IN ('agendado', 'em_andamento', 'finalizado') THEN
        RAISE EXCEPTION 'Correção da camisa exige jogo agendado, em andamento ou finalizado' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS(
        SELECT 1 FROM "AlteracaoCredenciamento"
        WHERE "jogoId" = OLD."jogoId" AND "vinculoClubeId" = OLD."vinculoClubeId" AND "tipo" = 'correcao_camisa'
          AND "credenciadoEm" = OLD."credenciadoEm" AND "numeroCamisaAnterior" = OLD."numeroCamisa"
          AND "numeroCamisaNova" = NEW."numeroCamisa" AND "registradaEm" = now()
      ) THEN
        RAISE EXCEPTION 'Correção da camisa exige o registro no histórico' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."entrouEmQuadraEm" IS NOT NULL AND NEW."entrouEmQuadraEm" IS DISTINCT FROM OLD."entrouEmQuadraEm" THEN
    RAISE EXCEPTION 'Entrada em quadra já registrada não pode ser alterada' USING ERRCODE = '23514';
  END IF;

  IF NEW."escolhidaEm" IS NOT NULL AND escolha_muda THEN
    PERFORM 1 FROM "VinculoClube" WHERE id = NEW."vinculoClubeId" AND "fim" IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escolha exige vínculo atual do atleta com o clube' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "Atleta" WHERE "usuarioId" = NEW."atletaId" AND "statusVerificacao" = 'aprovado') THEN
      RAISE EXCEPTION 'Somente atleta aprovado pode ser escolhido' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Usuario" WHERE id = NEW."atletaId" AND ativo FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Atleta com conta desativada não pode ser escolhido' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Carteirinha" WHERE "atletaId" = NEW."atletaId" AND status = 'ativa' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Atleta com carteirinha invalidada não pode ser escolhido' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Tecnico" t
      JOIN "InscricaoClube" i ON i."clubeId" = t."clubeId"
      JOIN "Usuario" u ON u.id = t."usuarioId"
      WHERE t."usuarioId" = NEW."escolhidaPorTecnicoId" AND i.id = NEW."inscricaoClubeId"
        AND t."statusVerificacao" = 'aprovado' AND u.ativo
      FOR SHARE OF t;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escolha exige o técnico aprovado e ativo atribuído ao clube' USING ERRCODE = '23514';
    END IF;
  END IF;

  novo_credenciamento := NEW."credenciadoEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."credenciadoEm" IS NULL);
  IF novo_credenciamento THEN
    IF situacao NOT IN ('agendado', 'em_andamento') THEN
      RAISE EXCEPTION 'Credenciamento exige jogo agendado ou em andamento' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "VinculoClube" WHERE id = NEW."vinculoClubeId" AND "fim" IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Credenciamento exige vínculo atual: escolha anterior à transferência não basta' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "Atleta" WHERE "usuarioId" = NEW."atletaId" AND "statusVerificacao" = 'aprovado') THEN
      RAISE EXCEPTION 'Somente atleta aprovado pode ser credenciado' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Usuario" WHERE id = NEW."atletaId" AND ativo FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Atleta com conta desativada não pode ser credenciado' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Carteirinha" WHERE id = NEW."carteirinhaId" AND "atletaId" = NEW."atletaId" AND status = 'ativa' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Credenciamento exige a carteirinha ativa do próprio atleta' USING ERRCODE = '23514';
    END IF;
    IF EXISTS(
      SELECT 1 FROM "Suspensao" s
      WHERE s."atletaId" = NEW."atletaId" AND s."campeonatoId" = campeonato_id
        AND s."revogadaEm" IS NULL AND s."saldoEncerradoEm" IS NULL
        AND (SELECT count(*) FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id) < s."quantidadeJogos"
    ) THEN
      RAISE EXCEPTION 'Atleta com suspensão a cumprir no campeonato não pode ser credenciado' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."entrouEmQuadraEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."entrouEmQuadraEm" IS NULL) THEN
    IF situacao <> 'em_andamento' THEN
      RAISE EXCEPTION 'Entrada em quadra exige jogo em andamento' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Usuario" WHERE id = NEW."atletaId" AND ativo FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Atleta com conta desativada não pode entrar em quadra' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
