-- Ciclo do jogo (MAR-69; RF-029/030/035, RN-031, RN-039/040). A aplicação inicia e encerra pela arbitragem e adia
-- ou cancela pelo presidente, com os bloqueios descritos em `ciclo.ts`; o banco repete as transições permitidas.
-- Jogo nasce agendado. agendado → em_andamento (início), finalizado (reservado ao W.O. sem início, MAR-72) ou
-- cancelado; em_andamento → finalizado (encerramento). Finalizado e cancelado não voltam nem mudam horários ou
-- agenda. `iniciadoEm` não muda depois de gravado. Data e fuso só mudam com o jogo agendado (adiamento).
CREATE FUNCTION validar_ciclo_jogo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'agendado' THEN
      RAISE EXCEPTION 'Jogo é criado agendado' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('finalizado', 'cancelado')
     AND (NEW.status, NEW."iniciadoEm", NEW."encerradoEm", NEW."inicioPrevistoEm", NEW."fusoHorario")
         IS DISTINCT FROM (OLD.status, OLD."iniciadoEm", OLD."encerradoEm", OLD."inicioPrevistoEm", OLD."fusoHorario") THEN
    RAISE EXCEPTION 'Jogo finalizado ou cancelado não muda status, horários ou agenda' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status
     AND NOT ((OLD.status = 'agendado' AND NEW.status IN ('em_andamento', 'finalizado', 'cancelado'))
              OR (OLD.status = 'em_andamento' AND NEW.status = 'finalizado')) THEN
    RAISE EXCEPTION 'Transição de jogo inválida' USING ERRCODE = '23514';
  END IF;
  IF OLD."iniciadoEm" IS NOT NULL AND NEW."iniciadoEm" IS DISTINCT FROM OLD."iniciadoEm" THEN
    RAISE EXCEPTION 'Início do jogo não pode ser alterado' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'agendado'
     AND (NEW."inicioPrevistoEm", NEW."fusoHorario") IS DISTINCT FROM (OLD."inicioPrevistoEm", OLD."fusoHorario") THEN
    RAISE EXCEPTION 'Data e fuso do jogo só mudam com o jogo agendado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Jogo_ciclo_validacao" BEFORE INSERT OR UPDATE ON "Jogo"
  FOR EACH ROW EXECUTE FUNCTION validar_ciclo_jogo();
