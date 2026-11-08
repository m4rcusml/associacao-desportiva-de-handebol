-- Transferência de atletas entre clubes (MAR-63; RF-011/012, RN-003/005 a 009). Encerrar o vínculo
-- aberto e abrir o seguinte ocorrem na mesma transação, no mesmo instante: o índice parcial e o trigger
-- diferido existentes garantem um único vínculo aberto, a exclusão GiST impede sobreposição e as regras
-- abaixo impedem lacuna, reescrita do histórico e transferência com campeonato em andamento.

-- Vínculo existente: atleta, clube e início não mudam (registros anteriores continuam apontando para o
-- vínculo original); `definidoPorPresidenteId` só é preenchido uma vez (aprovação do vínculo inicial);
-- vínculo encerrado não muda. Encerrar exige atleta aprovado e nenhum campeonato em andamento com o
-- clube do vínculo inscrito (RN-006, inclusive clube eliminado/desistente: PEN-017). Os campeonatos
-- ativos do clube são bloqueados com FOR SHARE: o início concorrente (FOR UPDATE) aguarda o commit da
-- transferência ou, se já confirmado, é visto pela consulta seguinte.
CREATE FUNCTION validar_alteracao_vinculo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."atletaId" <> OLD."atletaId" OR NEW."clubeId" <> OLD."clubeId" OR NEW."inicio" <> OLD."inicio" THEN
    RAISE EXCEPTION 'Atleta, clube e início do vínculo não podem ser alterados' USING ERRCODE = '23514';
  END IF;
  IF OLD."fim" IS NOT NULL THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Vínculo encerrado não pode ser alterado' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."definidoPorPresidenteId" IS NOT NULL AND NEW."definidoPorPresidenteId" IS DISTINCT FROM OLD."definidoPorPresidenteId" THEN
    RAISE EXCEPTION 'Presidente que definiu o vínculo não pode ser alterado' USING ERRCODE = '23514';
  END IF;
  IF NEW."fim" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "Atleta" WHERE "usuarioId" = OLD."atletaId" AND "statusVerificacao" = 'aprovado') THEN
    RAISE EXCEPTION 'Somente atleta aprovado pode ser transferido' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "Campeonato" c
    WHERE c.status IN ('planejado', 'em_andamento')
      AND EXISTS(SELECT 1 FROM "InscricaoClube" i WHERE i."campeonatoId" = c.id AND i."clubeId" = OLD."clubeId")
    ORDER BY c.id
    FOR SHARE OF c;
  IF EXISTS(
    SELECT 1 FROM "Campeonato" c JOIN "InscricaoClube" i ON i."campeonatoId" = c.id
    WHERE i."clubeId" = OLD."clubeId" AND c.status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Clube atual participa de campeonato em andamento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "VinculoClube_alteracao" BEFORE UPDATE ON "VinculoClube"
  FOR EACH ROW EXECUTE FUNCTION validar_alteracao_vinculo();

-- Vínculo seguinte (transferência): começa exatamente no fim do último vínculo encerrado, sem lacuna,
-- em outro clube e definido por presidente. O primeiro vínculo (cadastro inicial, RN-007) não é transferência.
CREATE FUNCTION validar_novo_vinculo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  anterior "VinculoClube"%ROWTYPE;
BEGIN
  SELECT * INTO anterior FROM "VinculoClube"
    WHERE "atletaId" = NEW."atletaId" AND "fim" IS NOT NULL
    ORDER BY "fim" DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW."definidoPorPresidenteId" IS NULL THEN
    RAISE EXCEPTION 'Vínculo de transferência exige o presidente responsável' USING ERRCODE = '23514';
  END IF;
  IF NEW."inicio" <> anterior."fim" THEN
    RAISE EXCEPTION 'Novo vínculo deve começar no fim do vínculo anterior' USING ERRCODE = '23514';
  END IF;
  IF NEW."clubeId" = anterior."clubeId" THEN
    RAISE EXCEPTION 'Transferência exige clube diferente do anterior' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "VinculoClube_novo" BEFORE INSERT ON "VinculoClube"
  FOR EACH ROW EXECUTE FUNCTION validar_novo_vinculo();
