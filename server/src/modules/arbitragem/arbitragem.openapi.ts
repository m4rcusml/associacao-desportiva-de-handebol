import { z } from "zod";
import { entradaDesignacaoSchema, entradaSenhaSchema, visualizacaoSchema } from "./acesso.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const conta = [{ sessionCookie: [] }];
const temporaria = [{ arbitragemCookie: [] }];
const jogo = [{ name: "jogoId", in: "path", required: true, schema: { type: "string", format: "uuid" } }];
const sessao = resposta("jogo (id, status, local, fusoHorario, inicioPrevistoEm/Local, iniciadoEm, clubeA/clubeB), arbitragem (id, nomeCompleto, visualizacao), sessao (metodoEntrada, expiraEm) e podeGerirSenhaPelaConta");
const indisponivel = { "401": resposta("Sem cookie, sessão revogada/expirada, designação retirada, conta desativada ou sessão de conta de origem encerrada"), "403": resposta("Fora do dia do jogo no fuso do local (antes, ou depois sem início), jogo sem data, finalizado ou cancelado, ou vínculo impeditivo") };
const senha = resposta("jogoId, senha (texto, somente nesta resposta; sem cache) e geradaEm");
const gestor = { "401": resposta("Sessão de conta ou cadastro indisponível"), "403": resposta("Nem presidente nem conta designada apta (aprovada, ativa, sem vínculo com os clubes do jogo); origem não autorizada"), "404": resposta("Jogo não encontrado"), "409": resposta("Jogo finalizado ou cancelado") };

/**
 * Contrato do acesso temporário da arbitragem (MAR-65). O cookie `handebol.arbitragem.<jogoId>` (com prefixo
 * `__Host-` em produção) é separado do cookie da conta e vale somente para o jogo.
 */
export const securitySchemeArbitragem = { type: "apiKey", in: "cookie", name: "handebol.arbitragem.{jogoId}", description: "Cookie temporário por jogo; prefixo __Host- em produção" };
export const openapiArbitragem = {
  "/arbitragem/jogos/{jogoId}/entrada/designacao": {
    post: { summary: "Conta autenticada, designada, ativa, aprovada e sem vínculo com os clubes do jogo entra sem senha no dia do jogo (fuso do local) ou com o jogo em andamento; emite o cookie temporário. Vários dispositivos permitidos", security: conta, parameters: jogo, requestBody: { required: false, ...json(z.toJSONSchema(entradaDesignacaoSchema)) }, responses: {
      "201": sessao, "400": resposta("Dados inválidos"), "401": resposta("Sessão de conta ou cadastro indisponível"), "403": resposta("Presidente, sem designação, não aprovado, vínculo impeditivo, fora do dia ou jogo encerrado; origem não autorizada"), "404": resposta("Jogo não encontrado"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/entrada/senha": {
    post: { summary: "Entrada pela senha compartilhada do jogo com nome completo, sem conta e sem conferência de vínculo (RN-025); maiúsculas, espaços e hífens são ignorados na senha. Emite o cookie temporário", parameters: jogo, requestBody: { required: true, ...json(z.toJSONSchema(entradaSenhaSchema)) }, responses: {
      "201": sessao, "400": resposta("Dados inválidos"), "401": resposta("Nome ou senha inválidos para este jogo (inclusive senha ainda não emitida ou trocada)"), "403": resposta("Fora do dia do jogo, jogo sem data, finalizado ou cancelado; origem não autorizada"), "404": resposta("Jogo não encontrado"), "429": resposta("Limite de 10 tentativas por IP a cada 10 minutos"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/sessao": {
    get: { summary: "Revalida e descreve a sessão temporária deste jogo", security: temporaria, parameters: jogo, responses: { "200": sessao, ...indisponivel, "404": resposta("Jogo não encontrado") } },
  },
  "/arbitragem/jogos/{jogoId}/visualizacao": {
    put: { summary: "Escolhe a tela de linha ou banco; não altera permissões (RN-029)", security: temporaria, parameters: jogo, requestBody: { required: true, ...json(z.toJSONSchema(visualizacaoSchema)) }, responses: { "200": sessao, "400": resposta("visualizacao inválida"), ...indisponivel, "404": resposta("Jogo não encontrado") } },
  },
  "/arbitragem/jogos/{jogoId}/saida": {
    post: { summary: "Encerra a sessão temporária deste dispositivo e remove o cookie; repetir não tem efeito", security: temporaria, parameters: jogo, responses: { "200": resposta("encerrada: true se havia sessão válida"), "403": resposta("Origem não autorizada") } },
  },
  "/jogos/{jogoId}/arbitragem/senha": {
    get: { summary: "Presidente ou conta designada consulta a senha compartilhada; a primeira é gerada automaticamente. A sessão temporária não autoriza esta consulta", security: conta, parameters: jogo, responses: { "200": senha, "400": resposta("UUID inválido"), ...gestor } },
  },
  "/jogos/{jogoId}/arbitragem/senha/troca": {
    post: { summary: "Presidente ou conta designada gera nova senha; revoga todas as sessões abertas por senha e preserva as por designação", security: conta, parameters: jogo, responses: { "200": resposta("jogoId, senha nova, geradaEm e sessoesRevogadas"), "400": resposta("UUID inválido"), ...gestor } },
  },
};
