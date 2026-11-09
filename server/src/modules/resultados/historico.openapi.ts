const resposta = (description: string) => ({ description });
const security = [{ sessionCookie: [] }];
const param = (name: string) => [{ name, in: "path", required: true, schema: { type: "string", format: "uuid" } }];
const negado = { "400": resposta("UUID inválido"), "401": resposta("Sessão ou cadastro indisponível") };
const jogo = "jogo {id, status, campeonato {id, nome, edicao, categoria}, local, fusoHorario, inicioPrevistoEm, iniciadoEm, encerradoEm, resultado, vencedorInscricaoId (separado do placar; null sem vencedor ou antes do encerramento), invalidadoEm (null se válido), interrompido}";
const situacao = "participacaoId, numeroCamisa, escalado, credenciado, entrouEmQuadra (entrada válida, não anulada), entradaAnulada, registroAdministrativo, irregularidades (conta_desativada, carteirinha_invalidada, suspensao; MAR-83) e metricas {temp_gols, temp_cartoesAmarelos, temp_exclusoesDoisMinutos, temp_cartoesVermelhos} somente dos lançamentos válidos (null sem credenciamento)";

/** Contrato das consultas de resultados e histórico esportivo (MAR-74), incluído em `GET /api/openapi.json`. */
export const openapiHistorico = {
  "/jogos/{jogoId}/desempenho": {
    get: { summary: "Métricas do jogo: resumo, placar (gols válidos) e cada participação dos dois clubes, distinguindo escalação, credenciamento e entrada em quadra. Presidente consulta qualquer jogo; técnico aprovado, somente jogos do clube que treina atualmente. Lançamentos anulados não contam e não são listados", security, parameters: param("jogoId"), responses: {
      "200": resposta(`${jogo}, placar {clubeA {inscricaoId, clube}, temp_placarClubeA, clubeB {inscricaoId, clube}, temp_placarClubeB} (null antes do início, salvo W.O.) e participacoes [{inscricaoId, atleta {id, nomeCompleto}, ${situacao}}], clube A antes do B`),
      ...negado, "403": resposta("Atleta, técnico sem aprovação ou de clube fora do jogo, ou origem não autorizada"), "404": resposta("Jogo não encontrado"),
    } },
  },
  "/atletas/{atletaId}/historico": {
    get: { summary: "Histórico esportivo do atleta a partir das participações, do jogo mais recente ao mais antigo, com o clube representado em cada jogo (preservado após transferências). Totais somam os lançamentos válidos de todas as participações credenciadas, inclusive jogos excepcionais e invalidados. Permitido ao próprio atleta, aos presidentes e ao técnico aprovado do clube atual do atleta", security, parameters: param("atletaId"), responses: {
      "200": resposta(`atleta {id, nomeCompleto, clubeAtual {id, nome} ou null}, totais {participacoes {escaladas, credenciadas, comEntradaEmQuadra}, temp_gols, temp_cartoesAmarelos, temp_exclusoesDoisMinutos, temp_cartoesVermelhos} e jogos [{${jogo}, clube e adversario {inscricaoId, clube {id, nome}}, placar {clube, adversario} (null antes do início, salvo W.O.), ${situacao}}]`),
      ...negado, "403": resposta("Outro atleta, técnico de outro clube ou sem aprovação, ou origem não autorizada"), "404": resposta("Atleta não encontrado"),
    } },
  },
};
