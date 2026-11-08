-- Agendamento de jogos com fuso IANA do local e designação da arbitragem (MAR-62).

-- CreateTable
CREATE TABLE "Arbitragem" (
    "id" UUID NOT NULL,
    "jogoId" UUID NOT NULL,
    "usuarioId" UUID,
    "nomeCompleto" TEXT,
    "designadoPorPresidenteId" UUID,
    "designadoEm" TIMESTAMPTZ,

    CONSTRAINT "Arbitragem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Arbitragem_jogoId_idx" ON "Arbitragem"("jogoId");

-- CreateIndex
CREATE UNIQUE INDEX "Arbitragem_jogoId_usuarioId_key" ON "Arbitragem"("jogoId", "usuarioId");

-- AddForeignKey (a aplicação não exclui jogos; a cascata só serve à remoção do próprio jogo)
ALTER TABLE "Arbitragem" ADD CONSTRAINT "Arbitragem_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Arbitragem" ADD CONSTRAINT "Arbitragem_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Arbitragem" ADD CONSTRAINT "Arbitragem_designadoPorPresidenteId_fkey" FOREIGN KEY ("designadoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cadastrado: nome vem de `Usuario` (sem cópia divergente). Externo: somente `nomeCompleto`, sem
-- verificação de vínculo (RN-026). Designação tem responsável e data juntos; conta cadastrada só entra
-- por designação. Registros sem designação ficam para a entrada por senha (MAR-65).
ALTER TABLE "Arbitragem" ADD CONSTRAINT "Arbitragem_identificacao_check" CHECK (
  ("usuarioId" IS NULL) <> ("nomeCompleto" IS NULL)
  AND ("nomeCompleto" IS NULL OR btrim("nomeCompleto") <> '')
);
ALTER TABLE "Arbitragem" ADD CONSTRAINT "Arbitragem_designacao_check" CHECK (
  ("designadoPorPresidenteId" IS NULL) = ("designadoEm" IS NULL)
  AND ("usuarioId" IS NULL OR "designadoPorPresidenteId" IS NOT NULL)
);

-- Fuso do local é um nome IANA conhecido pelo banco; não aceita offsets ou abreviações POSIX soltas.
-- Equipes do jogo e autoria não mudam depois do agendamento.
CREATE FUNCTION validar_jogo_agenda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."inscricaoClubeAId" <> OLD."inscricaoClubeAId"
      OR NEW."inscricaoClubeBId" <> OLD."inscricaoClubeBId"
      OR NEW."criadoPorPresidenteId" <> OLD."criadoPorPresidenteId") THEN
    RAISE EXCEPTION 'Clubes e autoria do jogo não podem ser alterados' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW."fusoHorario" <> OLD."fusoHorario")
     AND (NEW."fusoHorario" !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
          OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name = NEW."fusoHorario")) THEN
    RAISE EXCEPTION 'Fuso horário IANA desconhecido' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Jogo_agenda_validacao" BEFORE INSERT OR UPDATE ON "Jogo"
  FOR EACH ROW EXECUTE FUNCTION validar_jogo_agenda();

-- Designações entram ou saem somente com o jogo agendado ou em andamento (bloqueio FOR SHARE da linha
-- `Jogo`, serializando com mudanças de status). Conta designada é de atleta ou técnico (RF-024); aprovação,
-- conta ativa e impedimento de clube (RN-025) são conferidos pela aplicação com a linha `Usuario`
-- bloqueada e revalidados no acesso (MAR-65). Identificação e designação são imutáveis.
CREATE FUNCTION validar_arbitragem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusJogo";
  perfil_designado "Perfil";
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."jogoId" <> OLD."jogoId"
      OR NEW."usuarioId" IS DISTINCT FROM OLD."usuarioId"
      OR NEW."nomeCompleto" IS DISTINCT FROM OLD."nomeCompleto"
      OR NEW."designadoPorPresidenteId" IS DISTINCT FROM OLD."designadoPorPresidenteId"
      OR NEW."designadoEm" IS DISTINCT FROM OLD."designadoEm") THEN
    RAISE EXCEPTION 'Designação de arbitragem não pode ser alterada' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  SELECT status INTO situacao FROM "Jogo"
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW."jogoId" ELSE OLD."jogoId" END FOR SHARE;
  -- NOT FOUND só ocorre na cascata da remoção do próprio jogo.
  IF FOUND AND situacao NOT IN ('agendado', 'em_andamento') THEN
    RAISE EXCEPTION 'Arbitragem só muda com o jogo agendado ou em andamento' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."usuarioId" IS NOT NULL THEN
    SELECT perfil INTO perfil_designado FROM "Usuario" WHERE id = NEW."usuarioId";
    IF perfil_designado NOT IN ('atleta', 'tecnico') THEN
      RAISE EXCEPTION 'Somente atleta ou técnico é designado pelo cadastro' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Arbitragem_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "Arbitragem"
  FOR EACH ROW EXECUTE FUNCTION validar_arbitragem();
