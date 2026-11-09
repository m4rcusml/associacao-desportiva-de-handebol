-- Automáticas, credenciamento e cumprimento do mesmo atleta/campeonato se enfileiram sem UPDATE em Usuario.
-- A conta é compartilhada pela autorização de árbitros designados em outros jogos; torná-la exclusiva cria ciclos.
CREATE FUNCTION bloquear_geracao_suspensao(campeonato_id uuid, atleta_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(campeonato_id::text || ':' || atleta_id::text, 79080));
$$;

CREATE FUNCTION bloquear_insercao_automatica() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origem = 'automatica' THEN
    PERFORM 1 FROM "Campeonato" WHERE id = NEW."campeonatoId" FOR SHARE;
    PERFORM bloquear_geracao_suspensao(NEW."campeonatoId", NEW."atletaId");
  END IF;
  RETURN NEW;
END;
$$;

-- Nomes ordenados antes dos validadores existentes: o bloqueio consultivo precede a leitura de impedimentos no mesmo comando.
CREATE TRIGGER "Suspensao_automatica_gate" BEFORE INSERT ON "Suspensao"
  FOR EACH ROW EXECUTE FUNCTION bloquear_insercao_automatica();

CREATE FUNCTION bloquear_novo_credenciamento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  campeonato_id uuid;
BEGIN
  IF NEW."credenciadoEm" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."credenciadoEm" IS NULL) THEN
    SELECT "campeonatoId" INTO campeonato_id FROM "Jogo" WHERE id = NEW."jogoId" FOR SHARE;
    PERFORM bloquear_geracao_suspensao(campeonato_id, NEW."atletaId");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Participacao_automatica_gate" BEFORE INSERT OR UPDATE ON "Participacao"
  FOR EACH ROW EXECUTE FUNCTION bloquear_novo_credenciamento();
