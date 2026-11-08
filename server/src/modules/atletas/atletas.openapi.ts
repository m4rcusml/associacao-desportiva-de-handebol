import { z } from "zod";
import { transferenciaSchema } from "./transferencias.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const parameters = [{ name: "atletaId", in: "path", required: true, schema: { type: "string", format: "uuid" } }];
const historico = "atleta (id, nomeCompleto, ativo, statusVerificacao), clubeAtual ({id, nome, cidade}) e vinculos (id, clube, inicio, fim — null no vínculo atual —, definidoPorPresidenteId), do mais antigo ao atual";
const negado = { "400": resposta("UUID inválido"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };

/** Contrato dos vínculos e da transferência de atletas (MAR-63), incluído em `GET /api/openapi.json`. */
export const openapiAtletas = {
  "/atletas/{atletaId}/vinculos": {
    get: { summary: "Presidente consulta o histórico de vínculos do atleta com clubes", security, parameters, responses: {
      "200": resposta(historico), ...negado, "404": resposta("Atleta não encontrado"),
    } },
  },
  "/atletas/{atletaId}/transferencia": {
    post: { summary: "Presidente transfere atleta aprovado (conta ativa ou desativada) para outro clube: encerra o vínculo atual e abre o seguinte no mesmo instante. Bloqueado enquanto o clube atual participar de campeonato em andamento, inclusive eliminado/desistente. Vínculos anteriores e o histórico esportivo não mudam", security, parameters, requestBody: { required: true, ...json(z.toJSONSchema(transferenciaSchema, { io: "input" })) }, responses: {
      "200": resposta(`${historico}; alterado false quando a mesma transferência já havia sido aplicada`), ...negado,
      "404": resposta("Atleta ou clube de destino não encontrado"),
      "409": resposta("Atleta não aprovado, clubeAtualId diferente do clube atual, clube atual em campeonato em andamento ou conflito concorrente"),
    } },
  },
};
