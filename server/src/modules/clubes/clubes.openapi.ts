import { z } from "zod";
import { atribuicaoSchema, edicaoClubeSchema, novoClubeSchema } from "./clubes.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const clubeDetalhado = resposta("id, nome, cidade, criadoPorPresidenteId e tecnico (id, nomeCompleto) ou null");
const negado = { "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const invalido = resposta("Dados inválidos, UUID inválido ou campos adicionais");

/** Contrato das rotas de clubes, incluído em `GET /api/openapi.json`. */
export const openapiClubes = {
  "/clubes": {
    get: { summary: "Clubes disponíveis para cadastro (público e mínimo)", responses: { "200": resposta("Lista de id, nome e cidade") } },
    post: { summary: "Presidente cria clube, inicialmente sem técnico; nome não precisa ser único", security, requestBody: { required: true, ...json(z.toJSONSchema(novoClubeSchema)) }, responses: {
      "201": clubeDetalhado, "400": invalido, ...negado,
    } },
  },
  "/clubes/{clubeId}": {
    get: { summary: "Presidente consulta o clube e seu técnico atual", security, parameters: [uuidParam("clubeId")], responses: {
      "200": clubeDetalhado, "400": invalido, ...negado, "404": resposta("Clube não encontrado"),
    } },
    patch: { summary: "Presidente edita nome e/ou cidade (cidade null remove); vínculos e histórico são preservados", security, parameters: [uuidParam("clubeId")], requestBody: { required: true, ...json(z.toJSONSchema(edicaoClubeSchema)) }, responses: {
      "200": clubeDetalhado, "400": invalido, ...negado, "404": resposta("Clube não encontrado"),
    } },
  },
  "/clubes/{clubeId}/tecnico": {
    put: { summary: "Presidente atribui técnico aprovado e ativo ao clube; para substituir, substituirTecnicoId deve ser o técnico atual", security, parameters: [uuidParam("clubeId")], requestBody: { required: true, ...json(z.toJSONSchema(atribuicaoSchema, { io: "input" })) }, responses: {
      "200": clubeDetalhado, "400": invalido, ...negado, "404": resposta("Clube ou técnico não encontrado"),
      "409": resposta("Clube ocupado sem substituirTecnicoId correspondente, técnico já atribuído a outro clube, técnico não aprovado ou inativo, ou atribuição concorrente à mesma vaga"),
    } },
  },
  "/clubes/{clubeId}/tecnico/{tecnicoId}": {
    delete: { summary: "Presidente desvincula o técnico atual; o clube fica sem técnico", security, parameters: [uuidParam("clubeId"), uuidParam("tecnicoId")], responses: {
      "200": clubeDetalhado, "400": invalido, ...negado, "404": resposta("Clube não encontrado"), "409": resposta("O técnico informado não está atribuído ao clube"),
    } },
  },
};
