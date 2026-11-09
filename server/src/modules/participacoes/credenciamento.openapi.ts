import { z } from "zod";
import { credenciamentoSchema, leituraQrArbitragemSchema } from "./credenciamento.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ arbitragemCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const jogo = [uuidParam("jogoId")];
const impedimentos = "nao_aprovado, sem_vinculo_com_clubes_do_jogo, conta_desativada, carteirinha_invalidada ou suspensao";
const participacao = "participacaoId, inscricaoId, atleta {id, nomeCompleto}, numeroCamisa, credenciadoEm, entrouEmQuadraEm (ou null) e escalado (escolha preliminar do técnico)";
const indisponivel = {
  "401": resposta("Sem cookie temporário, sessão revogada/expirada, designação retirada, conta designada desativada ou sessão de conta de origem encerrada"),
  "403": resposta("Fora do dia do jogo no fuso do local, jogo sem data, finalizado ou cancelado, vínculo impeditivo da arbitragem designada ou origem não autorizada"),
};

/** Contrato do credenciamento e da entrada em quadra (MAR-67), autorizados pela sessão temporária da arbitragem. */
export const openapiCredenciamento = {
  "/arbitragem/jogos/{jogoId}/atletas": {
    get: { summary: "Arbitragem consulta, por clube, os atletas aprovados com vínculo atual e os já credenciados, com escolha do técnico, credenciamento e impedimento atual", security, parameters: jogo, responses: {
      "200": resposta(`jogo {id, status} e clubes [{ inscricaoId, clube {id, nome}, atletas [{ atleta {id, nomeCompleto}, escalado, credenciamento (${participacao}) ou null, impedimento (${impedimentos}) ou null }] }]`),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/leitura-qr": {
    post: { summary: "Arbitragem lê o QR da carteirinha: identificação mínima, clube do jogo e impedimento ou credenciamento existente. Não credencia; o token vai no corpo e não concede permissão", security, parameters: jogo, requestBody: { required: true, ...json(z.toJSONSchema(leituraQrArbitragemSchema)) }, responses: {
      "200": resposta(`atleta {id, nomeCompleto}, carteirinha {codigo, status}, clube {inscricaoId, clube} ou null, credenciamento (${participacao}) ou null e impedimento (${impedimentos}) ou null`),
      "400": resposta("UUID ou corpo inválido"), ...indisponivel, "404": resposta("Jogo não encontrado ou QR não reconhecido (inclusive QR substituído)"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/credenciamentos": {
    post: { summary: "Arbitragem credencia por confirmação manual (atletaId) ou QR (tokenQr) com a camisa do jogo, antes do início ou durante a partida, escalado ou não. Mesmas regras nas duas formas: aprovado, vínculo atual com um dos clubes, conta e carteirinha ativas e sem suspensão a cumprir no campeonato. Camisa única no clube/jogo", security, parameters: jogo, requestBody: { required: true, ...json(z.toJSONSchema(credenciamentoSchema, { io: "input" })) }, responses: {
      "200": resposta(`{ participacao, alterado }; alterado é false quando o atleta já estava credenciado com a mesma camisa (QR repetido, reenvio). participacao: ${participacao}`),
      "400": resposta("UUID ou corpo inválido, camisa negativa ou não inteira, campos adicionais"), ...indisponivel,
      "404": resposta("Jogo ou atleta não encontrado, ou QR não reconhecido"),
      "409": resposta("Atleta inapto (mensagem indica o motivo), camisa em uso por outro atleta do clube, atleta já credenciado com outra camisa ou conflito concorrente"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/credenciamentos/{atletaId}/entrada": {
    post: { summary: "Arbitragem confirma uma vez que o atleta credenciado entrou em quadra, com o jogo em andamento; repetir não tem efeito. Sem corpo", security, parameters: [...jogo, uuidParam("atletaId")], responses: {
      "200": resposta(`{ participacao, alterado }; alterado é false quando a entrada já estava registrada. participacao: ${participacao}`),
      "400": resposta("UUID inválido ou corpo não vazio"), ...indisponivel, "404": resposta("Jogo ou atleta não encontrado"),
      "409": resposta("Atleta não credenciado neste jogo, jogo ainda não iniciado ou conta do atleta desativada"),
    } },
  },
};
