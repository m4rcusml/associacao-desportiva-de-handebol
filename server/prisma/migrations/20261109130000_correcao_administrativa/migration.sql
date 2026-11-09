-- Correção administrativa de credenciamentos com ocorrências (MAR-83; requisitos, seção 13; PEN-019 resolvida na MAR-80).
-- Somente com o jogo finalizado, pelo presidente (a API confere o perfil; decisão de Marcus em 09/11/2026):
-- * Anulação da entrada em quadra registrada por engano: o horário original permanece, com quem anulou e quando.
-- * Registro administrativo da participação real de atleta aprovado com vínculo com o clube no início do jogo, mesmo
--   suspenso, com conta desativada ou carteirinha invalidada. As irregularidades ficam gravadas; a participação não se
--   torna regular nem altera resultado ou cumprimentos (o jogo já contado para a suspensão continua contando).
-- * Estorno do credenciamento sem entrada válida nem lançamentos válidos (anulados/transferidos continuam apontando a
--   participação, que é preservada sem etapas e marcada como desfeita). A cópia completa vai para o histórico.
-- A arbitragem continua com as regras da MAR-71: credenciamento normal, entrada e estorno sem entrada/lançamentos.

-- CreateEnum
CREATE TYPE "IrregularidadeParticipacao" AS ENUM ('conta_desativada', 'carteirinha_invalidada', 'suspensao');

-- AlterTable
ALTER TABLE "Participacao"
  ADD COLUMN "entradaAnuladaEm" TIMESTAMPTZ,
  ADD COLUMN "entradaAnuladaPorPresidenteId" UUID,
  ADD COLUMN "registradaPorPresidenteId" UUID,
  ADD COLUMN "irregularidades" "IrregularidadeParticipacao"[] NOT NULL DEFAULT ARRAY[]::"IrregularidadeParticipacao"[],
  ADD COLUMN "credenciamentoDesfeitoEm" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "AlteracaoCredenciamento"
  ADD COLUMN "entrouEmQuadraEm" TIMESTAMPTZ,
  ADD COLUMN "entradaAnuladaEm" TIMESTAMPTZ,
  ADD COLUMN "entradaAnuladaPorPresidenteId" UUID,
  ADD COLUMN "registradaPorPresidenteId" UUID,
  ADD COLUMN "irregularidades" "IrregularidadeParticipacao"[] NOT NULL DEFAULT ARRAY[]::"IrregularidadeParticipacao"[],
  ADD COLUMN "presidenteId" UUID;

-- CreateIndex
CREATE INDEX "Participacao_entradaAnuladaPorPresidenteId_idx" ON "Participacao"("entradaAnuladaPorPresidenteId");
CREATE INDEX "Participacao_registradaPorPresidenteId_idx" ON "Participacao"("registradaPorPresidenteId");
CREATE INDEX "AlteracaoCredenciamento_presidenteId_idx" ON "AlteracaoCredenciamento"("presidenteId");

-- AddForeignKey
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_entradaAnuladaPorPresidenteId_fkey" FOREIGN KEY ("entradaAnuladaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_registradaPorPresidenteId_fkey" FOREIGN KEY ("registradaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_entradaAnuladaPorPresidenteId_fkey" FOREIGN KEY ("entradaAnuladaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_registradaPorPresidenteId_fkey" FOREIGN KEY ("registradaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AlteracaoCredenciamento" ADD CONSTRAINT "AlteracaoCredenciamento_presidenteId_fkey" FOREIGN KEY ("presidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Etapas (MAR-64/71) mais as colunas da correção administrativa: anulação da entrada com autor e data juntos e somente
-- sobre entrada registrada; registro administrativo e irregularidades só com credenciamento; participação desfeita
-- (sem etapas, preservada por lançamentos anulados ou transferidos) somente sem credenciamento.
ALTER TABLE "Participacao" DROP CONSTRAINT "Participacao_etapas_check";
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_etapas_check" CHECK (
  ("escolhidaPorTecnicoId" IS NULL) = ("escolhidaEm" IS NULL)
  AND ("carteirinhaId" IS NULL) = ("credenciadoEm" IS NULL)
  AND ("carteirinhaId" IS NULL) = ("numeroCamisa" IS NULL)
  AND ("numeroCamisa" IS NULL OR "numeroCamisa" >= 0)
  AND ("entrouEmQuadraEm" IS NULL OR "credenciadoEm" IS NOT NULL)
  AND ("entradaAnuladaEm" IS NULL) = ("entradaAnuladaPorPresidenteId" IS NULL)
  AND ("entradaAnuladaEm" IS NULL OR "entrouEmQuadraEm" IS NOT NULL)
  AND ("registradaPorPresidenteId" IS NULL OR "credenciadoEm" IS NOT NULL)
  AND (cardinality("irregularidades") = 0 OR "registradaPorPresidenteId" IS NOT NULL)
  AND ("credenciamentoDesfeitoEm" IS NULL OR "credenciadoEm" IS NULL)
  AND ("escolhidaEm" IS NOT NULL OR "credenciadoEm" IS NOT NULL OR "credenciamentoDesfeitoEm" IS NOT NULL)
);

-- Histórico (MAR-71) copia também entrada, anulação e registro administrativo do credenciamento vigente.
CREATE OR REPLACE FUNCTION validar_alteracao_credenciamento() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND "entrouEmQuadraEm" IS NOT DISTINCT FROM NEW."entrouEmQuadraEm"
      AND "entradaAnuladaEm" IS NOT DISTINCT FROM NEW."entradaAnuladaEm"
      AND "entradaAnuladaPorPresidenteId" IS NOT DISTINCT FROM NEW."entradaAnuladaPorPresidenteId"
      AND "registradaPorPresidenteId" IS NOT DISTINCT FROM NEW."registradaPorPresidenteId"
      AND "irregularidades" = NEW."irregularidades"
  ) THEN
    RAISE EXCEPTION 'Alteração deve corresponder ao credenciamento vigente' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Estorno: pela arbitragem com o jogo agendado ou em andamento, sem entrada e sem lançamento algum (MAR-71); pelo
-- presidente com o jogo finalizado, sem entrada válida e sem lançamentos válidos, com o autor no histórico (MAR-83).
CREATE FUNCTION exigir_estorno_permitido(p "Participacao", n "Participacao", situacao "StatusJogo") RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF situacao IN ('agendado', 'em_andamento') THEN
    IF p."entrouEmQuadraEm" IS NOT NULL THEN
      RAISE EXCEPTION 'Estorno do credenciamento exige atleta sem entrada em quadra' USING ERRCODE = '23514';
    END IF;
    IF EXISTS(SELECT 1 FROM "LancamentoJogo" WHERE "participacaoId" = p.id) THEN
      RAISE EXCEPTION 'Estorno do credenciamento exige atleta sem gols ou penalidades registrados' USING ERRCODE = '23514';
    END IF;
    IF n."credenciamentoDesfeitoEm" IS NOT NULL THEN
      RAISE EXCEPTION 'Participação desfeita somente no estorno administrativo' USING ERRCODE = '23514';
    END IF;
  ELSIF situacao = 'finalizado' THEN
    IF p."entrouEmQuadraEm" IS NOT NULL AND p."entradaAnuladaEm" IS NULL THEN
      RAISE EXCEPTION 'Estorno do credenciamento exige a entrada em quadra anulada' USING ERRCODE = '23514';
    END IF;
    IF EXISTS(SELECT 1 FROM "LancamentoJogo" WHERE "participacaoId" = p.id AND "anuladoEm" IS NULL) THEN
      RAISE EXCEPTION 'Estorno do credenciamento exige atleta sem gols ou penalidades válidos' USING ERRCODE = '23514';
    END IF;
    IF n."credenciamentoDesfeitoEm" IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'Participação preservada no estorno administrativo é marcada como desfeita' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS(
      SELECT 1 FROM "AlteracaoCredenciamento"
      WHERE "jogoId" = p."jogoId" AND "vinculoClubeId" = p."vinculoClubeId" AND "tipo" = 'estorno' AND "presidenteId" IS NOT NULL
        AND "credenciadoEm" = p."credenciadoEm" AND "registradaEm" = now()
    ) THEN
      RAISE EXCEPTION 'Estorno administrativo exige o presidente no histórico' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Estorno do credenciamento exige jogo agendado, em andamento ou finalizado' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM "AlteracaoCredenciamento"
    WHERE "jogoId" = p."jogoId" AND "vinculoClubeId" = p."vinculoClubeId" AND "tipo" = 'estorno'
      AND "carteirinhaId" = p."carteirinhaId" AND "credenciadoEm" = p."credenciadoEm"
      AND "numeroCamisaAnterior" = p."numeroCamisa" AND "entrouEmQuadraEm" IS NOT DISTINCT FROM p."entrouEmQuadraEm"
      AND "entradaAnuladaEm" IS NOT DISTINCT FROM p."entradaAnuladaEm" AND "registradaEm" = now()
  ) THEN
    RAISE EXCEPTION 'Estorno do credenciamento exige o registro no histórico' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Substitui a função da migração `credenciamento_suspensao_anulada`. Mudam: estorno (acima), anulação da entrada,
-- registro administrativo com o jogo finalizado e a participação desfeita, que só é excluída na cascata do jogo.
CREATE OR REPLACE FUNCTION validar_participacao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusJogo";
  campeonato_id uuid;
  inscricao_a uuid;
  inscricao_b uuid;
  iniciado_em timestamptz;
  jogo_id uuid;
  escolha_muda boolean;
  novo_credenciamento boolean;
  estorno boolean;
  administrativo boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."jogoId" <> OLD."jogoId" OR NEW."inscricaoClubeId" <> OLD."inscricaoClubeId"
      OR NEW."vinculoClubeId" <> OLD."vinculoClubeId" OR NEW."atletaId" <> OLD."atletaId") THEN
    RAISE EXCEPTION 'Jogo, clube, vínculo e atleta da participação não podem ser alterados' USING ERRCODE = '23514';
  END IF;
  jogo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."jogoId" ELSE NEW."jogoId" END;
  SELECT status, "campeonatoId", "inscricaoClubeAId", "inscricaoClubeBId", "iniciadoEm"
    INTO situacao, campeonato_id, inscricao_a, inscricao_b, iniciado_em
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
    IF OLD."credenciamentoDesfeitoEm" IS NOT NULL THEN
      RAISE EXCEPTION 'Participação desfeita é preservada no histórico' USING ERRCODE = '23514';
    END IF;
    IF OLD."credenciadoEm" IS NOT NULL THEN
      PERFORM exigir_estorno_permitido(OLD, OLD, situacao);
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
    IF NEW."entradaAnuladaEm" IS NOT NULL OR NEW."credenciamentoDesfeitoEm" IS NOT NULL THEN
      RAISE EXCEPTION 'Participação não nasce com entrada anulada ou credenciamento desfeito' USING ERRCODE = '23514';
    END IF;
  END IF;

  estorno := TG_OP = 'UPDATE' AND OLD."credenciadoEm" IS NOT NULL AND NEW."credenciadoEm" IS NULL;
  novo_credenciamento := NEW."credenciadoEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."credenciadoEm" IS NULL);
  administrativo := novo_credenciamento AND NEW."registradaPorPresidenteId" IS NOT NULL;

  IF TG_OP = 'UPDATE' AND OLD."credenciadoEm" IS NOT NULL THEN
    IF estorno THEN
      -- O CHECK de etapas exige carteirinha, camisa, entrada e registro administrativo vazios junto com a data.
      PERFORM exigir_estorno_permitido(OLD, NEW, situacao);
    ELSIF NEW."credenciadoEm" <> OLD."credenciadoEm" OR NEW."carteirinhaId" IS DISTINCT FROM OLD."carteirinhaId"
      OR NEW."registradaPorPresidenteId" IS DISTINCT FROM OLD."registradaPorPresidenteId"
      OR NEW."irregularidades" <> OLD."irregularidades" THEN
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

  -- Participação desfeita: marcada somente no estorno administrativo; deixa de sê-lo apenas em novo registro administrativo.
  IF TG_OP = 'UPDATE' AND NEW."credenciamentoDesfeitoEm" IS DISTINCT FROM OLD."credenciamentoDesfeitoEm"
      AND NOT estorno AND NOT (administrativo AND NEW."credenciamentoDesfeitoEm" IS NULL) THEN
    RAISE EXCEPTION 'Participação desfeita somente no estorno administrativo' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."entrouEmQuadraEm" IS NOT NULL AND NEW."entrouEmQuadraEm" IS DISTINCT FROM OLD."entrouEmQuadraEm"
      AND NOT estorno THEN
    RAISE EXCEPTION 'Entrada em quadra já registrada não pode ser alterada' USING ERRCODE = '23514';
  END IF;
  -- Anulação da entrada (MAR-83): uma vez, sobre a entrada registrada, com o jogo finalizado, na própria transação.
  IF TG_OP = 'UPDATE' AND (NEW."entradaAnuladaEm", NEW."entradaAnuladaPorPresidenteId")
      IS DISTINCT FROM (OLD."entradaAnuladaEm", OLD."entradaAnuladaPorPresidenteId") AND NOT estorno THEN
    IF OLD."entradaAnuladaEm" IS NOT NULL OR OLD."entrouEmQuadraEm" IS NULL OR NEW."entradaAnuladaEm" <> now() THEN
      RAISE EXCEPTION 'Anulação da entrada em quadra é definitiva e exige entrada registrada' USING ERRCODE = '23514';
    END IF;
    IF situacao <> 'finalizado' THEN
      RAISE EXCEPTION 'Anulação da entrada em quadra exige jogo finalizado' USING ERRCODE = '23514';
    END IF;
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

  IF NEW."registradaPorPresidenteId" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."registradaPorPresidenteId" IS NULL) AND NOT novo_credenciamento THEN
    RAISE EXCEPTION 'Registro administrativo somente junto com o credenciamento' USING ERRCODE = '23514';
  END IF;

  IF administrativo THEN
    -- Participação real registrada pelo presidente (MAR-83): sem as condições de elegibilidade do credenciamento normal,
    -- que viram irregularidades gravadas pela API; exige atleta aprovado, a própria carteirinha e vínculo no início do jogo.
    IF situacao <> 'finalizado' OR iniciado_em IS NULL THEN
      RAISE EXCEPTION 'Registro administrativo da participação exige jogo iniciado e finalizado' USING ERRCODE = '23514';
    END IF;
    IF NEW."credenciadoEm" <> now() THEN
      RAISE EXCEPTION 'Registro administrativo é datado na própria transação' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "VinculoClube"
      WHERE id = NEW."vinculoClubeId" AND inicio <= iniciado_em AND ("fim" IS NULL OR "fim" > iniciado_em) FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registro administrativo exige vínculo do atleta com o clube no início do jogo' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "Atleta" WHERE "usuarioId" = NEW."atletaId" AND "statusVerificacao" = 'aprovado') THEN
      RAISE EXCEPTION 'Somente atleta aprovado tem participação registrada' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "Carteirinha" WHERE id = NEW."carteirinhaId" AND "atletaId" = NEW."atletaId" FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registro administrativo exige a carteirinha do próprio atleta' USING ERRCODE = '23514';
    END IF;
    IF NEW."entrouEmQuadraEm" IS NOT NULL AND NEW."entrouEmQuadraEm" <> NEW."credenciadoEm" THEN
      RAISE EXCEPTION 'Entrada do registro administrativo é datada com o próprio registro' USING ERRCODE = '23514';
    END IF;
  ELSIF novo_credenciamento THEN
    IF situacao NOT IN ('agendado', 'em_andamento') THEN
      RAISE EXCEPTION 'Credenciamento exige jogo agendado ou em andamento' USING ERRCODE = '23514';
    END IF;
    IF NEW."credenciamentoDesfeitoEm" IS NOT NULL THEN
      RAISE EXCEPTION 'Participação desfeita somente recebe registro administrativo' USING ERRCODE = '23514';
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
        AND s."revogadaEm" IS NULL AND s."saldoEncerradoEm" IS NULL AND s."anuladaEm" IS NULL
        AND (SELECT count(*) FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id) < s."quantidadeJogos"
    ) THEN
      RAISE EXCEPTION 'Atleta com suspensão a cumprir no campeonato não pode ser credenciado' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."entrouEmQuadraEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."entrouEmQuadraEm" IS NULL) AND NOT administrativo THEN
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

DROP FUNCTION exigir_estorno_permitido("Participacao", "StatusJogo");

-- Entrada do registro administrativo descreve o jogo já finalizado, inclusive encerrado durante uma interrupção.
CREATE OR REPLACE FUNCTION validar_entrada_sem_interrupcao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entrouEmQuadraEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."entrouEmQuadraEm" IS NULL)
      AND NEW."registradaPorPresidenteId" IS NULL THEN
    PERFORM exigir_jogo_sem_interrupcao(NEW."jogoId");
  END IF;
  RETURN NEW;
END;
$$;
