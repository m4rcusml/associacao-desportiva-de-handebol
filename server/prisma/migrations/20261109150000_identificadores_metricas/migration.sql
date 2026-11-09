-- MAR-85: métricas confirmadas na MAR-82 (requisitos, seção 15) perdem o prefixo legado temp_.
-- RENAME VALUE preserva os lançamentos existentes; CHECKs e views guardam o valor do enum (não o
-- rótulo), então acompanham a renomeação. As colunas das views são renomeadas sem recriá-las.
ALTER TYPE "TipoLancamento" RENAME VALUE 'temp_gol' TO 'gol';
ALTER TYPE "TipoLancamento" RENAME VALUE 'temp_cartaoAmarelo' TO 'cartaoAmarelo';
ALTER TYPE "TipoLancamento" RENAME VALUE 'temp_exclusaoDoisMinutos' TO 'exclusaoDoisMinutos';
ALTER TYPE "TipoLancamento" RENAME VALUE 'temp_cartaoVermelho' TO 'cartaoVermelho';

ALTER VIEW "EstatisticasDoJogo" RENAME COLUMN "temp_placarClubeA" TO "placarClubeA";
ALTER VIEW "EstatisticasDoJogo" RENAME COLUMN "temp_placarClubeB" TO "placarClubeB";

ALTER VIEW "DesempenhoDoAtleta" RENAME COLUMN "temp_gols" TO "gols";
ALTER VIEW "DesempenhoDoAtleta" RENAME COLUMN "temp_cartoesAmarelos" TO "cartoesAmarelos";
ALTER VIEW "DesempenhoDoAtleta" RENAME COLUMN "temp_exclusoesDoisMinutos" TO "exclusoesDoisMinutos";
ALTER VIEW "DesempenhoDoAtleta" RENAME COLUMN "temp_cartoesVermelhos" TO "cartoesVermelhos";
