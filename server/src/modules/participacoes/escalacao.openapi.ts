import { z } from "zod";
import { escolhaSchema } from "./escalacao.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const uuidParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const escalacao = "jogo (id, campeonatoId, status, fusoHorario, inicioPrevistoEm, inicioPrevistoLocal) e clubes — o do técnico ou os dois para o presidente — com inscricaoId, clube, tecnico atual ({id, nomeCompleto} ou null), escalados (participacaoId, atleta, vinculoClubeId, vinculoAtual — false após transferência: não serve para credenciar —, escolhidaPorTecnico, escolhidaEm, suspensaoPendente), alteracoes (tipo inclusao/remocao, atleta, vinculoClubeId, tecnico, ocorridoEm) e atletasDoClube (escolhíveis: aprovados, com conta e carteirinha ativas e vínculo atual; id, nomeCompleto, suspensaoPendente). suspensaoPendente indica suspensão vigente no campeonato: não impede a escolha, só o credenciamento. A escalação é preliminar: não credencia nem confirma entrada em quadra";
const alteracao = resposta(`${escalacao}; alterado false quando a escalação já estava assim`);
const negado = { "400": resposta("UUID ou dados inválidos"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão, técnico sem clube, jogo de outro clube ou origem não autorizada") };
const jogo = [uuidParam("jogoId")];

/** Contrato da escalação preliminar pelo técnico (MAR-64), incluído em `GET /api/openapi.json`. */
export const openapiEscalacao = {
  "/jogos/{jogoId}/escalacao": {
    get: { summary: "Técnico aprovado consulta a escalação do próprio clube no jogo, inclusive escolhas do técnico anterior; presidente consulta os dois clubes", security, parameters: jogo, responses: {
      "200": resposta(escalacao), ...negado, "404": resposta("Jogo não encontrado"),
    } },
    post: { summary: "Técnico aprovado atual inclui na escalação do próprio clube um atleta aprovado, com conta e carteirinha ativas e vínculo atual no clube, até o início do jogo. Atleta já escolhido mantém a autoria original", security, parameters: jogo, requestBody: { required: true, ...json(z.toJSONSchema(escolhaSchema, { io: "input" })) }, responses: {
      "200": alteracao, ...negado, "404": resposta("Jogo ou atleta não encontrados"),
      "409": resposta("Jogo já iniciado, finalizado ou cancelado; atleta não aprovado, com conta desativada, carteirinha invalidada ou sem vínculo atual com o clube do técnico; conflito concorrente"),
    } },
  },
  "/jogos/{jogoId}/escalacao/{atletaId}": {
    delete: { summary: "Técnico aprovado atual retira o atleta da escalação do próprio clube até o início do jogo, inclusive escolha do técnico anterior ou de atleta transferido; a retirada fica no histórico", security, parameters: [...jogo, uuidParam("atletaId")], responses: {
      "200": alteracao, ...negado, "404": resposta("Jogo ou atleta não encontrados"), "409": resposta("Jogo já iniciado, finalizado ou cancelado"),
    } },
  },
};
