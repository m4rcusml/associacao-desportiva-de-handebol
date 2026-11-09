-- Redução parcial e justificativa de suspensão (MAR-84; requisitos seção 14, PEN-009 resolvida na MAR-81).
-- A punição original (`quantidadeJogos`) continua imutável. `quantidadeReduzida` guarda o total atual definido pela
-- última redução, e cada decisão fica em `ReducaoSuspensao` (presidente, justificativa e data). O saldo passa a ser
-- COALESCE(quantidadeReduzida, quantidadeJogos) − cumprimentos, nunca negativo; cumprimentos não são apagados.
-- Revogação passa a exigir justificativa; revogações anteriores a esta migração ficam sem ela.

ALTER TABLE "Suspensao"
  ADD COLUMN "quantidadeReduzida" INTEGER,
  ADD COLUMN "justificativaRevogacao" TEXT;

ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_reducao_check" CHECK (
  "quantidadeReduzida" IS NULL OR ("quantidadeReduzida" >= 0 AND "quantidadeReduzida" < "quantidadeJogos"));
ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_justificativa_revogacao_check" CHECK (
  "justificativaRevogacao" IS NULL OR ("revogadaEm" IS NOT NULL AND length(btrim("justificativaRevogacao")) BETWEEN 1 AND 500));

-- Redução por decisão do presidente (justificativa obrigatória) ou herdada: automática recriada para o mesmo
-- atleta/jogo/regra após a anulação da anterior nasce com o menor total já decidido (decisão de Marcus, MAR-84),
-- apontando para a decisão original. Registros imutáveis.
CREATE TABLE "ReducaoSuspensao" (
    "id" UUID NOT NULL,
    "suspensaoId" UUID NOT NULL,
    "quantidadeAnterior" INTEGER NOT NULL,
    "novaQuantidade" INTEGER NOT NULL,
    "justificativa" TEXT,
    "reduzidaPorPresidenteId" UUID,
    "herdadaDeReducaoId" UUID,
    "reduzidaEm" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ReducaoSuspensao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReducaoSuspensao_quantidades_check" CHECK ("novaQuantidade" >= 0 AND "novaQuantidade" < "quantidadeAnterior"),
    CONSTRAINT "ReducaoSuspensao_autoria_check" CHECK (
      ("herdadaDeReducaoId" IS NULL AND "reduzidaPorPresidenteId" IS NOT NULL
        AND "justificativa" IS NOT NULL AND length(btrim("justificativa")) BETWEEN 1 AND 500)
      OR ("herdadaDeReducaoId" IS NOT NULL AND "reduzidaPorPresidenteId" IS NULL AND "justificativa" IS NULL))
);

CREATE INDEX "ReducaoSuspensao_suspensaoId_idx" ON "ReducaoSuspensao"("suspensaoId");
CREATE INDEX "ReducaoSuspensao_herdadaDeReducaoId_idx" ON "ReducaoSuspensao"("herdadaDeReducaoId");

ALTER TABLE "ReducaoSuspensao" ADD CONSTRAINT "ReducaoSuspensao_suspensaoId_fkey"
  FOREIGN KEY ("suspensaoId") REFERENCES "Suspensao"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "ReducaoSuspensao" ADD CONSTRAINT "ReducaoSuspensao_reduzidaPorPresidenteId_fkey"
  FOREIGN KEY ("reduzidaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ReducaoSuspensao" ADD CONSTRAINT "ReducaoSuspensao_herdadaDeReducaoId_fkey"
  FOREIGN KEY ("herdadaDeReducaoId") REFERENCES "ReducaoSuspensao"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Redução só de suspensão vigente (não revogada, anulada, com saldo encerrado nem cumprida), sempre para total menor
-- que o atual. A linha da suspensão é bloqueada: cumprimento concorrente aguarda ou já é visto.
CREATE FUNCTION validar_reducao_suspensao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s "Suspensao"%ROWTYPE;
  anterior "Suspensao"%ROWTYPE;
  quantidade_herdada integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Redução de suspensão não pode ser alterada' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "Suspensao" WHERE id = OLD."suspensaoId")
       AND (OLD."herdadaDeReducaoId" IS NULL OR EXISTS(SELECT 1 FROM "ReducaoSuspensao" WHERE id = OLD."herdadaDeReducaoId")) THEN
      RAISE EXCEPTION 'Redução de suspensão não pode ser excluída' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO s FROM "Suspensao" WHERE id = NEW."suspensaoId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suspensão não encontrada' USING ERRCODE = '23503';
  END IF;
  IF s."revogadaEm" IS NOT NULL OR s."saldoEncerradoEm" IS NOT NULL OR s."anuladaEm" IS NOT NULL THEN
    RAISE EXCEPTION 'Suspensão revogada, anulada ou com saldo encerrado não é reduzida' USING ERRCODE = '23514';
  END IF;
  IF NEW."quantidadeAnterior" <> COALESCE(s."quantidadeReduzida", s."quantidadeJogos") THEN
    RAISE EXCEPTION 'A redução parte do total atual da suspensão' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM "CumprimentoSuspensao" WHERE "suspensaoId" = s.id) >= NEW."quantidadeAnterior" THEN
    RAISE EXCEPTION 'Suspensão já cumprida não é reduzida' USING ERRCODE = '23514';
  END IF;
  IF NEW."reduzidaEm" < s."aplicadaEm" THEN
    RAISE EXCEPTION 'Redução não antecede a aplicação' USING ERRCODE = '23514';
  END IF;
  IF NEW."herdadaDeReducaoId" IS NOT NULL THEN
    SELECT o.* INTO anterior FROM "Suspensao" o JOIN "ReducaoSuspensao" r ON r."suspensaoId" = o.id
    WHERE r.id = NEW."herdadaDeReducaoId";
    SELECT r."novaQuantidade" INTO quantidade_herdada FROM "ReducaoSuspensao" r WHERE r.id = NEW."herdadaDeReducaoId";
    IF s.origem <> 'automatica' OR anterior.id IS NULL OR anterior.id = s.id OR anterior."anuladaEm" IS NULL
       OR anterior."atletaId" <> s."atletaId" OR anterior."jogoOrigemId" <> s."jogoOrigemId" OR anterior.regra <> s.regra
       OR NEW."novaQuantidade" <> quantidade_herdada THEN
      RAISE EXCEPTION 'Redução herdada exige automática anterior anulada do mesmo atleta, jogo e regra' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ReducaoSuspensao_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "ReducaoSuspensao"
  FOR EACH ROW EXECUTE FUNCTION validar_reducao_suspensao();

-- Regras das migrações `suspensoes` e `suspensao_automatica`, acrescidas de: suspensão nasce sem redução e sem
-- justificativa de revogação; o total reduzido só diminui, acompanhado do registro da decisão; revogar exige
-- justificativa, e a revogação (com a justificativa) continua definitiva.
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
    IF NEW."revogadaEm" IS NOT NULL OR NEW."saldoEncerradoEm" IS NOT NULL OR NEW."anuladaEm" IS NOT NULL
       OR NEW."quantidadeReduzida" IS NOT NULL OR NEW."justificativaRevogacao" IS NOT NULL THEN
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
     OR NEW."revogadaPorPresidenteId" IS DISTINCT FROM OLD."revogadaPorPresidenteId"
     OR NEW."justificativaRevogacao" IS DISTINCT FROM OLD."justificativaRevogacao") THEN
    RAISE EXCEPTION 'Revogação da suspensão é definitiva' USING ERRCODE = '23514';
  END IF;
  IF OLD."revogadaEm" IS NULL AND NEW."revogadaEm" IS NOT NULL AND NEW."justificativaRevogacao" IS NULL THEN
    RAISE EXCEPTION 'Revogação da suspensão exige justificativa' USING ERRCODE = '23514';
  END IF;
  IF NEW."quantidadeReduzida" IS DISTINCT FROM OLD."quantidadeReduzida" THEN
    IF NEW."quantidadeReduzida" IS NULL OR NEW."quantidadeReduzida" >= COALESCE(OLD."quantidadeReduzida", OLD."quantidadeJogos")
       OR OLD."revogadaEm" IS NOT NULL OR OLD."saldoEncerradoEm" IS NOT NULL OR OLD."anuladaEm" IS NOT NULL
       OR NOT EXISTS(
         SELECT 1 FROM "ReducaoSuspensao" WHERE "suspensaoId" = NEW.id AND "novaQuantidade" = NEW."quantidadeReduzida"
           AND "quantidadeAnterior" = COALESCE(OLD."quantidadeReduzida", OLD."quantidadeJogos")) THEN
      RAISE EXCEPTION 'O total da suspensão só diminui por redução registrada' USING ERRCODE = '23514';
    END IF;
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

-- Cumprimento (MAR-66/MAR-79) passa a respeitar o total reduzido.
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
  IF (SELECT count(*) FROM "CumprimentoSuspensao" WHERE "suspensaoId" = s.id) >= COALESCE(s."quantidadeReduzida", s."quantidadeJogos") THEN
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

-- Validação da participação (migração `correcao_administrativa`) com o impedimento disciplinar pelo total reduzido.
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
        AND (SELECT count(*) FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id) < COALESCE(s."quantidadeReduzida", s."quantidadeJogos")
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
