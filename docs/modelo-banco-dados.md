# Modelagem do banco — versão 1

Consolidada em 04/11/2026. Fonte das decisões: revisão com Marcus.
O [diagrama Mermaid](modelo-banco-dados.mmd) é a mesma fonte publicada no Miro.
Esta entrega é modelagem lógica; não aplica migrações ao banco.

## Convenções e implementação da herança

UUID identifica registros; datetime corresponde a timestamptz, date a data e string a texto.
Usuario concentra identidade e autenticação externa por authId (único); não armazena senha da conta.
perfil aceita atleta, tecnico ou presidente, exclusivamente. Cada Usuario tem exatamente
uma extensão correspondente, com usuarioId como PK e FK para Usuario.id.
A exclusividade entre as três extensões exige validação transacional/trigger na implementação;
as relações de herança no desenho não são herança nativa de tabelas PostgreSQL.
ativo controla a conta e não se confunde com carteirinha ou suspensão esportiva.
Nenhum atributo de métrica provisória perde o prefixo temp_ até confirmação do cliente.

## Chaves, campos opcionais e unicidade

Todos os id são PK. Campos terminados em Id são FKs para a entidade indicada;
exceções explícitas: authId e tokenQr são identificadores externos/opacos, sem FK.
criadoPorPresidenteId, definida/aplicada/emitida/incluidaPorPresidenteId e demais campos
de responsabilidade apontam para Presidente.usuarioId.
As relações essenciais estão desenhadas; FKs administrativas não geram linhas adicionais.

| Registro | Chave e restrições | Campos opcionais |
| --- | --- | --- |
| Usuario | PK id; UNIQUE authId | Nenhum |
| Atleta | PK/FK usuarioId | fotoChave, verificacaoSolicitadaEm, verificadoPorPresidenteId, verificadoEm |
| Presidente | PK/FK usuarioId | criadoPorPresidenteId somente para pré-cadastro inicial |
| Tecnico | PK/FK usuarioId; UNIQUE clubeId quando preenchido | clubeId e campos de solicitação/decisão da verificação |
| Clube | PK id | cidade |
| VinculoClube | PK id; um vínculo aberto por atleta; períodos sem sobreposição | fim; definidoPorPresidenteId no vínculo inicial solicitado pelo atleta |
| Carteirinha | PK id; UNIQUE atletaId, codigo, tokenQr | Nenhum após emissão |
| Campeonato | PK id | inicio, fim enquanto não agendado |
| InscricaoClube | PK id; UNIQUE campeonatoId + clubeId | Nenhum |
| Jogo | PK id; clubes A e B distintos e inscritos no mesmo campeonato | inicioPrevistoEm, iniciadoEm, encerradoEm, local |
| Participacao | PK id; UNIQUE jogoId + vinculoClubeId; UNIQUE jogoId + inscricaoClubeId + numeroCamisa quando preenchido | escolhidaPorTecnicoId, escolhidaEm, carteirinhaId, credenciadoEm, numeroCamisa, entrouEmQuadraEm |
| AcessoArbitragem | PK/FK jogoId; uma senha compartilhada por jogo | revogadoEm |
| Arbitragem | PK id; UNIQUE jogoId + usuarioId quando preenchido | usuarioId, designadoPorPresidenteId, designadoEm, acessouEm |
| LancamentoJogo | PK id; FK substituiLancamentoId para o lançamento corrigido; UNIQUE substituiLancamentoId quando preenchido | participacaoId somente em ocorrência geral do jogo; substituiLancamentoId |
| EstatisticasDoJogo | PK/FK jogoId; projeção calculada | Registro ausente antes de iniciar o jogo |
| DesempenhoDoAtleta | PK/FK participacaoId; projeção calculada | Registro ausente antes do credenciamento |
| RegraSuspensao | PK id | Nenhum; permanece inativa sem confirmação dos critérios |
| Suspensao | PK id; origem manual ou automatica | jogoOrigemId na origem manual; regraSuspensaoId na origem manual; aplicadaPorPresidenteId na automática; canceladaEm |
| CumprimentoSuspensao | PK composta suspensaoId + jogoId | Nenhum |

Todos os demais campos são obrigatórios. Não se exige nome único para pessoas ou clubes.
Nome de campeonato/edição também não é uma chave de identidade.

## Cadastro, aprovação e clubes

- Atleta cria a própria conta, escolhe um clube já cadastrado e solicita verificação.
  Seu vínculo inicial é obrigatório e confirmado pelo presidente na aprovação.
- Técnico cria a própria conta e solicita verificação, podendo inicialmente ficar sem clube.
  Um clube tem zero ou um técnico; um técnico tem zero ou um clube.
  A aprovação/atribuição deve rejeitar ocupação simultânea da mesma vaga.
- statusVerificacao: pendente, aprovado ou rejeitado. Aprovado exige presidente e data da decisão.
- Presidente é pré-cadastrado ou criado por outro presidente para sucessão/divisão de tarefas.
  Só o presidente aprova perfis e cria/atribui clubes, campeonatos, jogos e arbitragem.
- Somente presidente muda clube do atleta ou substitui técnico. Não há perfil Administrador nesta versão.
- Vínculos anteriores permanecem com seus períodos; o atleta tem exatamente um vínculo aberto.
  O cadastro inicial é permitido mesmo com campeonato em andamento.
- Transferir atleta é proibido se o clube atual participa de algum campeonato em andamento.
  Fora desse impedimento, encerrar vínculo e abrir o seguinte ocorre na mesma transação.
- clubeId do técnico é atribuição atual. O técnico que escolheu cada atleta fica identificado
  na Participacao mesmo após substituição. Não há carteirinha nem credenciamento de técnico.

## Carteirinha

É permanente por atleta, emitida após aprovação, com codigo único e tokenQr opaco único.
O QR identifica a carteirinha; não autoriza operações administrativas.
status aceita ativa ou invalidada. Presidente pode invalidar e reativar, registrando data e responsável.
Invalidar não bloqueia login e afeta apenas credenciamentos futuros, preservando jogos já credenciados.
Dados da carteirinha e aprovação não são graváveis pelo próprio atleta.

## Campeonato e jogo

Cada Campeonato representa uma edição com uma categoria textual, sem validação de idade/sexo nesta versão.
status do campeonato: planejado, em_andamento, encerrado ou cancelado.
O presidente inclui clubes por InscricaoClube; não há entidade Equipe nem elenco fixo por campeonato.
Cada Jogo referencia duas inscrições distintas do próprio campeonato (clube A e clube B).
Implementar FKs compostas/validação transacional para preservar essa coincidência.
status do jogo: agendado, em_andamento, finalizado ou cancelado.
Datas finais não antecedem iniciais. Iniciar e encerrar preenchem os respectivos horários.
Uma correção de resultado não reabre o acesso de arbitragem.

## Escolha, credenciamento e participação

Participacao reúne as três etapas sem criar uma equipe:
1. Técnico do clube, aprovado, escolhe atletas; data e autoria são opcionais quando incluídos diretamente pela arbitragem.
2. Arbitragem credencia manualmente ou lê o QR. A confirmação automática exige carteirinha ativa,
   atleta aprovado, vínculo atual com um dos clubes do jogo e ausência de suspensão pendente naquele campeonato.
3. Arbitragem registra entrouEmQuadraEm uma única vez. Credenciado não significa que jogou.

No credenciamento, carteirinhaId, credenciadoEm e numeroCamisa são preenchidos juntos;
a carteirinha deve pertencer ao atleta do vínculo. A inscrição deve corresponder ao mesmo clube
do vínculo e ao mesmo jogo. Apenas atleta credenciado pode entrar em quadra ou receber gols/penalidades de atleta.
O técnico altera sua escolha até o início do jogo. A página pode abrir antes para credenciamento;
a arbitragem inicia formalmente a partida depois. Arbitragem pode credenciar atrasados e atletas
fora da escolha inicial durante a partida. Depois do encerramento apenas presidente corrige.
numeroCamisa é inteiro não negativo e único no clube por jogo; não é atributo fixo do atleta.
Não se mede tempo jogado nem cada substituição.
A participação preserva vínculo, clube e número usados, sem reescrever o passado em transferências.
No caso de transferência permitida antes do credenciamento, a escolha antiga não autoriza jogar pelo clube anterior;
credenciamento já realizado permanece histórico válido.

## Arbitragem e senha temporária

Há vários registros de Arbitragem por jogo, sem criar um perfil Juiz.
usuarioId opcional aponta a atleta/técnico; nomeCompleto identifica também quem entrou com senha.
Usuário autenticado e previamente designado para aquele jogo entra sem senha.
Cadastro isolado não autoriza acesso: os demais usam a senha compartilhada e informam nome completo.
Para esses acessos, designadoPorPresidenteId e designadoEm podem estar ausentes: a autorização é a senha.
Não guardar a senha em texto; senhaHash deve usar algoritmo próprio para senhas.
AcessoArbitragem pode ser liberado antes do início formal para credenciamento e é revogado
ao encerramento; toda requisição valida a liberação, o status do jogo e a operação solicitada.
Antes de iniciar a partida, permitir credenciamento, mas não lançamentos de jogo em andamento.
Retirar uma designação deve invalidar as sessões correspondentes de acesso sem senha.
Para designados cadastrados que entram sem senha, impedir atleta/técnico de clube que disputa
o jogo; conferir também ao acessar. Quem entra pela senha compartilhada dispensa a conferência
de vínculo, mesmo se tiver cadastro; essa exceção foi expressamente confirmada por Marcus.
Para externos, confiar na autorização por senha, sem consultar vínculo.
visualizacao aceita linha ou banco; muda somente a tela, não as permissões.
Não há atribuição individual de lançamentos entre árbitros nesta versão.
A página abre para credenciamento antes do início formal; a arbitragem inicia o jogo em ação
posterior. liberadoEm registra a abertura do acesso, enquanto Jogo.iniciadoEm registra o início da partida.

## Métricas provisórias, correções e histórico

LancamentoJogo é a fonte dos registros esportivos. tipo usa provisoriamente:
temp_gol, temp_cartaoAmarelo, temp_exclusaoDoisMinutos e temp_cartaoVermelho.
valor é inteiro positivo, inicialmente 1 por ocorrência. Ocorrências de atleta exigem participacaoId.
Um gol sempre identifica atleta; o clube é obtido pela participação e não informado separadamente.
Não há lançamento de gol sem atleta.

EstatisticasDoJogo e DesempenhoDoAtleta são projeções (views), não tabelas editáveis em paralelo:
somam os lançamentos não anulados. Placar é zero a zero ao iniciar.
O histórico soma desempenho de cada participação e continua válido após mudança de clube.
Todas as métricas provisórias têm prefixo temp_: temp_placarClubeA, temp_placarClubeB,
temp_gols, temp_cartoesAmarelos, temp_exclusoesDoisMinutos e temp_cartoesVermelhos.

Arbitragem corrige durante o jogo; presidente corrige também após encerramento.
Uma correção anula o lançamento anterior e cria o substituto apontando substituiLancamentoId,
na mesma transação; uma exclusão lógica apenas anula. Não apagar o registro anterior.
Isso é rastreabilidade mínima da correção, não auditoria completa de autores e alterações.
Corrigir penalidades exige reconciliar suspensões automáticas e cumprimentos afetados, sem duplicação.

## Suspensões

Suspensão manual exige presidente, motivo, campeonato e quantidadeJogos positiva.
A automática exige jogoOrigemId e regraSuspensaoId; só se aplica após encerramento do jogo de origem.
RegraSuspensao prevê tipoPenalidade, quantidadePenalidades e quantidadeJogos; todos os critérios
e o alcance da contagem ainda dependem do cliente. Não preencher regras fictícias nem ativá-las.
Garantir idempotência da geração automática por atleta + jogoOrigemId + regraSuspensaoId.

Suspensão só impede jogos daquele campeonato, até cumprir a quantidade.
Cada jogo finalizado do clube no campeonato, ocorrido após a aplicação, conta uma vez,
mesmo sem escolha/credenciamento do atleta. O próprio jogo que originou a punição não conta.
CumprimentoSuspensao registra os jogos usados na contagem; saldo é quantidadeJogos menos
a quantidade de cumprimentos, nunca negativo. Não armazenar saldo divergente em outro campo.
Jogos adiados só contam quando realizados; cancelados não contam.
Lançar cumprimento e verificar credenciamento exige consistência transacional.
Alteração do status de um jogo exige reconciliar cumprimentos. Não recontar ao corrigir placar.
Transferência durante campeonato em andamento está bloqueada, portanto não transportamos suspensão
entre clubes. Acúmulo de suspensões simultâneas e auditoria completa permanecem pendentes;
não implementar soma ou cumprimento paralelo silenciosamente.

## Pendências que não bloqueiam esta versão documental

- Validar métricas temp_ e critérios de punição automática com cliente.
- Auditoria completa: autoria, valores anteriores/novos e justificativas de alterações.
- Tratamento disciplinar de múltiplas suspensões simultâneas, cancelamento de suspensão e efeitos retroativos.
- Detalhes da ficha cadastral além de nome, autenticação, foto opcional e vínculos.

Essas pendências limitam implementação das respectivas funcionalidades; esta versão não afirma
que regras automáticas ou auditoria completa estejam prontas para produção.
