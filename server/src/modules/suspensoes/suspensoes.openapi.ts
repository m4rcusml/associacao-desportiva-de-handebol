import { z } from "zod";
import { novaSuspensaoSchema } from "./suspensoes.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const suspensao = "id, campeonatoId, origem (manual ou automatica), regra (desqualificacao_com_relatorio na automática, null na manual), jogoOrigemId (jogo que originou a automática, ou null), atleta {id, nomeCompleto}, quantidadeJogos, motivo, aplicadaPor {id, nomeCompleto} (null na automática), aplicadaEm, revogadaEm e revogadaPor (ou null), saldoEncerradoEm (término do saldo com o campeonato, ou null), anuladaEm (automática cuja ocorrência de origem foi corrigida ou anulada, ou null), situacao (vigente, cumprida, revogada, saldo_encerrado ou anulada), jogosCumpridos, jogosRestantes (0 fora de vigente) e cumprimentos (jogoId, registradoEm)";
const negado = { "400": resposta("UUID ou dados inválidos, ou campos adicionais"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const campeonato = [uuidParam("campeonatoId")];

/** Contrato das suspensões manuais (MAR-66) e da consulta das automáticas (MAR-79), incluído em `GET /api/openapi.json`. */
export const openapiSuspensoes = {
  "/campeonatos/{campeonatoId}/suspensoes": {
    get: { summary: "Presidente consulta as suspensões manuais e automáticas do campeonato, com saldo e jogos cumpridos; filtro opcional por atleta. A automática (1 jogo por desqualificação com relatório disciplinar/azul) é gerada no encerramento do jogo de origem, que não a cumpre", security, parameters: [
      ...campeonato, { name: "atletaId", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    ], responses: {
      "200": resposta(`Lista (mais recentes primeiro) com ${suspensao}`), ...negado, "404": resposta("Campeonato não encontrado"),
    } },
    post: { summary: "Presidente suspende atleta aprovado no campeonato planejado ou em andamento por quantidade de jogos. Suspensões simultâneas são cumpridas em paralelo; o jogo em que o atleta já estava credenciado é preservado e a suspensão vale para os próximos jogos", security, parameters: campeonato, requestBody: { required: true, ...json(z.toJSONSchema(novaSuspensaoSchema, { io: "input" })) }, responses: {
      "201": resposta(suspensao), ...negado, "404": resposta("Campeonato ou atleta não encontrados"),
      "409": resposta("Campeonato encerrado ou cancelado, atleta não aprovado ou conflito concorrente"),
    } },
  },
  "/campeonatos/{campeonatoId}/suspensoes/{suspensaoId}/revogar": {
    post: { summary: "Presidente revoga suspensão vigente, preservando a aplicação e os jogos já cumpridos. Sem redução parcial nem justificativa (PEN-009)", security, parameters: [...campeonato, uuidParam("suspensaoId")], responses: {
      "200": resposta(`{ suspensao, alterado }; alterado é false quando já estava revogada. suspensao: ${suspensao}`), ...negado,
      "404": resposta("Suspensão não encontrada neste campeonato"), "409": resposta("Suspensão já cumprida, anulada ou com saldo encerrado com o campeonato"),
    } },
  },
};
