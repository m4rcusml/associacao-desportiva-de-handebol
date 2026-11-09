import { z } from "zod";
import { lancamentoSchema } from "./lancamentos.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ arbitragemCookie: [] }];
const parameters = [{ name: "jogoId", in: "path", required: true, schema: { type: "string", format: "uuid" } }];
const lancamento = "id, operacaoId, tipo, valor (1), registradoEm, participacaoId, inscricaoId, atleta {id, nomeCompleto} e numeroCamisa";
const placar = "placar { clubeA {inscricaoId, clube}, temp_placarClubeA, clubeB {inscricaoId, clube}, temp_placarClubeB } ou null antes do início";
const indisponivel = {
  "401": resposta("Sem cookie temporário, sessão revogada/expirada, designação retirada, conta designada desativada ou sessão de conta de origem encerrada"),
  "403": resposta("Fora do dia do jogo no fuso do local, jogo sem data, finalizado ou cancelado, vínculo impeditivo da arbitragem designada ou origem não autorizada"),
};

/** Contrato dos lançamentos de gols e penalidades (MAR-68), autorizados pela sessão temporária da arbitragem. */
export const openapiLancamentos = {
  "/arbitragem/jogos/{jogoId}/lancamentos": {
    get: { summary: "Arbitragem consulta placar, desempenho por atleta credenciado e lançamentos do jogo; placar e desempenho são projeções dos lançamentos", security, parameters, responses: {
      "200": resposta(`jogo {id, status}, ${placar}, desempenho [{ participacaoId, inscricaoId, atleta, numeroCamisa, temp_gols, temp_cartoesAmarelos, temp_exclusoesDoisMinutos, temp_cartoesVermelhos }] e lancamentos [${lancamento}] em ordem de registro`),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"),
    } },
    post: { summary: "Arbitragem registra gol ou penalidade (tipos temp_) do atleta credenciado, com o jogo em andamento. O clube vem da participação e cada ocorrência vale 1. operacaoId, gerado pelo cliente, torna o reenvio seguro", security, parameters, requestBody: { required: true, ...json(z.toJSONSchema(lancamentoSchema, { io: "input" })) }, responses: {
      "200": resposta(`{ lancamento, alterado, placar }; alterado é false no reenvio da mesma operação. lancamento: ${lancamento}; ${placar}`),
      "400": resposta("UUID ou corpo inválido, tipo desconhecido, campos adicionais (inclusive valor ou clube)"), ...indisponivel,
      "404": resposta("Jogo não encontrado ou participação de outro jogo/inexistente"),
      "409": resposta("Jogo não está em andamento, atleta não credenciado, operacaoId já usado com outro conteúdo ou conflito concorrente"),
    } },
  },
};
