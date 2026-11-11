# Insights de UX e limites do backend

O plano atual de implementação do novo visual está em [frontend.md](frontend.md). Estes insights continuam referência de limitações contratuais; não são autorização para ampliar o backend durante o redesenho.

Registro de 10/11/2026, a partir das [proto-personas](personas.md) elaboradas com o Antigravity e da conferência dos contratos atuais. Os impactos de UX são hipóteses a validar com usuários; as permissões abaixo foram verificadas no código. Este documento não aprova mudanças de regra ou novos endpoints.

O backend permanece congelado. Uma necessidade registrada aqui orienta planejamento futuro; não autoriza sua implementação. Caminhos HTTP abaixo são relativos a `/api`.

## INS-001 — O técnico precisa receber o jogo antes de poder escalá-lo

**Impacto:** a jornada desejada “entrar → encontrar próximo jogo do meu clube → escalar” não pode ser preenchida integralmente por uma agenda real no frontend atual.

**Evidência:** [JogosController](../server/src/modules/jogos/jogos.controller.ts) restringe a classe a presidente, inclusive `GET /campeonatos/:campeonatoId/jogos` e `GET /jogos/:jogoId`. [CampeonatosController](../server/src/modules/campeonatos/campeonatos.controller.ts) também restringe listagem e detalhe a presidente. O técnico aprovado pode consultar e alterar `GET/POST/DELETE /jogos/:jogoId/escalacao`, mas precisa conhecer o ID; [EscalacaoController](../server/src/modules/participacoes/escalacao.controller.ts) e [consultarEscalacao](../server/src/modules/participacoes/escalacao.ts) conferem seu clube e retornam status, horário e candidatos do próprio clube. A resposta filtrada da escalação não fornece uma agenda nem o adversário. `GET /jogos/:jogoId/desempenho` fornece campeonato, local e outros dados de resumo para o técnico de um dos clubes, também por ID conhecido, conforme [HistoricoController](../server/src/modules/resultados/historico.controller.ts) e [consultarDesempenhoDoJogo](../server/src/modules/resultados/historico.ts). Porém, os dois clubes aparecem dentro de `placar`, que pode ser `null` antes do início (salvo W.O.); o resumo não contém as inscrições. Essa composição não garante o nome do adversário na preparação de um jogo agendado.

**Alternativa implementada com o backend atual:** o presidente copia o link de um jogo agendado; o técnico abre esse link ou informa o ID em sua área, com retorno ao jogo depois do login e consulta autorizada. Um link é navegação, não credencial. Os atalhos locais são referências, sem status persistido, não uma agenda completa. A tela mostra apenas o contexto retornado e indica quando o adversário não está disponível; nome recebido por texto ou parâmetro do link não é confirmação oficial do servidor. Não consulta as rotas exclusivas do presidente com a sessão do técnico. O histórico do próprio atleta mostra suas participações existentes; não é uma agenda completa do clube. Rotas e escopo no [README](../README.md#áreas-do-atleta-e-do-técnico-interface).

**Possível alteração futura:** consulta de jogos acessível ao técnico atual, limitada ao seu clube e com identificação dos dois clubes antes do início. Definir separadamente se haverá agenda para atleta e quais dados ela exporia. Sem alteração executada.

**Validação de UX:** observar se o técnico consegue abrir o jogo correto por link, identificar seu clube e horário e voltar à escalação sem digitar UUID. Verificar se a falta do adversário inviabiliza a identificação segura do jogo e como o presidente compartilha a agenda hoje.

## INS-002 — Alerta de suspensão não equivale a um extrato disciplinar

**Impacto:** atleta e técnico podem querer entender motivo, campeonato e saldo de uma suspensão, mas não dispõem de uma consulta completa autorizada para isso.

**Evidência:** [SuspensoesController](../server/src/modules/suspensoes/suspensoes.controller.ts) restringe a presidente `GET /campeonatos/:campeonatoId/suspensoes`. A [escalação](../server/src/modules/participacoes/escalacao.ts) sinaliza `suspensaoPendente` por atleta e permite a escolha: o saldo pode ser cumprido antes do jogo; a arbitragem valida o credenciamento. O [histórico esportivo](../server/src/modules/resultados/historico.ts) não substitui o extrato de suspensão.

**Alternativa com o backend atual:** mostrar ao técnico somente o alerta que a escalação retorna, explicando que a escolha não garante credenciamento. Orientar a confirmação dos detalhes com o presidente. Ao atleta, não inferir saldo a partir de cartões, partidas ou ausência de registro. Não apresentar uma área “Minhas suspensões” como consulta disponível.

**Possível alteração futura:** leituras de suspensões limitadas ao próprio atleta e ao técnico atual do clube, se essa visibilidade for aprovada. Não é necessária para disponibilizar carteirinha, histórico próprio ou escalação por link. Sem alteração executada.

**Validação de UX:** verificar se o técnico entende que pode escalar alguém com alerta e que a elegibilidade será conferida no credenciamento. Investigar quais detalhes o atleta precisa consultar sem intermediação.

## INS-003 — A gestão de presidentes não é uma lista oficial de contas

**Impacto:** ao trocar de navegador ou dividir a administração, o presidente não encontra automaticamente todos os outros presidentes nem consulta previamente sua situação atual.

**Evidência:** [PresidentesController](../server/src/modules/presidentes/presidentes.controller.ts) oferece criação, e [ContasController](../server/src/modules/contas/contas.controller.ts) oferece desativação/reativação por ID; não há leitura de presidentes ou de situação individual de conta nesses contratos. A [decisão registrada no README](../README.md#área-do-presidente-interface) mantém o backend e permite gerir apenas presidentes criados pela interface ou com ID informado.

**Alternativa já adotada:** referências locais por presidente autenticado, com somente ID e nome; identificação explícita da referência não confirmada; confirmação com ID completo; situação confirmada apenas pela resposta da operação. Remover uma referência local não desativa a conta. Não usar uma mutação apenas para consultar o estado.

**Possível alteração futura:** leitura autorizada para identificar presidentes e consultar situação antes de uma ação, caso a decisão de produto seja revista. É uma melhoria futura, não um bloqueio nem motivo para reabrir a decisão atual. Sem alteração executada.

**Validação de UX:** verificar se o usuário distingue “Tirar da lista” de “Desativar” e entende por que a lista muda entre navegadores.

## INS-004 — A arbitragem não possui consulta pública nem leitura após revogação

**Impacto:** o árbitro precisa receber o link/ID do jogo; antes de entrar não há contexto público autorizado. Depois do encerramento, não pode continuar consultando a súmula com o cookie revogado.

**Evidência:** [ArbitragemController](../server/src/modules/arbitragem/arbitragem.controller.ts) e [resumirSessao/revalidarArbitragem](../server/src/modules/arbitragem/acesso.ts) condicionam as leituras ao acesso temporário válido. O [encerramento](../server/src/modules/jogos/ciclo.ts) devolve um recibo restrito e revoga os acessos; reconhece o reenvio do próprio encerramento sem conceder outras operações. A sessão contém clubes, horário e local, mas não o nome do campeonato. A [foto](../server/src/modules/fotos/fotos.ts) exige atleta escalado ou credenciado naquele jogo; ler seu QR não amplia essa permissão.

**Alternativa com o backend atual:** acesso por link/ID e duas formas de ingresso, com contexto real somente após autorização. O dispositivo que confirma o encerramento apresenta o recibo recebido, separado do estado de sessão; os demais exibem o aviso de encerramento sem tentar uma consulta final. Foto é solicitada sob demanda apenas nas condições permitidas. Não criar agenda, consulta pública ou permissão para conferir foto de qualquer atleta a partir de um QR. A leitura manual continua disponível se a câmera não puder ser usada.

Não é necessária alteração do backend para esse escopo. Uma futura exposição de contexto antes do ingresso ou de súmula após o encerramento exigiria decisão explícita de visibilidade e novo contrato; não foi implementada. Não há cronômetro oficial de jogo ou de exclusões de dois minutos: a interface exibe registros e horários, sem inventar tempo sincronizado. Persona e critérios em [persona da arbitragem](persona-arbitragem.md) e execução em [plano](plano-frontend-arbitragem.md).

## Limites que orientam as telas, sem exigir mudança agora

- Aprovação, clube, conta ativa e carteirinha ativa são situações distintas. Rejeição não exige motivo; a tela não deve inventá-lo. A própria conta rejeitada pode pedir nova análise em `POST /verificacoes/solicitacao`, conforme [VerificacoesController](../server/src/modules/verificacoes/verificacoes.controller.ts).
- A conta edita somente o próprio nome em `PATCH /conta`, conforme [ContaPropriaController](../server/src/modules/contas/conta-propria.controller.ts). Troca de e-mail/senha e recuperação não devem aparecer como ações funcionais; recuperação continua adiada em [pendências](pendencias.md).
- O técnico não tem uma consulta geral de elenco com todas as situações cadastrais: a escalação retorna candidatos aptos e escolhas anteriores para aquele jogo. Ausência da lista de candidatos não permite explicar automaticamente um motivo específico nem concluir que o clube não tem atletas.
- O atleta pode consultar os clubes que representou nas participações do histórico, mas não `GET /atletas/:atletaId/vinculos`, exclusivo do presidente em [AtletasController](../server/src/modules/atletas/atletas.controller.ts). Não apresentar esse histórico esportivo como linha do tempo completa de filiações, pois pode haver vínculo sem jogo.
- Clube inicial incorreto exige orientação administrativa: `PATCH /conta` não edita o clube e a [transferência](../server/src/modules/atletas/transferencias.ts) exige atleta aprovado. Confirmar visualmente o clube antes do cadastro ajuda a prevenir o erro; encaminhar casos existentes ao presidente sem orientar aprovação apenas para contornar essa restrição.
- Presidente e técnico continuam por REST. Socket.IO está reservado às sessões temporárias autorizadas da arbitragem, segundo a [arquitetura](arquitetura.md#acesso-público-e-comunicação). Estados “atualizando” e “salvo” devem corresponder a consultas e respostas reais; não prometer atualização instantânea.
- Internet é obrigatória. Não prometer carteirinha offline ou usar cópia persistida do QR como prova de validade. A validade para o jogo é conferida pela arbitragem no backend.
- Exportação, divulgação pública de resultados, auditoria completa e exceção de transferência de clube eliminado continuam nos limites de [pendências](pendencias.md). Personas não os transformam em funcionalidades aprovadas.
