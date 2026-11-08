import { z } from "zod";
import { edicaoContaSchema } from "./conta-propria.controller.js";

const resposta = (description: string) => ({ description });

/** Contrato da edição da própria conta, incluído em `GET /api/openapi.json`. */
export const openapiContaPropria = {
  "/conta": {
    patch: {
      summary: "A própria conta altera o nome, sem nova aprovação; nome de domínio e identidade mudam na mesma transação",
      security: [{ sessionCookie: [] }],
      requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(edicaoContaSchema) } } },
      responses: {
        "200": resposta("usuario: id, nomeCompleto; alterado false quando o nome já era o informado"),
        "400": resposta("Nome inválido ou campos adicionais (perfil, clube, aprovação, ativo, e-mail, senha etc.)"),
        "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Origem não autorizada"),
      },
    },
  },
};
