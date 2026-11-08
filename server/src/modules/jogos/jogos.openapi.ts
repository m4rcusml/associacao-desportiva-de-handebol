import { z } from "zod";
import { designacaoSchema, novoJogoSchema } from "./jogos.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const resumo = "id, campeonatoId, status, clubeA e clubeB ({ inscricaoId, clube {id, nome, cidade} }), local, fusoHorario (IANA), inicioPrevistoEm (instante UTC), inicioPrevistoLocal (AAAA-MM-DDTHH:mm no fuso do jogo), iniciadoEm, encerradoEm e criadoPorPresidenteId";
const detalhado = resposta(`${resumo}; arbitragens (id, tipo cadastrado ou externo, nomeCompleto, usuario {id, nomeCompleto, perfil} ou null, designadoPorPresidenteId, designadoEm)`);
const negado = { "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const jogo = [uuidParam("jogoId")];

/** Contrato das rotas de jogos e arbitragem (MAR-62), incluído em `GET /api/openapi.json`. */
export const openapiJogos = {
  "/campeonatos/{campeonatoId}/jogos": {
    get: { summary: "Presidente lista os jogos do campeonato por início previsto", security, parameters: [uuidParam("campeonatoId")], responses: {
      "200": resposta(`Lista de jogos: ${resumo}`), "400": resposta("UUID inválido"), ...negado, "404": resposta("Campeonato não encontrado"),
    } },
    post: { summary: "Presidente agenda jogo entre dois clubes distintos inscritos no campeonato planejado ou em andamento; inicioPrevisto é a hora local do fusoHorario (IANA) e o backend calcula o instante. Agendar não inicia o jogo", security, parameters: [uuidParam("campeonatoId")], requestBody: { required: true, ...json(z.toJSONSchema(novoJogoSchema, { io: "input" })) }, responses: {
      "201": detalhado, "400": resposta("Dados inválidos, clubes iguais, fuso desconhecido ou hora local inexistente/ambígua no fuso"), ...negado,
      "404": resposta("Campeonato não encontrado"), "409": resposta("Clube não inscrito no campeonato ou campeonato encerrado/cancelado"),
    } },
  },
  "/jogos/{jogoId}": {
    get: { summary: "Presidente consulta o jogo e a arbitragem designada", security, parameters: jogo, responses: {
      "200": detalhado, "400": resposta("UUID inválido"), ...negado, "404": resposta("Jogo não encontrado"),
    } },
  },
  "/jogos/{jogoId}/arbitragens": {
    post: { summary: "Presidente designa árbitro: conta de atleta/técnico aprovada, ativa, sem vínculo com os clubes do jogo e única por jogo (usuarioId), ou pessoa sem cadastro (nomeCompleto). Designação não abre acesso: sessões vêm na MAR-65", security, parameters: jogo, requestBody: { required: true, ...json(z.toJSONSchema(designacaoSchema, { io: "input" })) }, responses: {
      "201": detalhado, "400": resposta("Dados inválidos ou campos adicionais"), ...negado, "404": resposta("Jogo ou conta não encontrados"),
      "409": resposta("Jogo finalizado/cancelado, conta presidente, desativada, não aprovada, de clube do jogo ou já designada"),
    } },
  },
  "/jogos/{jogoId}/arbitragens/{arbitragemId}": {
    delete: { summary: "Presidente retira a designação com o jogo agendado ou em andamento", security, parameters: [...jogo, uuidParam("arbitragemId")], responses: {
      "200": detalhado, "400": resposta("UUID inválido"), ...negado, "404": resposta("Jogo ou designação não encontrados"), "409": resposta("Jogo finalizado ou cancelado"),
    } },
  },
};
