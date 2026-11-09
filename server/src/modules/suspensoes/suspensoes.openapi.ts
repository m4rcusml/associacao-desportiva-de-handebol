import { z } from "zod";
import { novaSuspensaoSchema, reducaoSuspensaoSchema, revogacaoSuspensaoSchema } from "./suspensoes.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const suspensao = "id, campeonatoId, origem (manual ou automatica), regra (desqualificacao_com_relatorio na automática, null na manual), jogoOrigemId (jogo que originou a automática, ou null), atleta {id, nomeCompleto}, quantidadeJogos (punição original), quantidadeAtual (total vigente após reduções; igual à original sem redução), motivo, aplicadaPor {id, nomeCompleto} (null na automática), aplicadaEm, revogadaEm, revogadaPor e justificativaRevogacao (ou null; revogações anteriores à MAR-84 não têm justificativa), saldoEncerradoEm (término do saldo com o campeonato, ou null), anuladaEm (automática cuja ocorrência de origem foi corrigida ou anulada, ou null), situacao (vigente, cumprida, revogada, saldo_encerrado ou anulada), jogosCumpridos, jogosRestantes (quantidadeAtual − jogosCumpridos, nunca negativo; 0 fora de vigente), cumprimentos (jogoId, registradoEm) e reducoes (id, quantidadeAnterior, novaQuantidade, justificativa, reduzidaPor {id, nomeCompleto}, reduzidaEm, herdadaDeReducaoId; a herdada pela automática recriada não tem presidente nem justificativa)";
const negado = { "400": resposta("UUID ou dados inválidos, ou campos adicionais"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const campeonato = [uuidParam("campeonatoId")];
const decisao = [...campeonato, uuidParam("suspensaoId")];

/** Contrato das suspensões manuais (MAR-66), da consulta das automáticas (MAR-79) e das reduções (MAR-84), em `GET /api/openapi.json`. */
export const openapiSuspensoes = {
  "/campeonatos/{campeonatoId}/suspensoes": {
    get: { summary: "Presidente consulta as suspensões manuais e automáticas do campeonato, com saldo, jogos cumpridos e reduções; filtro opcional por atleta. A automática (1 jogo por desqualificação com relatório disciplinar/azul) é gerada no encerramento do jogo de origem, que não a cumpre", security, parameters: [
      ...campeonato, { name: "atletaId", in: "query", required: false, schema: { type: "string", format: "uuid" } },
    ], responses: {
      "200": resposta(`Lista (mais recentes primeiro) com ${suspensao}`), ...negado, "404": resposta("Campeonato não encontrado"),
    } },
    post: { summary: "Presidente suspende atleta aprovado no campeonato planejado ou em andamento por quantidade de jogos. Suspensões simultâneas são cumpridas em paralelo; o jogo em que o atleta já estava credenciado é preservado e a suspensão vale para os próximos jogos", security, parameters: campeonato, requestBody: { required: true, ...json(z.toJSONSchema(novaSuspensaoSchema, { io: "input" })) }, responses: {
      "201": resposta(suspensao), ...negado, "404": resposta("Campeonato ou atleta não encontrados"),
      "409": resposta("Campeonato encerrado ou cancelado, atleta não aprovado ou conflito concorrente"),
    } },
  },
  "/campeonatos/{campeonatoId}/suspensoes/{suspensaoId}/reduzir": {
    post: { summary: "Presidente reduz suspensão manual ou automática vigente para um novo total (0 até o total atual − 1), com justificativa. Preserva a punição original, as reduções anteriores e os cumprimentos; o saldo é o novo total menos os jogos cumpridos, nunca negativo, sem compensar ausências. O recálculo automático posterior não aumenta o total reduzido", security, parameters: decisao, requestBody: { required: true, ...json(z.toJSONSchema(reducaoSuspensaoSchema, { io: "input" })) }, responses: {
      "200": resposta(`{ suspensao, alterado }; alterado é false quando o total atual já foi definido por redução (inclusive herdada) com o valor informado; sem redução, informar o total original responde 409, como qualquer total igual ou maior que o atual. suspensao: ${suspensao}`), ...negado,
      "404": resposta("Suspensão não encontrada neste campeonato"),
      "409": resposta("Novo total não menor que o atual, ou suspensão cumprida, revogada, anulada ou com saldo encerrado com o campeonato"),
    } },
  },
  "/campeonatos/{campeonatoId}/suspensoes/{suspensaoId}/revogar": {
    post: { summary: "Presidente revoga suspensão vigente com justificativa, preservando a aplicação, as reduções e os jogos já cumpridos. Revogada não é reativada por recálculo automático", security, parameters: decisao, requestBody: { required: true, ...json(z.toJSONSchema(revogacaoSuspensaoSchema, { io: "input" })) }, responses: {
      "200": resposta(`{ suspensao, alterado }; alterado é false quando já estava revogada (a justificativa original é mantida). suspensao: ${suspensao}`), ...negado,
      "404": resposta("Suspensão não encontrada neste campeonato"), "409": resposta("Suspensão já cumprida, anulada ou com saldo encerrado com o campeonato"),
    } },
  },
};
