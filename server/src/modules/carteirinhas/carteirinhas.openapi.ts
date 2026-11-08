const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const json = (schema: object, required = true) => ({ required, content: { "application/json": { schema } } });
const corpoVazio = json({ type: "object", additionalProperties: false }, false);
const atletaParam = { name: "atletaId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const negado = { "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const detalhe = "id, atletaId, nomeCompleto, codigo, tokenQr (vigente), versaoQr, status (ativa ou invalidada), emitidaEm, emitidaPorPresidenteId, " +
  "historico (tipo invalidacao, reativacao ou substituicao_qr; versaoQr; presidenteId; ocorridoEm), do mais antigo ao mais recente";
const operacao = (summary: string, ok: string, conflito: string, requestBody: object = corpoVazio) => ({
  post: { summary, security, parameters: [atletaParam], requestBody, responses: {
    "200": resposta(`carteirinha (${detalhe}); ${ok}`), "400": resposta("atletaId ou corpo inválido"), ...negado,
    "404": resposta("Carteirinha não encontrada"), "409": resposta(conflito),
  } },
});

/** Contrato das rotas da carteirinha, incluído em `GET /api/openapi.json`. */
export const openapiCarteirinhas = {
  "/carteirinhas/minha": {
    get: { summary: "Atleta consulta a própria carteirinha com o QR vigente", security, responses: {
      "200": resposta("id, codigo, tokenQr, status, emitidaEm, nomeCompleto"), ...negado, "404": resposta("Carteirinha ainda não emitida"),
    } },
  },
  "/carteirinhas/leitura": {
    post: { summary: "Presidente identifica a carteirinha pelo QR; não autentica nem autoriza operações", security,
      requestBody: json({ type: "object", additionalProperties: false, required: ["tokenQr"], properties: { tokenQr: { type: "string", minLength: 1, maxLength: 256 } } }),
      responses: {
        "200": resposta("carteirinhaId, codigo, status, atleta (usuarioId, nomeCompleto); sem e-mail, foto ou clube"),
        "400": resposta("Corpo inválido"), ...negado, "404": resposta("QR não reconhecido, inclusive QR substituído"),
      } },
  },
  "/carteirinhas/atleta/{atletaId}": {
    get: { summary: "Presidente consulta carteirinha, QR vigente e histórico", security, parameters: [atletaParam], responses: {
      "200": resposta(detalhe), "400": resposta("atletaId inválido"), ...negado, "404": resposta("Carteirinha não encontrada"),
    } },
  },
  "/carteirinhas/atleta/{atletaId}/invalidacao": operacao(
    "Presidente invalida a carteirinha; não bloqueia a conta nem afeta participações já credenciadas",
    "alterado false quando já estava invalidada", "Conflito com restrições da carteirinha"),
  "/carteirinhas/atleta/{atletaId}/reativacao": operacao(
    "Presidente reativa a carteirinha invalidada", "alterado false quando já estava ativa", "Conflito com restrições da carteirinha"),
  "/carteirinhas/atleta/{atletaId}/substituicao-qr": operacao(
    "Presidente substitui o QR da mesma carteirinha; o token anterior deixa de ser reconhecido",
    "alterado false quando a versão informada já foi substituída (repetição devolve o QR vigente)",
    "versaoQr maior que a vigente",
    json({ type: "object", additionalProperties: false, required: ["versaoQr"], properties: { versaoQr: { type: "integer", minimum: 1, description: "Versão do QR que deve deixar de valer" } } })),
};
