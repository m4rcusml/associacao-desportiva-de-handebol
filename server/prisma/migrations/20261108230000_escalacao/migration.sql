-- Participações e escalação preliminar pelo técnico (MAR-64; RF-016, RN-014/019/020, PEN-018).
-- `Participacao` reúne escolha, credenciamento e entrada em quadra; esta tarefa grava apenas a escolha.
-- As restrições de credenciamento/camisa/entrada já ficam no banco para a MAR-67.

-- CreateEnum
CREATE TYPE "TipoAlteracaoEscalacao" AS ENUM ('inclusao', 'remocao');

-- CreateTable
CREATE TABLE "Participacao" (
    "id" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "inscricaoClubeId" UUID NOT NULL,
    "vinculoClubeId" UUID NOT NULL,
    "atletaId" UUID NOT NULL,
    "escolhidaPorTecnicoId" UUID,
    "escolhidaEm" TIMESTAMPTZ,
    "carteirinhaId" UUID,
    "credenciadoEm" TIMESTAMPTZ,
    "numeroCamisa" INTEGER,
    "entrouEmQuadraEm" TIMESTAMPTZ,

    CONSTRAINT "Participacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlteracaoEscalacao" (
    "id" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "vinculoClubeId" UUID NOT NULL,
    "tipo" "TipoAlteracaoEscalacao" NOT NULL,
    "tecnicoId" UUID NOT NULL,
    "ocorridoEm" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AlteracaoEscalacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Participacao_vinculoClubeId_idx" ON "Participacao"("vinculoClubeId");

-- CreateIndex
CREATE INDEX "Participacao_atletaId_idx" ON "Participacao"("atletaId");

-- CreateIndex
CREATE UNIQUE INDEX "Participacao_jogoId_vinculoClubeId_key" ON "Participacao"("jogoId", "vinculoClubeId");

-- CreateIndex
CREATE UNIQUE INDEX "Participacao_jogoId_inscricaoClubeId_numeroCamisa_key" ON "Participacao"("jogoId", "inscricaoClubeId", "numeroCamisa");

-- CreateIndex
CREATE INDEX "AlteracaoEscalacao_jogoId_ocorridoEm_idx" ON "AlteracaoEscalacao"("jogoId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "AlteracaoEscalacao_vinculoClubeId_idx" ON "AlteracaoEscalacao"("vinculoClubeId");

-- AddForeignKey
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_inscricaoClubeId_fkey" FOREIGN KEY ("inscricaoClubeId") REFERENCES "InscricaoClube"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_vinculoClubeId_fkey" FOREIGN KEY ("vinculoClubeId") REFERENCES "VinculoClube"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_atletaId_fkey" FOREIGN KEY ("atletaId") REFERENCES "Atleta"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_escolhidaPorTecnicoId_fkey" FOREIGN KEY ("escolhidaPorTecnicoId") REFERENCES "Tecnico"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_carteirinhaId_fkey" FOREIGN KEY ("carteirinhaId") REFERENCES "Carteirinha"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoEscalacao" ADD CONSTRAINT "AlteracaoEscalacao_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoEscalacao" ADD CONSTRAINT "AlteracaoEscalacao_vinculoClubeId_fkey" FOREIGN KEY ("vinculoClubeId") REFERENCES "VinculoClube"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AlteracaoEscalacao" ADD CONSTRAINT "AlteracaoEscalacao_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "Tecnico"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Etapas separadas: escolha tem autor e data juntos; credenciamento preenche carteirinha, data e camisa
-- juntos (camisa inteira não negativa); entrada em quadra exige credenciamento. Registro sem escolha
-- nem credenciamento não existe: retirar a única etapa remove a participação.
ALTER TABLE "Participacao" ADD CONSTRAINT "Participacao_etapas_check" CHECK (
  ("escolhidaPorTecnicoId" IS NULL) = ("escolhidaEm" IS NULL)
  AND ("carteirinhaId" IS NULL) = ("credenciadoEm" IS NULL)
  AND ("carteirinhaId" IS NULL) = ("numeroCamisa" IS NULL)
  AND ("numeroCamisa" IS NULL OR "numeroCamisa" >= 0)
  AND ("entrouEmQuadraEm" IS NULL OR "credenciadoEm" IS NOT NULL)
  AND ("escolhidaEm" IS NOT NULL OR "credenciadoEm" IS NOT NULL)
);

-- Um único credenciamento por atleta e jogo, mesmo com escolhas por vínculos diferentes (transferência).
-- A camisa única no clube/jogo (RN-019) é o índice único jogo + inscrição + camisa acima (nulos distintos).
CREATE UNIQUE INDEX "Participacao_credenciamento_atleta_key" ON "Participacao"("jogoId", "atletaId") WHERE "credenciadoEm" IS NOT NULL;

-- Jogo, inscrição, vínculo e atleta não mudam. Na inclusão, a inscrição é de um dos clubes do jogo e do
-- mesmo clube do vínculo, e o atleta é o do vínculo. A escolha só entra, muda ou sai com o jogo agendado
-- (bloqueio FOR SHARE da linha `Jogo`: o início concorrente aguarda ou já é visto). Nova escolha exige
-- vínculo aberto (FOR SHARE: transferência concorrente aguarda ou é vista), atleta aprovado com conta e
-- carteirinha ativas (FOR SHARE: desativação e invalidação concorrentes aguardam ou são vistas) e técnico
-- aprovado, ativo e atribuído ao clube da inscrição. Novo credenciamento também exige vínculo aberto e a
-- carteirinha do próprio atleta: a escolha anterior a uma transferência não basta para credenciar.
-- Participação credenciada não é excluída (correções do credenciamento: MAR-71).
CREATE FUNCTION validar_participacao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusJogo";
  inscricao_a uuid;
  inscricao_b uuid;
  jogo_id uuid;
  escolha_muda boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."jogoId" <> OLD."jogoId" OR NEW."inscricaoClubeId" <> OLD."inscricaoClubeId"
      OR NEW."vinculoClubeId" <> OLD."vinculoClubeId" OR NEW."atletaId" <> OLD."atletaId") THEN
    RAISE EXCEPTION 'Jogo, clube, vínculo e atleta da participação não podem ser alterados' USING ERRCODE = '23514';
  END IF;
  jogo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."jogoId" ELSE NEW."jogoId" END;
  SELECT status, "inscricaoClubeAId", "inscricaoClubeBId" INTO situacao, inscricao_a, inscricao_b
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
      RAISE EXCEPTION 'Participação credenciada não pode ser excluída' USING ERRCODE = '23514';
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

  IF NEW."credenciadoEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."credenciadoEm" IS NULL) THEN
    PERFORM 1 FROM "VinculoClube" WHERE id = NEW."vinculoClubeId" AND "fim" IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Credenciamento exige vínculo atual: escolha anterior à transferência não basta' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."carteirinhaId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."carteirinhaId" IS DISTINCT FROM OLD."carteirinhaId")
     AND NOT EXISTS(SELECT 1 FROM "Carteirinha" WHERE id = NEW."carteirinhaId" AND "atletaId" = NEW."atletaId") THEN
    RAISE EXCEPTION 'A carteirinha deve ser do atleta da participação' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Participacao_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "Participacao"
  FOR EACH ROW EXECUTE FUNCTION validar_participacao();

-- Histórico somente de inclusão. Cada alteração é feita com o jogo agendado pelo técnico aprovado atual
-- do clube do vínculo, que deve ser um dos clubes do jogo. Exclusão só na cascata da remoção do jogo.
CREATE FUNCTION validar_alteracao_escalacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Histórico da escalação não pode ser alterado' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Jogo" WHERE id = OLD."jogoId") THEN
      RAISE EXCEPTION 'Histórico da escalação não pode ser excluído' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM "Jogo" j
      JOIN "InscricaoClube" i ON i.id IN (j."inscricaoClubeAId", j."inscricaoClubeBId")
      JOIN "VinculoClube" v ON v."clubeId" = i."clubeId"
      JOIN "Tecnico" t ON t."clubeId" = i."clubeId"
    WHERE j.id = NEW."jogoId" AND j.status = 'agendado' AND v.id = NEW."vinculoClubeId"
      AND t."usuarioId" = NEW."tecnicoId" AND t."statusVerificacao" = 'aprovado'
  ) THEN
    RAISE EXCEPTION 'Alteração da escalação exige jogo agendado e o técnico aprovado do clube do atleta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AlteracaoEscalacao_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "AlteracaoEscalacao"
  FOR EACH ROW EXECUTE FUNCTION validar_alteracao_escalacao();
