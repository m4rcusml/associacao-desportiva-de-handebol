import { z } from "zod";
import { correcaoCamisaSchema, credenciamentoSchema, estornoSchema, leituraQrArbitragemSchema, registroAdministrativoSchema } from "./credenciamento.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ arbitragemCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const jogo = [uuidParam("jogoId")];
const impedimentos = "nao_aprovado, sem_vinculo_com_clubes_do_jogo, conta_desativada, carteirinha_invalidada ou suspensao";
const participacao = "participacaoId, inscricaoId, atleta {id, nomeCompleto}, numeroCamisa, credenciadoEm, entrouEmQuadraEm (ou null), escalado (escolha preliminar do técnico), entradaAnulada {anuladaEm, presidenteId} ou null e registroAdministrativo {presidenteId, irregularidades [conta_desativada, carteirinha_invalidada, suspensao]} ou null (MAR-83)";
const alteracao = "id, tipo (correcao_camisa ou estorno), inscricaoId, atleta {id, nomeCompleto}, credenciadoEm, numeroCamisaAnterior, numeroCamisaNova (null no estorno), registradaEm, entrouEmQuadraEm, entradaAnulada, registroAdministrativo (cópias do credenciamento alterado) e presidenteId (autor; null quando foi a arbitragem)";
const presidente = { security: [{ sessionCookie: [] }] };
const semPresidente = { "401": resposta("Sem sessão"), "403": resposta("Conta não é presidente ativo") };
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
      "409": resposta("Atleta não credenciado neste jogo (inclusive estorno concorrente), jogo ainda não iniciado ou conta do atleta desativada"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/credenciamentos/{atletaId}/camisa": {
    post: { summary: "Arbitragem corrige a camisa do atleta credenciado até o encerramento, inclusive após a entrada em quadra, mantendo a camisa única no clube/jogo e o histórico. numeroCamisaAtual é a camisa que quem corrige viu", security, parameters: [...jogo, uuidParam("atletaId")], requestBody: { required: true, ...json(z.toJSONSchema(correcaoCamisaSchema)) }, responses: {
      "200": resposta(`{ participacao, alteracao, alterado }; alterado é false (sem alteracao) quando o atleta já está com a camisa pedida. participacao: ${participacao}. alteracao: ${alteracao}`),
      "400": resposta("UUID ou corpo inválido, camisas iguais, negativas ou não inteiras, campos adicionais"), ...indisponivel, "404": resposta("Jogo não encontrado"),
      "409": resposta(`Atleta não credenciado neste jogo, camisa em uso por outro atleta do clube ou credenciamento alterado por outra operação (corpo com a participacao atual)`),
    } },
  },
  "/arbitragem/jogos/{jogoId}/credenciamentos/{atletaId}/estorno": {
    post: { summary: "Arbitragem desfaz o credenciamento antes do encerramento, somente sem entrada em quadra e sem gols/penalidades registrados (inclusive anulados). Preserva o histórico e a escolha do técnico; o atleta pode ser credenciado de novo. numeroCamisa confirma o credenciamento a desfazer", security, parameters: [...jogo, uuidParam("atletaId")], requestBody: { required: true, ...json(z.toJSONSchema(estornoSchema)) }, responses: {
      "200": resposta(`{ estorno, alterado }; alterado é false quando o mesmo estorno já foi feito (reenvio). estorno: ${alteracao}`),
      "400": resposta("UUID ou corpo inválido, camisa negativa ou não inteira, campos adicionais"), ...indisponivel, "404": resposta("Jogo não encontrado"),
      "409": resposta("Atleta não credenciado neste jogo, já entrou em quadra ou tem lançamentos (correção pelo presidente após o encerramento, MAR-83), ou credenciamento alterado por outra operação (corpo com a participacao atual)"),
    } },
  },
  "/jogos/{jogoId}/credenciamentos": {
    get: { summary: "Presidente consulta os credenciamentos do jogo em qualquer status: participações credenciadas (com entrada anulada e registro administrativo), participações desfeitas e o histórico de alterações (MAR-83)", ...presidente, parameters: jogo, responses: {
      "200": resposta(`jogo {id, status}, participacoes [${participacao}], desfeitas [{participacaoId, inscricaoId, atleta, desfeitoEm}] e alteracoes [${alteracao}] em ordem de registro`),
      "400": resposta("UUID inválido"), ...semPresidente, "404": resposta("Jogo não encontrado"),
    } },
  },
  "/jogos/{jogoId}/credenciamentos/administrativos": {
    post: { summary: "Presidente registra, após o encerramento, a participação real de atleta aprovado, com carteirinha e vínculo com um dos clubes no início do jogo, mesmo suspenso, com conta desativada ou carteirinha invalidada. As irregularidades ficam gravadas, sem regularizar a participação nem alterar resultado ou cumprimentos. Gols e penalidades são atribuídos depois, corrigindo cada lançamento. Não amplia o credenciamento pela arbitragem (MAR-83)", ...presidente, parameters: jogo, requestBody: { required: true, ...json(z.toJSONSchema(registroAdministrativoSchema, { io: "input" })) }, responses: {
      "200": resposta(`{ participacao, alterado }; alterado é false no reenvio com os mesmos dados. participacao: ${participacao}`),
      "400": resposta("UUID ou corpo inválido, camisa negativa ou não inteira, campos adicionais"), ...semPresidente, "404": resposta("Jogo ou atleta não encontrado"),
      "409": resposta("Jogo não finalizado ou sem início (W.O.), atleta já credenciado, sem vínculo com um dos clubes no início do jogo, não aprovado ou sem carteirinha, ou camisa em uso"),
    } },
  },
  "/jogos/{jogoId}/credenciamentos/{atletaId}/entrada/anulacao": {
    post: { summary: "Presidente anula, após o encerramento, a entrada em quadra registrada por engano, preservando o horário original com autor e data; a entrada anulada deixa de contar no histórico. Lançamentos são corrigidos separadamente. Sem corpo (MAR-83)", ...presidente, parameters: [...jogo, uuidParam("atletaId")], responses: {
      "200": resposta(`{ participacao, alterado }; alterado é false quando a entrada já estava anulada. participacao: ${participacao}`),
      "400": resposta("UUID inválido ou corpo não vazio"), ...semPresidente, "404": resposta("Jogo não encontrado"),
      "409": resposta("Jogo não finalizado, atleta não credenciado ou sem entrada registrada"),
    } },
  },
  "/jogos/{jogoId}/credenciamentos/{atletaId}/estorno": {
    post: { summary: "Presidente desfaz, após o encerramento, o credenciamento de quem não participou, sem entrada válida nem gols/penalidades válidos (anulados ou transferidos não impedem). O histórico guarda a cópia completa e o autor; a participação é preservada como desfeita, sem apagar lançamentos originais (MAR-83). numeroCamisa confirma o credenciamento a desfazer", ...presidente, parameters: [...jogo, uuidParam("atletaId")], requestBody: { required: true, ...json(z.toJSONSchema(estornoSchema)) }, responses: {
      "200": resposta(`{ estorno, alterado }; alterado é false quando o mesmo estorno já foi feito. estorno: ${alteracao}`),
      "400": resposta("UUID ou corpo inválido"), ...semPresidente, "404": resposta("Jogo não encontrado"),
      "409": resposta("Jogo não finalizado, atleta não credenciado, entrada válida, lançamentos válidos ou credenciamento alterado por outra operação (corpo com a participacao atual)"),
    } },
  },
  "/jogos/{jogoId}/credenciamentos/{atletaId}/camisa": {
    post: { summary: "Presidente corrige a camisa somente após o encerramento do jogo, sem reabrir a arbitragem, mantendo a camisa única no clube/jogo e o histórico", security: [{ sessionCookie: [] }], parameters: [...jogo, uuidParam("atletaId")], requestBody: { required: true, ...json(z.toJSONSchema(correcaoCamisaSchema)) }, responses: {
      "200": resposta(`{ participacao, alteracao, alterado }, como na correção pela arbitragem`),
      "400": resposta("UUID ou corpo inválido"), "401": resposta("Sem sessão"), "403": resposta("Conta não é presidente ativo"), "404": resposta("Jogo não encontrado"),
      "409": resposta("Jogo não finalizado, atleta não credenciado, camisa em uso ou credenciamento alterado por outra operação"),
    } },
  },
};
