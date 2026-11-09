import { z } from "zod";
import { adiamentoSchema } from "./ciclo.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const parameters = [{ name: "jogoId", in: "path", required: true, schema: { type: "string", format: "uuid" } }];
const arbitragem = [{ arbitragemCookie: [] }];
const presidente = [{ sessionCookie: [] }];
const indisponivel = {
  "401": resposta("Sem cookie temporário, sessão revogada/expirada, designação retirada, conta designada desativada ou sessão de conta de origem encerrada"),
  "403": resposta("Fora do dia do jogo no fuso do local, jogo sem data, finalizado ou cancelado, vínculo impeditivo da arbitragem designada ou origem não autorizada"),
};
const negado = { "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const placar = "placar { clubeA {inscricaoId, clube}, temp_placarClubeA, clubeB {inscricaoId, clube}, temp_placarClubeB }";
const detalhado = "jogo no formato de GET /jogos/{jogoId}";

/** Contrato do ciclo do jogo (MAR-69): início/encerramento pela arbitragem, adiamento/cancelamento pelo presidente. */
export const openapiCicloJogo = {
  "/arbitragem/jogos/{jogoId}/inicio": {
    post: { summary: "Arbitragem autorizada inicia formalmente o jogo agendado, no dia do jogo no fuso do local. Repetir (inclusive em paralelo) não muda o início", security: arbitragem, parameters, responses: {
      "200": resposta("Resumo da sessão (jogo, arbitragem, sessao, podeGerirSenhaPelaConta) e alterado; alterado é false se o jogo já estava em andamento"),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"), "409": resposta("Conflito concorrente com outra mudança do jogo ou do campeonato"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/encerramento": {
    post: { summary: "Um árbitro autorizado encerra o jogo em andamento. Na mesma transação: status finalizado, cumprimento das suspensões e revogação da senha e de todas as sessões temporárias. O reenvio pela sessão revogada por este encerramento recebe a mesma confirmação, sem reabrir acesso", security: arbitragem, parameters, responses: {
      "200": resposta(`Confirmação restrita: jogo {id, status, iniciadoEm, encerradoEm}, ${placar} e alterado (false no reenvio após o encerramento)`),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"), "409": resposta("Jogo ainda não iniciado ou conflito concorrente"),
    } },
  },
  "/jogos/{jogoId}/adiamento": {
    post: { summary: "Presidente adia o jogo agendado: nova hora local do início (null deixa sem data) e, opcionalmente, novo fuso IANA e local. Gera nova senha (se já emitida) e revoga as sessões temporárias de ambos os métodos; escalação e credenciamentos são preservados", security: presidente, parameters, requestBody: { required: true, ...json(z.toJSONSchema(adiamentoSchema, { io: "input" })) }, responses: {
      "200": resposta(`{ jogo, senhaRenovada, sessoesRevogadas }; ${detalhado}. A nova senha é consultada em GET /jogos/{jogoId}/arbitragem/senha`),
      "400": resposta("Dados inválidos, fuso desconhecido, hora local inexistente/ambígua ou data já passada no fuso do local"), ...negado,
      "404": resposta("Jogo não encontrado"), "409": resposta("Jogo em andamento, finalizado ou cancelado, ou conflito concorrente"),
    } },
  },
  "/jogos/{jogoId}/cancelamento": {
    post: { summary: "Presidente cancela o jogo agendado: revoga a senha e todas as sessões temporárias; o jogo não conta para suspensões. Repetir não tem efeito", security: presidente, parameters, responses: {
      "200": resposta(`{ jogo, alterado }; ${detalhado}; alterado é false se já estava cancelado`),
      "400": resposta("UUID inválido"), ...negado, "404": resposta("Jogo não encontrado"), "409": resposta("Jogo em andamento ou finalizado, ou conflito concorrente"),
    } },
  },
};
