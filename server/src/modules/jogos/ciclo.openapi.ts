import { z } from "zod";
import { adiamentoSchema, encerramentoSchema } from "./ciclo.js";
import { correcaoResultadoSchema, invalidacaoSchema } from "./resultado.js";

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
const placar = "placar { clubeA {inscricaoId, clube}, placarClubeA, clubeB {inscricaoId, clube}, placarClubeB }";
const detalhado = "jogo no formato de GET /jogos/{jogoId}";
const corpo = (schema: z.ZodType) => ({ required: true, ...json(z.toJSONSchema(schema, { io: "input" })) });
const resultadoCompleto = "{ jogo {id, status, iniciadoEm, encerradoEm, resultado, vencedor {inscricaoId, clube} ou null}, placar, invalidacao {invalidadoEm, motivo, presidente} ou null, interrupcoes [{interrompidoEm, retomadoEm}], alteracoes [{id, tipo, resultadoAnterior, inscricaoVencedorAnteriorId, resultadoNovo, inscricaoVencedorNovoId, motivo, registradaEm, presidente}] }";
const sessaoComInterrupcoes = "Resumo da sessão (jogo com interrompidoEm, arbitragem, sessao, podeGerirSenhaPelaConta), interrupcoes [{interrompidoEm, retomadoEm}] e alterado";

/**
 * Contrato do ciclo do jogo (MAR-69/MAR-72): início, interrupção, retomada e encerramento (inclusive W.O.) pela
 * arbitragem; adiamento, cancelamento, correção do resultado e invalidação pelo presidente.
 */
export const openapiCicloJogo = {
  "/arbitragem/jogos/{jogoId}/inicio": {
    post: { summary: "Arbitragem autorizada inicia formalmente o jogo agendado, no dia do jogo no fuso do local. Repetir (inclusive em paralelo) não muda o início", security: arbitragem, parameters, responses: {
      "200": resposta("Resumo da sessão (jogo, arbitragem, sessao, podeGerirSenhaPelaConta) e alterado; alterado é false se o jogo já estava em andamento"),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"), "409": resposta("Conflito concorrente com outra mudança do jogo ou do campeonato"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/encerramento": {
    post: { summary: "Um árbitro autorizado encerra definitivamente o jogo, informando resultado (normal, interrompido definitivamente, abandono ou wo) e vencedor (inscrição do clube A ou B, ou null para nenhum vencedor), separados do placar. Jogo em andamento (inclusive interrompido) encerra como normal, interrompido ou abandono; W.O. encerra o jogo agendado, sem início, no dia do jogo, com placar 0 a 0. Na mesma transação: status finalizado, cumprimento das suspensões (uma vez) e revogação da senha e de todas as sessões temporárias. O reenvio pela sessão revogada por este encerramento recebe a confirmação vigente, sem reabrir acesso", security: arbitragem, parameters, requestBody: corpo(encerramentoSchema), responses: {
      "200": resposta(`Confirmação restrita: jogo {id, status, iniciadoEm, encerradoEm, resultado, vencedor {inscricaoId, clube} ou null}, ${placar} e alterado (false no reenvio após o encerramento)`),
      "400": resposta("UUID ou dados inválidos, ou vencedor que não é inscrição do jogo"), ...indisponivel, "404": resposta("Jogo não encontrado"),
      "409": resposta("Jogo ainda não iniciado (sem W.O.), W.O. de jogo já iniciado ou conflito concorrente"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/interrupcao": {
    post: { summary: "Arbitragem autorizada interrompe temporariamente o jogo em andamento: o status continua em andamento, com os mesmos registros e acessos, e o jogo não cumpre suspensões. Novos lançamentos e entradas em quadra aguardam a retomada; correções, anulações e credenciamentos continuam. Repetir não tem efeito", security: arbitragem, parameters, responses: {
      "200": resposta(`${sessaoComInterrupcoes}; alterado é false se o jogo já estava interrompido`),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"), "409": resposta("Jogo não está em andamento ou conflito concorrente"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/retomada": {
    post: { summary: "Arbitragem autorizada retoma o mesmo jogo interrompido, com os mesmos registros, placar e participações. O acesso do jogo iniciado continua após a virada do dia até o encerramento. Repetir não tem efeito", security: arbitragem, parameters, responses: {
      "200": resposta(`${sessaoComInterrupcoes}; alterado é false se não havia interrupção aberta`),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"), "409": resposta("Jogo não está em andamento ou conflito concorrente"),
    } },
  },
  "/jogos/{jogoId}/resultado": {
    get: { summary: "Presidente consulta resultado, vencedor (null com o jogo finalizado = nenhum vencedor), placar, invalidação, interrupções e o histórico de alterações após o encerramento", security: presidente, parameters, responses: {
      "200": resposta(resultadoCompleto), "400": resposta("UUID inválido"), ...negado, "404": resposta("Jogo não encontrado"),
    } },
  },
  "/jogos/{jogoId}/correcao-resultado": {
    post: { summary: "Somente após o encerramento, o presidente corrige resultado e/ou vencedor, sem reabrir a arbitragem e sem alterar placar, estatísticas ou cumprimentos. atual é o resultado/vencedor visto por quem corrige: divergência é conflito com o resultado atualizado. W.O. vale somente para jogo sem início. A correção fica no histórico; repetir a correção já aplicada não tem efeito", security: presidente, parameters, requestBody: corpo(correcaoResultadoSchema), responses: {
      "200": resposta(`${resultadoCompleto} e alterado`),
      "400": resposta("UUID ou dados inválidos, ou vencedor que não é inscrição do jogo"), ...negado, "404": resposta("Jogo não encontrado"),
      "409": resposta("Jogo não finalizado, atual divergente do vigente (com o resultado atualizado), W.O. incompatível com o início ou conflito concorrente"),
    } },
  },
  "/jogos/{jogoId}/invalidacao": {
    post: { summary: "Somente após o encerramento, o presidente invalida o jogo, definitivamente e com motivo. Placar, estatísticas individuais, vencedor e cumprimentos de suspensão são preservados; o vencedor é corrigido à parte. Repetir não tem efeito", security: presidente, parameters, requestBody: corpo(invalidacaoSchema), responses: {
      "200": resposta(`${resultadoCompleto} e alterado (false se já estava invalidado)`),
      "400": resposta("UUID ou dados inválidos"), ...negado, "404": resposta("Jogo não encontrado"), "409": resposta("Jogo não finalizado ou conflito concorrente"),
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
