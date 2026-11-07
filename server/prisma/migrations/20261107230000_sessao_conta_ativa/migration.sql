-- MAR-60: a sessão só é gravada para conta ativa na mesma versão de ativação lida no login.
-- O hook do Better Auth lê `ativo`/`versaoAtivacao` sem lock e a inserção ocorre depois; sem esta
-- conferência, um login concorrente gravaria sessão após a desativação (e a revogação) ou, havendo
-- reativação no intervalo, sessão válida sem novo login.
ALTER TABLE "Usuario" ADD COLUMN "versaoAtivacao" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuthSession" ADD COLUMN "versaoAtivacao" INTEGER;

-- FOR SHARE serializa com a desativação/reativação, que bloqueia a linha com FOR UPDATE:
-- se a alteração vem antes, a inserção aguarda o commit e relê a versão nova (e é recusada);
-- se a inserção vem antes, a alteração aguarda o commit dela e a revogação apaga a sessão.
CREATE FUNCTION exigir_sessao_conta_ativa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  conta record;
BEGIN
  SELECT "ativo", "versaoAtivacao" INTO conta FROM "Usuario" WHERE "authId" = NEW."userId" FOR SHARE;
  IF NOT FOUND OR NOT conta."ativo" OR NEW."versaoAtivacao" IS DISTINCT FROM conta."versaoAtivacao" THEN
    RAISE EXCEPTION 'Sessão recusada: conta inativa ou ativação alterada durante o login' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AuthSession_conta_ativa"
  BEFORE INSERT OR UPDATE OF "userId", "versaoAtivacao" ON "AuthSession"
  FOR EACH ROW EXECUTE FUNCTION exigir_sessao_conta_ativa();
