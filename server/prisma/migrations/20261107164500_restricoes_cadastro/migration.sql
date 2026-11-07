-- Restrições não representáveis no schema Prisma.
ALTER TABLE "Atleta" ADD CONSTRAINT "Atleta_aprovacao_check" CHECK (
  "statusVerificacao" <> 'aprovado' OR ("verificadoPorPresidenteId" IS NOT NULL AND "verificadoEm" IS NOT NULL)
);
ALTER TABLE "Tecnico" ADD CONSTRAINT "Tecnico_aprovacao_check" CHECK (
  "statusVerificacao" <> 'aprovado' OR ("verificadoPorPresidenteId" IS NOT NULL AND "verificadoEm" IS NOT NULL)
);
ALTER TABLE "VinculoClube" ADD CONSTRAINT "VinculoClube_periodo_check" CHECK ("fim" IS NULL OR "fim" > "inicio");
CREATE UNIQUE INDEX "VinculoClube_aberto_key" ON "VinculoClube" ("atletaId") WHERE "fim" IS NULL;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "VinculoClube" ADD CONSTRAINT "VinculoClube_sem_sobreposicao" EXCLUDE USING gist (
  "atletaId" WITH =, tstzrange("inicio", "fim", '[)') WITH &&
);

-- Deferred: permite criar Usuario, extensão e vínculo na mesma transação.
CREATE FUNCTION validar_cadastro_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pessoa uuid;
  cadastro "Usuario"%ROWTYPE;
  atleta boolean;
  tecnico boolean;
  presidente boolean;
BEGIN
  IF TG_TABLE_NAME = 'Usuario' THEN
    pessoa := COALESCE(NEW."id", OLD."id");
  ELSIF TG_TABLE_NAME = 'VinculoClube' THEN
    pessoa := COALESCE(NEW."atletaId", OLD."atletaId");
  ELSE
    pessoa := COALESCE(NEW."usuarioId", OLD."usuarioId");
  END IF;
  SELECT * INTO cadastro FROM "Usuario" WHERE "id" = pessoa;
  IF NOT FOUND THEN RETURN NULL; END IF;
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
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Usuario_cadastro_check" AFTER INSERT OR UPDATE OR DELETE ON "Usuario"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validar_cadastro_usuario();
CREATE CONSTRAINT TRIGGER "Atleta_cadastro_check" AFTER INSERT OR UPDATE OR DELETE ON "Atleta"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validar_cadastro_usuario();
CREATE CONSTRAINT TRIGGER "Tecnico_cadastro_check" AFTER INSERT OR UPDATE OR DELETE ON "Tecnico"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validar_cadastro_usuario();
CREATE CONSTRAINT TRIGGER "Presidente_cadastro_check" AFTER INSERT OR UPDATE OR DELETE ON "Presidente"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validar_cadastro_usuario();
CREATE CONSTRAINT TRIGGER "VinculoClube_cadastro_check" AFTER INSERT OR UPDATE OR DELETE ON "VinculoClube"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validar_cadastro_usuario();
