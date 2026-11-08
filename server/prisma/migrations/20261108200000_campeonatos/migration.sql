-- Campeonatos, inscrições de clubes e persistência mínima de jogos (MAR-61): ciclo manual do
-- campeonato pelo presidente, inscrição única por clube e jogos entre inscrições do próprio campeonato.

-- CreateEnum
CREATE TYPE "StatusCampeonato" AS ENUM ('planejado', 'em_andamento', 'encerrado', 'cancelado');

-- CreateEnum
CREATE TYPE "StatusJogo" AS ENUM ('agendado', 'em_andamento', 'finalizado', 'cancelado');

-- CreateTable
CREATE TABLE "Campeonato" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "edicao" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "inicio" DATE,
    "fim" DATE,
    "status" "StatusCampeonato" NOT NULL DEFAULT 'planejado',
    "criadoPorPresidenteId" UUID NOT NULL,

    CONSTRAINT "Campeonato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InscricaoClube" (
    "id" UUID NOT NULL,
    "campeonatoId" UUID NOT NULL,
    "clubeId" UUID NOT NULL,
    "incluidaPorPresidenteId" UUID NOT NULL,
    "incluidaEm" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InscricaoClube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jogo" (
    "id" UUID NOT NULL,
    "campeonatoId" UUID NOT NULL,
    "inscricaoClubeAId" UUID NOT NULL,
    "inscricaoClubeBId" UUID NOT NULL,
    "fusoHorario" TEXT NOT NULL,
    "local" TEXT,
    "inicioPrevistoEm" TIMESTAMPTZ,
    "iniciadoEm" TIMESTAMPTZ,
    "encerradoEm" TIMESTAMPTZ,
    "status" "StatusJogo" NOT NULL DEFAULT 'agendado',
    "criadoPorPresidenteId" UUID NOT NULL,

    CONSTRAINT "Jogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InscricaoClube_clubeId_idx" ON "InscricaoClube"("clubeId");

-- CreateIndex
CREATE UNIQUE INDEX "InscricaoClube_campeonatoId_clubeId_key" ON "InscricaoClube"("campeonatoId", "clubeId");

-- CreateIndex
CREATE UNIQUE INDEX "InscricaoClube_id_campeonatoId_key" ON "InscricaoClube"("id", "campeonatoId");

-- CreateIndex
CREATE INDEX "Jogo_campeonatoId_status_idx" ON "Jogo"("campeonatoId", "status");

-- CreateIndex
CREATE INDEX "Jogo_inscricaoClubeAId_campeonatoId_idx" ON "Jogo"("inscricaoClubeAId", "campeonatoId");

-- CreateIndex
CREATE INDEX "Jogo_inscricaoClubeBId_campeonatoId_idx" ON "Jogo"("inscricaoClubeBId", "campeonatoId");

-- AddForeignKey
ALTER TABLE "Campeonato" ADD CONSTRAINT "Campeonato_criadoPorPresidenteId_fkey" FOREIGN KEY ("criadoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoClube" ADD CONSTRAINT "InscricaoClube_campeonatoId_fkey" FOREIGN KEY ("campeonatoId") REFERENCES "Campeonato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoClube" ADD CONSTRAINT "InscricaoClube_clubeId_fkey" FOREIGN KEY ("clubeId") REFERENCES "Clube"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscricaoClube" ADD CONSTRAINT "InscricaoClube_incluidaPorPresidenteId_fkey" FOREIGN KEY ("incluidaPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_campeonatoId_fkey" FOREIGN KEY ("campeonatoId") REFERENCES "Campeonato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_inscricaoClubeAId_campeonatoId_fkey" FOREIGN KEY ("inscricaoClubeAId", "campeonatoId") REFERENCES "InscricaoClube"("id", "campeonatoId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_inscricaoClubeBId_campeonatoId_fkey" FOREIGN KEY ("inscricaoClubeBId", "campeonatoId") REFERENCES "InscricaoClube"("id", "campeonatoId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_criadoPorPresidenteId_fkey" FOREIGN KEY ("criadoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Campos mínimos não vazios; datas informativas, com fim não anterior ao início.
ALTER TABLE "Campeonato" ADD CONSTRAINT "Campeonato_campos_check" CHECK (
  btrim("nome") <> '' AND btrim("edicao") <> '' AND btrim("categoria") <> ''
);
ALTER TABLE "Campeonato" ADD CONSTRAINT "Campeonato_periodo_check" CHECK ("inicio" IS NULL OR "fim" IS NULL OR "fim" >= "inicio");

-- RN-022: clubes A e B distintos (as FKs compostas já exigem inscrições do próprio campeonato).
-- Horários coerentes com o status: iniciar e encerrar preenchem os respectivos horários.
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_inscricoes_distintas_check" CHECK ("inscricaoClubeAId" <> "inscricaoClubeBId");
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_fusoHorario_check" CHECK (btrim("fusoHorario") <> '');
ALTER TABLE "Jogo" ADD CONSTRAINT "Jogo_horarios_check" CHECK (
  ("encerradoEm" IS NULL OR "iniciadoEm" IS NULL OR "encerradoEm" >= "iniciadoEm")
  AND CASE "status"
    WHEN 'agendado' THEN "iniciadoEm" IS NULL AND "encerradoEm" IS NULL
    WHEN 'em_andamento' THEN "iniciadoEm" IS NOT NULL AND "encerradoEm" IS NULL
    WHEN 'finalizado' THEN "encerradoEm" IS NOT NULL
    ELSE "encerradoEm" IS NULL
  END
);

-- Ciclo do campeonato. Nasce planejado; transições: planejado → em_andamento (dois clubes inscritos),
-- em_andamento → encerrado (nenhum jogo agendado ou em andamento) e planejado/em_andamento → cancelado
-- (a aplicação cancela os agendados antes; nenhum jogo em andamento). Encerrado e cancelado não mudam.
-- Inscrições e jogos bloqueiam a linha do campeonato (FOR SHARE) em seus triggers, então esta
-- verificação, feita com a linha já bloqueada pelo UPDATE, enxerga as alterações concorrentes confirmadas.
CREATE FUNCTION validar_campeonato() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'planejado' THEN
      RAISE EXCEPTION 'Campeonato é criado planejado' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW."criadoPorPresidenteId" <> OLD."criadoPorPresidenteId" THEN
    RAISE EXCEPTION 'Identificação e autoria do campeonato não podem ser alteradas' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('encerrado', 'cancelado') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Campeonato encerrado ou cancelado não pode ser alterado' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'planejado' AND NEW.status IN ('em_andamento', 'cancelado'))
          OR (OLD.status = 'em_andamento' AND NEW.status IN ('encerrado', 'cancelado'))) THEN
    RAISE EXCEPTION 'Transição de campeonato inválida' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'em_andamento'
     AND (SELECT count(*) FROM "InscricaoClube" WHERE "campeonatoId" = NEW.id) < 2 THEN
    RAISE EXCEPTION 'Iniciar o campeonato exige ao menos dois clubes inscritos' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('encerrado', 'cancelado') AND EXISTS(
    SELECT 1 FROM "Jogo" WHERE "campeonatoId" = NEW.id AND status IN ('agendado', 'em_andamento')
  ) THEN
    RAISE EXCEPTION 'Campeonato com jogos agendados ou em andamento não pode terminar' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Campeonato_validacao" BEFORE INSERT OR UPDATE ON "Campeonato"
  FOR EACH ROW EXECUTE FUNCTION validar_campeonato();

-- Inscrições são imutáveis e só entram ou saem com o campeonato planejado. A remoção junto do próprio
-- campeonato (cascata) é permitida; a FK de `Jogo` impede retirar inscrição com jogos.
CREATE FUNCTION validar_inscricao_clube() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusCampeonato";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Inscrição de clube não pode ser alterada' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO situacao FROM "Campeonato"
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW."campeonatoId" ELSE OLD."campeonatoId" END FOR SHARE;
  IF FOUND AND situacao <> 'planejado' THEN
    RAISE EXCEPTION 'Inscrições só mudam com o campeonato planejado' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "InscricaoClube_validacao" BEFORE INSERT OR UPDATE OR DELETE ON "InscricaoClube"
  FOR EACH ROW EXECUTE FUNCTION validar_inscricao_clube();

-- Jogo não muda de campeonato, e campeonato encerrado ou cancelado não recebe jogo agendado ou em andamento.
CREATE FUNCTION validar_jogo_campeonato() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  situacao "StatusCampeonato";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."campeonatoId" <> OLD."campeonatoId" THEN
    RAISE EXCEPTION 'Jogo não pode mudar de campeonato' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('agendado', 'em_andamento') THEN
    SELECT status INTO situacao FROM "Campeonato" WHERE id = NEW."campeonatoId" FOR SHARE;
    IF situacao IN ('encerrado', 'cancelado') THEN
      RAISE EXCEPTION 'Campeonato encerrado ou cancelado não recebe jogos ativos' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Jogo_campeonato_validacao" BEFORE INSERT OR UPDATE ON "Jogo"
  FOR EACH ROW EXECUTE FUNCTION validar_jogo_campeonato();
