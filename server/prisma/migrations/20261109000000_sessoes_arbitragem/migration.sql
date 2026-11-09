-- Acesso temporário da arbitragem: senha compartilhada do jogo e sessões próprias (MAR-65).

-- CreateEnum
CREATE TYPE "VisualizacaoArbitragem" AS ENUM ('linha', 'banco');

-- CreateEnum
CREATE TYPE "MetodoEntradaArbitragem" AS ENUM ('designacao', 'senha');

-- CreateEnum
CREATE TYPE "MotivoRevogacaoArbitragem" AS ENUM ('saida', 'troca_senha', 'jogo_encerrado', 'jogo_adiado', 'jogo_cancelado');

-- AlterTable
ALTER TABLE "Arbitragem" ADD COLUMN     "acessouEm" TIMESTAMPTZ,
ADD COLUMN     "visualizacao" "VisualizacaoArbitragem";

-- CreateTable
CREATE TABLE "AcessoArbitragem" (
    "jogoId" UUID NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "senhaCifrada" TEXT NOT NULL,
    "geradaEm" TIMESTAMPTZ NOT NULL,
    "revogadoEm" TIMESTAMPTZ,

    CONSTRAINT "AcessoArbitragem_pkey" PRIMARY KEY ("jogoId")
);

-- CreateTable
CREATE TABLE "SessaoArbitragem" (
    "id" UUID NOT NULL,
    "arbitragemId" UUID NOT NULL,
    "authSessionId" TEXT,
    "metodoEntrada" "MetodoEntradaArbitragem" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadaEm" TIMESTAMPTZ NOT NULL,
    "expiraEm" TIMESTAMPTZ NOT NULL,
    "revogadaEm" TIMESTAMPTZ,
    "motivoRevogacao" "MotivoRevogacaoArbitragem",

    CONSTRAINT "SessaoArbitragem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessaoArbitragem_tokenHash_key" ON "SessaoArbitragem"("tokenHash");

-- CreateIndex
CREATE INDEX "SessaoArbitragem_arbitragemId_idx" ON "SessaoArbitragem"("arbitragemId");

-- AddForeignKey
ALTER TABLE "AcessoArbitragem" ADD CONSTRAINT "AcessoArbitragem_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SessaoArbitragem" ADD CONSTRAINT "SessaoArbitragem_arbitragemId_fkey" FOREIGN KEY ("arbitragemId") REFERENCES "Arbitragem"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Entrada por designação depende da sessão de conta de origem (sem FK: a sessão do Better Auth é
-- apagada no logout/desativação, e a ausência dela nega o acesso em vez de convertê-lo em entrada por
-- senha). Revogação tem data e motivo juntos; expiração técnica posterior à criação.
ALTER TABLE "SessaoArbitragem" ADD CONSTRAINT "SessaoArbitragem_origem_check" CHECK (
  ("metodoEntrada" = 'designacao') = ("authSessionId" IS NOT NULL)
);
ALTER TABLE "SessaoArbitragem" ADD CONSTRAINT "SessaoArbitragem_revogacao_check" CHECK (
  ("revogadaEm" IS NULL) = ("motivoRevogacao" IS NULL) AND "expiraEm" > "criadaEm"
);
ALTER TABLE "SessaoArbitragem" ADD CONSTRAINT "SessaoArbitragem_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- Sessão nasce somente com o jogo agendado ou em andamento (FOR SHARE da linha `Jogo`, como as
-- designações). Por designação, somente em `Arbitragem` de conta designada; por senha, somente em registro
-- criado pela própria entrada (sem conta nem designação). Identificação e origem são imutáveis; a
-- revogação é definitiva.
CREATE FUNCTION validar_sessao_arbitragem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusJogo";
  conta UUID;
  designada TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."arbitragemId" <> OLD."arbitragemId" OR NEW."authSessionId" IS DISTINCT FROM OLD."authSessionId"
        OR NEW."metodoEntrada" <> OLD."metodoEntrada" OR NEW."tokenHash" <> OLD."tokenHash"
        OR NEW."criadaEm" <> OLD."criadaEm" OR NEW."expiraEm" <> OLD."expiraEm" THEN
      RAISE EXCEPTION 'Sessão de arbitragem não pode ser alterada' USING ERRCODE = '23514';
    END IF;
    IF OLD."revogadaEm" IS NOT NULL AND (NEW."revogadaEm" IS DISTINCT FROM OLD."revogadaEm"
        OR NEW."motivoRevogacao" IS DISTINCT FROM OLD."motivoRevogacao") THEN
      RAISE EXCEPTION 'Sessão de arbitragem revogada não volta a valer' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT j.status, a."usuarioId", a."designadoEm" INTO situacao, conta, designada
    FROM "Arbitragem" a JOIN "Jogo" j ON j.id = a."jogoId"
    WHERE a.id = NEW."arbitragemId" FOR SHARE OF j;
  IF NOT FOUND THEN RETURN NEW; END IF; -- a FK recusa
  IF situacao NOT IN ('agendado', 'em_andamento') THEN
    RAISE EXCEPTION 'Sessão de arbitragem só é aberta com o jogo agendado ou em andamento' USING ERRCODE = '23514';
  END IF;
  IF NEW."revogadaEm" IS NOT NULL THEN
    RAISE EXCEPTION 'Sessão de arbitragem nasce válida' USING ERRCODE = '23514';
  END IF;
  IF NEW."metodoEntrada" = 'designacao' AND conta IS NULL THEN
    RAISE EXCEPTION 'Entrada por designação exige conta designada' USING ERRCODE = '23514';
  END IF;
  IF NEW."metodoEntrada" = 'senha' AND (conta IS NOT NULL OR designada IS NOT NULL) THEN
    RAISE EXCEPTION 'Entrada por senha não usa designação' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SessaoArbitragem_validacao" BEFORE INSERT OR UPDATE ON "SessaoArbitragem"
  FOR EACH ROW EXECUTE FUNCTION validar_sessao_arbitragem();

-- A senha pertence ao jogo; revogação (encerramento/cancelamento) é definitiva. Hash e cópia cifrada
-- mudam juntos (troca manual ou adiamento), somente enquanto o acesso não foi revogado.
ALTER TABLE "AcessoArbitragem" ADD CONSTRAINT "AcessoArbitragem_valores_check" CHECK (
  btrim("senhaHash") <> '' AND "senhaCifrada" ~ '^v1\.'
);
CREATE FUNCTION validar_acesso_arbitragem() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."jogoId" <> OLD."jogoId" THEN
    RAISE EXCEPTION 'Acesso de arbitragem não muda de jogo' USING ERRCODE = '23514';
  END IF;
  IF OLD."revogadoEm" IS NOT NULL AND (NEW."revogadoEm" IS DISTINCT FROM OLD."revogadoEm"
      OR NEW."senhaHash" <> OLD."senhaHash" OR NEW."senhaCifrada" <> OLD."senhaCifrada") THEN
    RAISE EXCEPTION 'Acesso de arbitragem revogado não volta a valer' USING ERRCODE = '23514';
  END IF;
  IF (NEW."senhaHash" <> OLD."senhaHash") <> (NEW."senhaCifrada" <> OLD."senhaCifrada")
      OR ((NEW."senhaHash" <> OLD."senhaHash") AND NEW."geradaEm" = OLD."geradaEm") THEN
    RAISE EXCEPTION 'Senha de arbitragem muda com hash, cópia cifrada e data juntos' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AcessoArbitragem_validacao" BEFORE UPDATE ON "AcessoArbitragem"
  FOR EACH ROW EXECUTE FUNCTION validar_acesso_arbitragem();
