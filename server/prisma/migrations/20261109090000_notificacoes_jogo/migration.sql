-- Notificações por Socket.IO após a persistência (MAR-73; RNF-003/006/007/011, PEN-030/033).
-- * `EventoJogo` é a caixa de saída: cada mudança de jogo grava o aviso na própria transação. O trigger emite
--   `pg_notify('evento_jogo')`, entregue pelo PostgreSQL somente no commit: rollback não deixa linha nem aviso.
--   O publicador envia os eventos pendentes e grava `publicadoEm`; os não publicados (queda do processo ou da
--   conexão LISTEN) são reprocessados na inicialização e na varredura periódica.
-- * `pg_notify('arbitragem_revisada')`, também só no commit, avisa revogações para retirar conexões abertas:
--   sessão temporária revogada (encerramento, adiamento, cancelamento, troca de senha, saída), designação
--   retirada e sessão de conta encerrada (logout, desativação). O conteúdo é o jogo afetado ou vazio (revisar
--   todas as conexões); nenhum dado sensível trafega na notificação. Expiração, virada do dia e mudanças de
--   vínculo ou aprovação não notificam: a varredura periódica do publicador as encontra, e todo envio revalida.

-- CreateEnum
CREATE TYPE "TipoEventoJogo" AS ENUM ('escalacao_alterada', 'credenciamento_registrado', 'credenciamento_corrigido', 'credenciamento_desfeito', 'entrada_registrada', 'jogo_iniciado', 'jogo_interrompido', 'jogo_retomado', 'jogo_encerrado', 'jogo_adiado', 'jogo_cancelado', 'resultado_corrigido', 'jogo_invalidado', 'lancamento_registrado', 'lancamento_corrigido', 'lancamento_anulado', 'visualizacao_alterada');

-- CreateTable
CREATE TABLE "EventoJogo" (
    "id" BIGSERIAL NOT NULL,
    "jogoId" UUID NOT NULL,
    "tipo" "TipoEventoJogo" NOT NULL,
    "referenciaId" UUID,
    "criadoEm" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicadoEm" TIMESTAMPTZ,

    CONSTRAINT "EventoJogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoJogo_jogoId_idx" ON "EventoJogo"("jogoId");

-- AddForeignKey
ALTER TABLE "EventoJogo" ADD CONSTRAINT "EventoJogo_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "Jogo"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Pendentes em ordem de gravação, para o publicador.
CREATE INDEX "EventoJogo_pendentes_idx" ON "EventoJogo"("id") WHERE "publicadoEm" IS NULL;

CREATE FUNCTION notificar_evento_jogo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('evento_jogo', '');
  RETURN NULL;
END $$;

CREATE TRIGGER "EventoJogo_notificar" AFTER INSERT ON "EventoJogo"
  FOR EACH STATEMENT EXECUTE FUNCTION notificar_evento_jogo();

CREATE FUNCTION notificar_revisao_arbitragem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  jogo uuid;
BEGIN
  IF TG_TABLE_NAME = 'SessaoArbitragem' THEN
    IF NEW."revogadaEm" IS NOT DISTINCT FROM OLD."revogadaEm" THEN
      RETURN NULL;
    END IF;
    SELECT "jogoId" INTO jogo FROM "Arbitragem" WHERE id = NEW."arbitragemId";
    PERFORM pg_notify('arbitragem_revisada', COALESCE(jogo::text, ''));
  ELSIF TG_TABLE_NAME = 'Arbitragem' THEN
    PERFORM pg_notify('arbitragem_revisada', OLD."jogoId"::text);
  ELSE
    -- Sessão de conta (logout, desativação): a designação de qualquer jogo pode depender dela.
    PERFORM pg_notify('arbitragem_revisada', '');
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "SessaoArbitragem_revisar" AFTER UPDATE OF "revogadaEm" ON "SessaoArbitragem"
  FOR EACH ROW EXECUTE FUNCTION notificar_revisao_arbitragem();

CREATE TRIGGER "Arbitragem_revisar" AFTER DELETE ON "Arbitragem"
  FOR EACH ROW EXECUTE FUNCTION notificar_revisao_arbitragem();

CREATE TRIGGER "AuthSession_revisar" AFTER DELETE OR UPDATE OF "expiresAt" ON "AuthSession"
  FOR EACH ROW EXECUTE FUNCTION notificar_revisao_arbitragem();
