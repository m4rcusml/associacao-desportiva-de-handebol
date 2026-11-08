import { z } from "zod";
import { inscricaoSchema, novoCampeonatoSchema } from "./campeonatos.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const detalhado = resposta("id, nome, edicao, categoria, inicio e fim (AAAA-MM-DD ou null), status (planejado, em_andamento, encerrado ou cancelado), criadoPorPresidenteId, inscricoes (id, clube {id, nome, cidade}, incluidaPorPresidenteId, incluidaEm) e jogos (contagem por status)");
const transicao = resposta("{ campeonato, alterado }; alterado é false quando a transição já estava aplicada (repetição ou pedido simultâneo), sem repetir efeitos");
const negado = { "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const invalido = resposta("Dados inválidos, UUID inválido ou campos adicionais");
const naoEncontrado = resposta("Campeonato não encontrado");
const campeonato = [uuidParam("campeonatoId")];

/** Contrato das rotas de campeonatos (MAR-61), incluído em `GET /api/openapi.json`. */
export const openapiCampeonatos = {
  "/campeonatos": {
    get: { summary: "Presidente lista campeonatos (id, nome, edicao, categoria, inicio, fim, status e quantidade de inscrições)", security, responses: {
      "200": resposta("Lista de campeonatos"), ...negado,
    } },
    post: { summary: "Presidente cria campeonato planejado com uma categoria textual; datas opcionais e informativas", security, requestBody: { required: true, ...json(z.toJSONSchema(novoCampeonatoSchema)) }, responses: {
      "201": detalhado, "400": invalido, ...negado,
    } },
  },
  "/campeonatos/{campeonatoId}": {
    get: { summary: "Presidente consulta o campeonato, suas inscrições e a contagem de jogos por status", security, parameters: campeonato, responses: {
      "200": detalhado, "400": invalido, ...negado, "404": naoEncontrado,
    } },
  },
  "/campeonatos/{campeonatoId}/inscricoes": {
    post: { summary: "Presidente inscreve clube no campeonato planejado; uma inscrição por clube e campeonato", security, parameters: campeonato, requestBody: { required: true, ...json(z.toJSONSchema(inscricaoSchema, { io: "input" })) }, responses: {
      "201": detalhado, "400": invalido, ...negado, "404": resposta("Campeonato ou clube não encontrado"),
      "409": resposta("Clube já inscrito ou campeonato fora do status planejado"),
    } },
  },
  "/campeonatos/{campeonatoId}/inscricoes/{inscricaoId}": {
    delete: { summary: "Presidente retira inscrição sem jogos com o campeonato planejado", security, parameters: [...campeonato, uuidParam("inscricaoId")], responses: {
      "200": detalhado, "400": invalido, ...negado, "404": resposta("Campeonato ou inscrição não encontrados"),
      "409": resposta("Inscrição com jogos ou campeonato fora do status planejado"),
    } },
  },
  "/campeonatos/{campeonatoId}/iniciar": {
    post: { summary: "Presidente inicia o campeonato planejado com ao menos dois clubes inscritos", security, parameters: campeonato, responses: {
      "200": transicao, "400": invalido, ...negado, "404": naoEncontrado, "409": resposta("Menos de dois clubes inscritos ou campeonato encerrado/cancelado"),
    } },
  },
  "/campeonatos/{campeonatoId}/encerrar": {
    post: { summary: "Presidente encerra o campeonato em andamento quando todos os jogos estão finalizados ou cancelados", security, parameters: campeonato, responses: {
      "200": transicao, "400": invalido, ...negado, "404": naoEncontrado, "409": resposta("Jogo agendado ou em andamento, ou campeonato planejado/cancelado"),
    } },
  },
  "/campeonatos/{campeonatoId}/cancelar": {
    post: { summary: "Presidente cancela o campeonato planejado ou em andamento sem jogo em andamento; jogos agendados são cancelados na mesma transação", security, parameters: campeonato, responses: {
      "200": transicao, "400": invalido, ...negado, "404": naoEncontrado, "409": resposta("Jogo em andamento ou campeonato encerrado"),
    } },
  },
};
