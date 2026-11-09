-- Credenciamento (MAR-71) passa a ignorar a suspensão automática anulada (MAR-79); demais regras inalteradas.
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
        AND s."revogadaEm" IS NULL AND s."saldoEncerradoEm" IS NULL AND s."anuladaEm" IS NULL
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
