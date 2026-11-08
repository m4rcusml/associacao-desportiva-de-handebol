const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const corpoVazio = { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } };
const usuarioParam = { name: "usuarioId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const negado = { "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const solicitacao = "usuarioId, nomeCompleto, perfil, ativo, statusVerificacao, verificacaoSolicitadaEm, verificadoPorPresidenteId, verificadoEm, " +
  "clube (id, nome) ou null; atleta inclui carteirinha (id, codigo, status, emitidaEm, emitidaPorPresidenteId) ou null. Nunca inclui e-mail ou tokenQr";

/** Contrato das rotas de verificação, incluído em `GET /api/openapi.json`. */
export const openapiVerificacoes = {
  "/verificacoes": {
    get: { summary: "Presidente consulta solicitações de atleta e técnico, das mais antigas para as mais recentes", security, parameters: [
      { name: "status", in: "query", required: false, schema: { type: "string", enum: ["pendente", "aprovado", "rejeitado"], default: "pendente" } },
      { name: "perfil", in: "query", required: false, schema: { type: "string", enum: ["atleta", "tecnico"] } },
    ], responses: { "200": resposta(`Lista de: ${solicitacao}`), "400": resposta("Filtro inválido ou parâmetro adicional"), ...negado } },
  },
  "/verificacoes/solicitacao": {
    post: { summary: "Atleta ou técnico rejeitado solicita nova análise na mesma conta; volta a pendente", security, requestBody: corpoVazio, responses: {
      "200": resposta("statusVerificacao, verificacaoSolicitadaEm; alterado false quando já estava pendente"), "400": resposta("Corpo com campos"),
      ...negado, "409": resposta("Cadastro já aprovado"),
    } },
  },
  "/verificacoes/{usuarioId}/aprovacao": {
    post: { summary: "Presidente aprova solicitação pendente; para atleta, confirma o vínculo e emite a carteirinha na mesma transação", security, parameters: [usuarioParam], requestBody: corpoVazio, responses: {
      "200": resposta(`solicitacao (${solicitacao}); alterado false quando já estava aprovada (repetição não duplica carteirinha)`),
      "400": resposta("usuarioId inválido ou corpo com campos"), ...negado, "404": resposta("Atleta ou técnico não encontrado"),
      "409": resposta("Solicitação rejeitada sem nova solicitação, conta desativada ou decisão concorrente"),
    } },
  },
  "/verificacoes/{usuarioId}/rejeicao": {
    post: { summary: "Presidente rejeita solicitação pendente, sem motivo obrigatório", security, parameters: [usuarioParam], requestBody: corpoVazio, responses: {
      "200": resposta(`solicitacao (${solicitacao}); alterado false quando já estava rejeitada`),
      "400": resposta("usuarioId inválido ou corpo com campos"), ...negado, "404": resposta("Atleta ou técnico não encontrado"),
      "409": resposta("Cadastro já aprovado (não há retirada de aprovação) ou conta desativada"),
    } },
  },
};
