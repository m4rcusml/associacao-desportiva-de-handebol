-- Em UPDATE, validar tanto o cadastro de origem quanto o de destino.
CREATE OR REPLACE FUNCTION validar_cadastro_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pessoas uuid[];
  pessoa uuid;
  cadastro "Usuario"%ROWTYPE;
  atleta boolean;
  tecnico boolean;
  presidente boolean;
BEGIN
  IF TG_TABLE_NAME = 'Usuario' THEN
    pessoas := ARRAY[NEW."id", OLD."id"];
  ELSIF TG_TABLE_NAME = 'VinculoClube' THEN
    pessoas := ARRAY[NEW."atletaId", OLD."atletaId"];
  ELSE
    pessoas := ARRAY[NEW."usuarioId", OLD."usuarioId"];
  END IF;
  FOREACH pessoa IN ARRAY pessoas LOOP
    IF pessoa IS NULL THEN CONTINUE; END IF;
    SELECT * INTO cadastro FROM "Usuario" WHERE "id" = pessoa;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT EXISTS(SELECT 1 FROM "Atleta" WHERE "usuarioId" = pessoa),
           EXISTS(SELECT 1 FROM "Tecnico" WHERE "usuarioId" = pessoa),
           EXISTS(SELECT 1 FROM "Presidente" WHERE "usuarioId" = pessoa)
      INTO atleta, tecnico, presidente;
    IF (atleta::int + tecnico::int + presidente::int) <> 1 OR
       (cadastro."perfil" = 'atleta') <> atleta OR
       (cadastro."perfil" = 'tecnico') <> tecnico OR
       (cadastro."perfil" = 'presidente') <> presidente THEN
      RAISE EXCEPTION 'Usuario exige exatamente a extensão correspondente ao perfil' USING ERRCODE = '23514';
    END IF;
    IF atleta AND (SELECT count(*) FROM "VinculoClube" WHERE "atletaId" = pessoa AND "fim" IS NULL) <> 1 THEN
      RAISE EXCEPTION 'Atleta exige exatamente um vínculo aberto' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
