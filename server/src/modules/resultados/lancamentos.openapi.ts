import { z } from "zod";
import { anulacaoSchema, correcaoSchema, lancamentoSchema } from "./lancamentos.js";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const resposta = (description: string) => ({ description });
const security = [{ arbitragemCookie: [] }];
const presidente = [{ sessionCookie: [] }];
const jogoId = { name: "jogoId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const lancamentoId = { name: "lancamentoId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const parameters = [jogoId];
const lancamento = "id, operacaoId, tipo, relatorioDisciplinar (somente no temp_cartaoVermelho: true = desqualificação com relatório/azul; null nos demais), valor (1), registradoEm, participacaoId, inscricaoId, atleta {id, nomeCompleto}, numeroCamisa, substituiLancamentoId (lançamento corrigido por este), anuladoEm e substituidoPorId (correção que o anulou)";
const placar = "placar { clubeA {inscricaoId, clube}, temp_placarClubeA, clubeB {inscricaoId, clube}, temp_placarClubeB } ou null antes do início";
const registros = `jogo {id, status}, ${placar}, desempenho [{ participacaoId, inscricaoId, atleta, numeroCamisa, temp_gols, temp_cartoesAmarelos, temp_exclusoesDoisMinutos, temp_cartoesVermelhos }] e lancamentos [${lancamento}] em ordem de registro; anulados continuam listados, fora do placar e do desempenho`;
const indisponivel = {
  "401": resposta("Sem cookie temporário, sessão revogada/expirada, designação retirada, conta designada desativada ou sessão de conta de origem encerrada"),
  "403": resposta("Fora do dia do jogo no fuso do local, jogo sem data, finalizado ou cancelado, vínculo impeditivo da arbitragem designada ou origem não autorizada"),
};
const semPresidente = { "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada") };
const conflitoCorrecao = "Lançamento já corrigido ou anulado: corpo com message, lancamento (registro atualizado) e substituto (ou null), sem sobrescrever; operacaoId já usado em outra operação; atleta não credenciado; conflito concorrente";
const corpoCorrecao = { required: true, ...json(z.toJSONSchema(correcaoSchema, { io: "input" })) };
const corpoAnulacao = { required: true, ...json(z.toJSONSchema(anulacaoSchema, { io: "input" })) };
const respostaCorrecao = `{ lancamento (substituto), anulado (original), alterado, placar }; alterado é false no reenvio da mesma correção. lancamento: ${lancamento}`;
const respostaAnulacao = `{ lancamento (anulado), alterado, placar }; alterado é false no reenvio da mesma anulação. lancamento: ${lancamento}`;
const automaticas = "; pelo presidente, também suspensoesAutomaticas { criadas, anuladas } (ids das suspensões automáticas do jogo geradas ou anuladas pela reconciliação)";

/** Contrato dos lançamentos de gols e penalidades (MAR-68) e de suas correções e anulações (MAR-70). */
export const openapiLancamentos = {
  "/arbitragem/jogos/{jogoId}/lancamentos": {
    get: { summary: "Arbitragem consulta placar, desempenho por atleta credenciado e lançamentos do jogo; placar e desempenho são projeções dos lançamentos não anulados", security, parameters, responses: {
      "200": resposta(registros),
      "400": resposta("UUID inválido"), ...indisponivel, "404": resposta("Jogo não encontrado"),
    } },
    post: { summary: "Arbitragem registra gol ou penalidade (tipos temp_) do atleta credenciado, com o jogo em andamento. O clube vem da participação e cada ocorrência vale 1. No vermelho, relatorioDisciplinar true registra a desqualificação com relatório disciplinar (azul), que gera um jogo de suspensão no encerramento; ausente vale false. operacaoId, gerado pelo cliente, torna o reenvio seguro", security, parameters, requestBody: { required: true, ...json(z.toJSONSchema(lancamentoSchema, { io: "input" })) }, responses: {
      "200": resposta(`{ lancamento, alterado, placar }; alterado é false no reenvio da mesma operação. lancamento: ${lancamento}; ${placar}`),
      "400": resposta("UUID ou corpo inválido, tipo desconhecido, relatorioDisciplinar fora do vermelho, campos adicionais (inclusive valor ou clube)"), ...indisponivel,
      "404": resposta("Jogo não encontrado ou participação de outro jogo/inexistente"),
      "409": resposta("Jogo não está em andamento, atleta não credenciado, operacaoId já usado com outro conteúdo ou conflito concorrente"),
    } },
  },
  "/arbitragem/jogos/{jogoId}/lancamentos/{lancamentoId}/correcao": {
    post: { summary: "Arbitragem corrige, com o jogo em andamento, o tipo, o atleta credenciado e/ou o relatório disciplinar do vermelho de um lançamento: anula o original e cria o substituto na mesma transação, sem apagar o anterior. A primeira correção ou anulação prevalece. operacaoId identifica a correção e o substituto", security, parameters: [jogoId, lancamentoId], requestBody: corpoCorrecao, responses: {
      "200": resposta(respostaCorrecao),
      "400": resposta("UUID ou corpo inválido, campos adicionais ou correção sem alterar tipo, atleta nem relatório disciplinar"), ...indisponivel,
      "404": resposta("Jogo não encontrado, lançamento de outro jogo/inexistente ou participação de outro jogo/inexistente"),
      "409": resposta(`Jogo não está em andamento; ${conflitoCorrecao}`),
    } },
  },
  "/arbitragem/jogos/{jogoId}/lancamentos/{lancamentoId}/anulacao": {
    post: { summary: "Arbitragem anula (exclusão lógica), com o jogo em andamento, um lançamento: ele continua gravado e deixa de contar no placar e no desempenho. A primeira correção ou anulação prevalece", security, parameters: [jogoId, lancamentoId], requestBody: corpoAnulacao, responses: {
      "200": resposta(respostaAnulacao),
      "400": resposta("UUID ou corpo inválido"), ...indisponivel,
      "404": resposta("Jogo não encontrado ou lançamento de outro jogo/inexistente"),
      "409": resposta(`Jogo não está em andamento; ${conflitoCorrecao}`),
    } },
  },
  "/jogos/{jogoId}/lancamentos": {
    get: { summary: "Presidente consulta placar, desempenho e lançamentos do jogo em qualquer status, inclusive após o encerramento", security: presidente, parameters, responses: {
      "200": resposta(registros), "400": resposta("UUID inválido"), ...semPresidente, "404": resposta("Jogo não encontrado"),
    } },
  },
  "/jogos/{jogoId}/lancamentos/{lancamentoId}/correcao": {
    post: { summary: "Presidente corrige o tipo, o atleta credenciado e/ou o relatório disciplinar de um lançamento somente após o encerramento, sem devolver acesso à arbitragem nem refazer o cumprimento de suspensões. Mesmas regras da correção pela arbitragem. Reconcilia as suspensões automáticas do jogo: desqualificação com relatório retirada anula a automática (libera só o saldo restante, sem compensar jogos passados); acrescentada gera uma nova para os próximos jogos", security: presidente, parameters: [jogoId, lancamentoId], requestBody: corpoCorrecao, responses: {
      "200": resposta(respostaCorrecao + automaticas),
      "400": resposta("UUID ou corpo inválido, campos adicionais ou correção sem alterar tipo, atleta nem relatório disciplinar"), ...semPresidente,
      "404": resposta("Jogo, lançamento ou participação não encontrados neste jogo"),
      "409": resposta(`Jogo não finalizado (durante a partida, quem corrige é a arbitragem); ${conflitoCorrecao}`),
    } },
  },
  "/jogos/{jogoId}/lancamentos/{lancamentoId}/anulacao": {
    post: { summary: "Presidente anula (exclusão lógica) um lançamento somente após o encerramento, sem devolver acesso à arbitragem. Presidente não inclui lançamentos novos. Anular a desqualificação com relatório anula a suspensão automática dela, liberando só o saldo restante", security: presidente, parameters: [jogoId, lancamentoId], requestBody: corpoAnulacao, responses: {
      "200": resposta(respostaAnulacao + automaticas),
      "400": resposta("UUID ou corpo inválido"), ...semPresidente,
      "404": resposta("Jogo ou lançamento não encontrados neste jogo"),
      "409": resposta(`Jogo não finalizado; ${conflitoCorrecao}`),
    } },
  },
};
