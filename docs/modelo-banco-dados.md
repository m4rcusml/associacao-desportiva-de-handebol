# Modelagem do banco — versão 1

Consolidada em 04/11/2026 e atualizada em 07/11/2026 com a PEN-030 e as regras de acesso da arbitragem.
Fonte das decisões: revisão e definições aprovadas por Marcus. O [diagrama Mermaid](modelo-banco-dados.mmd)
inclui o complemento técnico; a cópia anteriormente publicada no Miro ainda precisa ser sincronizada.
A modelagem descreve o domínio completo. A implementação local cobre somente o subconjunto de
cadastro/autenticação abaixo; os demais registros continuam sem migração.

## Subconjunto implementado — 07/11/2026

`server/prisma/schema.prisma` e três migrações criam `AuthUser`, `AuthAccount`, `AuthSession`,
`AuthVerification`, `Usuario`, `Atleta`, `Tecnico`, `Presidente`, `Clube` e `VinculoClube`.
Nomes técnicos foram configurados no Better Auth 1.7.18; timestamps são `timestamptz`.
`AuthVerification` existe como parte do esquema técnico, mas seus fluxos não estão expostos.
`Usuario.authId` continua único, opaco e sem FK.

A segunda migração usa SQL complementar: aprovação exige presidente/data, período de vínculo
válido, índice parcial para um vínculo aberto e exclusão GiST (`btree_gist`) para impedir
sobreposição de períodos. Triggers diferidos verificam uma única extensão correspondente ao perfil
e exatamente um vínculo aberto por atleta ao concluir a transação. A terceira migração reforça
a validação de origem e destino em alterações dos identificadores de relação. O usuário do banco precisa
poder instalar `btree_gist` na migração; a extensão foi validada no PostgreSQL local.

Cadastro usa uma transação para identidade técnica, credencial e domínio; gera hash pelo Better Auth,
normaliza e-mail e rejeita campos não permitidos. Ambos os perfis públicos começam pendentes, com
solicitação de verificação registrada. Atleta informa clube; técnico não pode atribuir clube.
Não há fluxo público de aprovação/presidente. O seed local cria presidente fictício sem credencial
de login e um clube para demonstração, preservando a FK administrativa sem criar acesso público.
Esse presidente fictício existe somente no desenvolvimento local (o seed recusa `NODE_ENV=production`),
nunca conta como presidente ativo e não deve receber credencial. Se isso mudar, revisar a proteção
do último presidente ativo (MAR-60) e o procedimento `presidente:inicial` (MAR-55).
O presidente inicial com credencial vem do procedimento restrito descrito no README; os seguintes
são criados por presidente ativo, com `criadoPorPresidenteId` preenchido (MAR-55).
`Usuario.nomeCompleto` e `AuthUser.name` guardam o mesmo nome; a edição pela própria conta altera os
dois na mesma transação, sem tocar verificação, vínculos ou carteirinha (MAR-59).
Presidente desativa/reativa outras contas alterando `Usuario.ativo`, incrementando
`Usuario.versaoAtivacao` e revogando as `AuthSession` da conta (MAR-60); extensões, vínculos,
`Tecnico.clubeId`, aprovações, credencial e autoria são mantidos. `AuthSession.versaoAtivacao` guarda
a versão lida no login; um trigger (`BEFORE INSERT/UPDATE`, com `FOR SHARE` na conta) recusa sessão
de conta inativa ou com versão diferente da atual, impedindo que login concorrente grave sessão após
a desativação ou, havendo reativação no intervalo, sessão válida sem novo login.
Pelo menos um presidente ativo com credencial permanece, com serialização no banco. Não há
colunas de autoria/data da desativação: auditoria continua em PEN-007.
A migração `tecnico_clube_aprovado` (MAR-56) acrescenta CHECK que só permite `Tecnico.clubeId` preenchido com
verificação aprovada; a unicidade de `clubeId` já limita a um técnico por clube e um clube por técnico.
Presidente cria/edita clubes e atribui, substitui ou desvincula técnicos; `clubeId` do técnico é
somente a atribuição atual, sem tabela de períodos, conforme a modelagem abaixo.
Testes comprovam rollback também quando a falha ocorre no commit e acesso negado para identidade
sem domínio. Transferências seguem a migração `transferencia_atletas` (MAR-63), descrita abaixo.
A migração `carteirinha` (MAR-57) cria `Carteirinha` com campos mínimos provisórios (`codigo` e
`tokenQr` opacos e únicos, `status` ativa/invalidada, `emitidaEm`, `emitidaPorPresidenteId`) e
`UNIQUE(atletaId)`; a FK para `Atleta` impede carteirinha de técnico. Triggers diferidos garantem
atleta aprovado ⇔ carteirinha existente, verificado no commit: aprovação sem carteirinha, carteirinha
sem aprovação e retirada de aprovação são recusadas pelo banco. A aprovação bloqueia a linha `Usuario`
do solicitante (FOR UPDATE), grava presidente/data, confirma o vínculo aberto (`definidoPorPresidenteId`)
e emite a carteirinha na mesma transação; repetição devolve a mesma carteirinha. Rejeição registra
presidente/data sem motivo; nova solicitação da própria conta volta a pendente, com nova data, e limpa
a decisão anterior (sem histórico de decisões: PEN-007).
A migração `gestao_carteirinha` (MAR-58) acrescenta `Carteirinha.versaoQr` (começa em 1) e
`EventoCarteirinha` (`tipo` invalidacao, reativacao ou substituicao_qr; `versaoQr`; `presidenteId`;
`ocorridoEm`), histórico somente de inclusão: o responsável e a data do status atual são os do último
evento, sem colunas `statusAlterado*`. Um trigger recusa alterar atleta, código e emissão e só aceita
novo `tokenQr` com avanço de exatamente uma versão; outro recusa alterar ou remover eventos enquanto a
carteirinha existir. As operações bloqueiam a linha da carteirinha (`FOR UPDATE`) e gravam o evento
na mesma transação; o credenciamento (MAR-67) deve lê-la com `FOR SHARE`.
A migração `campeonatos` (MAR-61) cria `Campeonato` (`nome`, `edicao`, `categoria`, `inicio`/`fim`
opcionais do tipo data, `status`, `criadoPorPresidenteId`), `InscricaoClube` (`incluidaPorPresidenteId`,
`incluidaEm`; `UNIQUE(campeonatoId, clubeId)` e `UNIQUE(id, campeonatoId)`) e a persistência mínima de
`Jogo` (inscrições A/B, `fusoHorario`, `local`, `inicioPrevistoEm`, `iniciadoEm`, `encerradoEm`,
`status`, `criadoPorPresidenteId`). FKs compostas `(inscricaoClubeXId, campeonatoId)` garantem as duas
inscrições no campeonato do jogo; CHECKs exigem clubes distintos e horários coerentes com o status
(agendado sem horários; em andamento com início e sem fim; finalizado com fim; cancelado sem fim).
Triggers: o campeonato nasce planejado e só segue planejado → em_andamento (ao menos duas inscrições),
em_andamento → encerrado e planejado/em_andamento → cancelado (nenhum jogo agendado ou em andamento);
encerrado e cancelado não mudam. Inscrições são imutáveis e só entram ou saem com o campeonato
planejado; a FK de `Jogo` impede retirar inscrição com jogos. Jogo não muda de campeonato, e campeonato
encerrado/cancelado não recebe jogo agendado ou em andamento. Os triggers de inscrição e jogo bloqueiam
a linha do campeonato (`FOR SHARE`), serializando-os com as transições. Resultado, vencedor e
invalidação do jogo vieram na MAR-72 (migração `jogos_excepcionais`, abaixo).
A migração `jogos_arbitragem` (MAR-62) valida `Jogo.fusoHorario` contra `pg_timezone_names` (nome
IANA, sem offsets soltos) e torna inscrições e autoria do jogo imutáveis. `inicioPrevistoEm` guarda o
instante; a hora local é calculada no fuso do jogo. Cria `Arbitragem` com `usuarioId` **ou**
`nomeCompleto` (nome de conta lido de `Usuario`, sem cópia), `designadoPorPresidenteId`/`designadoEm`
juntos e obrigatórios para conta, `UNIQUE(jogoId, usuarioId)` e FK em cascata somente com a remoção do
próprio jogo. Triggers recusam alterar a designação, conta que não seja de atleta/técnico e inclusão
ou remoção fora de jogo agendado/em andamento (bloqueio `FOR SHARE` da linha `Jogo`). Aprovação, conta
ativa e impedimento de clube ficam na aplicação, com a linha `Usuario` bloqueada. `visualizacao`,
`acessouEm`, `AcessoArbitragem` e `SessaoArbitragem` vêm com o acesso (MAR-65); a retirada atual
exclui a designação, e a MAR-65 deve revogar suas sessões na mesma transação.
A migração `transferencia_atletas` (MAR-63) acrescenta dois triggers a `VinculoClube`. Em alteração:
atleta, clube e início não mudam; `definidoPorPresidenteId` só é preenchido uma vez; vínculo encerrado
não muda; encerrar o vínculo aberto exige atleta aprovado e nenhum campeonato em andamento com o clube
do vínculo inscrito, bloqueando os campeonatos planejados/em andamento desse clube com `FOR SHARE`
(o início concorrente aguarda ou é visto). Em inclusão, havendo vínculo anterior encerrado (transferência),
o novo começa exatamente no fim do último, em outro clube e com `definidoPorPresidenteId`; o primeiro
vínculo (cadastro inicial) não muda de regra. Com o índice parcial, a exclusão GiST e o trigger diferido
existentes, não há sobreposição, lacuna nem atleta sem vínculo atual. Vínculos não são excluídos pela
aplicação; registros futuros (`Participacao`) continuam apontando para o vínculo da época.
A migração `escalacao` (MAR-64) cria `Participacao` e `AlteracaoEscalacao`. `Participacao` guarda o
vínculo, a inscrição do clube no jogo e `atletaId` (cópia conferida do vínculo), além das três etapas.
CHECKs: escolha com autor e data juntos; carteirinha, data do credenciamento e camisa (inteiro não
negativo) juntos; entrada exige credenciamento; registro sem escolha nem credenciamento não existe.
Índices únicos: jogo + vínculo; jogo + inscrição + camisa (RN-019); jogo + atleta entre os credenciados.
O trigger de `Participacao` torna imutáveis jogo, inscrição, vínculo e atleta; exige inscrição de um
dos clubes do jogo e do clube do vínculo; só deixa a escolha entrar, mudar ou sair com o jogo agendado
(`FOR SHARE` da linha `Jogo`); exige para nova escolha vínculo aberto (`FOR SHARE`), atleta aprovado com
conta e carteirinha ativas (`FOR SHARE` em `Usuario` e `Carteirinha`) e técnico aprovado, ativo e
atribuído ao clube (`FOR SHARE` em `Tecnico`); exige para novo credenciamento
vínculo aberto e carteirinha do próprio atleta, de modo que escolha anterior a uma transferência não
credencia; e recusa excluir participação credenciada. `AlteracaoEscalacao` é somente de inclusão
(inclusão/remoção, vínculo, técnico e data), feita com o jogo agendado pelo técnico aprovado do clube do
vínculo; preserva a autoria após substituição do técnico ou retirada da escolha. Jogo removido leva
participações e histórico em cascata (somente fixtures; a aplicação não exclui jogos).
A migração `credenciamento` (MAR-67) substitui a função do trigger de `Participacao`: novo credenciamento
exige também jogo agendado ou em andamento, atleta aprovado, conta ativa, a carteirinha ativa do próprio atleta
(`FOR SHARE`) e nenhuma suspensão vigente no campeonato; carteirinha, data e camisa ficam imutáveis depois de
gravadas (exceções da MAR-71 abaixo); `entrouEmQuadraEm` é gravado uma vez, com o jogo em andamento e a conta do atleta
ativa, e não muda. As condições valem só no momento da gravação: credenciamento anterior a invalidação,
suspensão ou transferência continua válido.
A migração `correcao_credenciamento` (MAR-71) cria `AlteracaoCredenciamento`, histórico somente de inclusão das
correções de camisa e dos estornos: tipo (`correcao_camisa` ou `estorno`), cópia do credenciamento alterado (jogo,
inscrição, vínculo, atleta, carteirinha, data e camisa anterior), `numeroCamisaNova` (só na correção, diferente da
anterior) e `registradaEm`, sem autoria (RN-030, PEN-007). Não referencia a participação, que pode deixar de existir.
O trigger do histórico exige a cópia exata do credenciamento vigente e `registradaEm` = data da transação, recusa
alteração e só permite exclusão na cascata do jogo. O trigger de `Participacao` passa a aceitar: mudança só da
camisa com o jogo agendado, em andamento ou finalizado; retirada de carteirinha, data e camisa (ou exclusão, quando
não há escolha) com o jogo agendado ou em andamento, sem entrada e sem lançamentos, inclusive anulados. As duas
exigem o registro correspondente no histórico na mesma transação; a unicidade da camisa continua no índice.
A migração `sessoes_arbitragem` (MAR-65) acrescenta `Arbitragem.visualizacao` (linha/banco) e
`acessouEm`, `AcessoArbitragem` (`senhaHash` scrypt, `senhaCifrada` AES-256-GCM com prefixo `v1.`,
`geradaEm`, `revogadoEm`; PK/FK `jogoId`) e `SessaoArbitragem` (`metodoEntrada`, `tokenHash` SHA-256 único,
`criadaEm`/`expiraEm`, `revogadaEm` com `motivoRevogacao`: saida, troca_senha, jogo_encerrado, jogo_adiado ou
jogo_cancelado). `authSessionId` é texto **sem FK**, obrigatório somente na entrada por designação (CHECK):
logout e desativação apagam a `AuthSession` sem tocar na sessão temporária, que deixa de ser válida na
revalidação, e a ausência dela nunca vira entrada por senha. Cada entrada por senha cria uma `Arbitragem` sem
conta nem designação; por designação, a sessão só nasce em `Arbitragem` de conta. Triggers: sessão nasce
válida com o jogo agendado ou em andamento (`FOR SHARE` de `Jogo`); identificação, origem e prazos são
imutáveis; revogação é definitiva. Em `AcessoArbitragem`, o jogo é imutável, hash/cópia/data mudam juntos e o
acesso revogado não volta. Retirar a designação exclui suas sessões em cascata, na mesma transação; registros
de entrada por senha não são retirados um a um.
A migração `suspensoes` (MAR-66) cria `Suspensao` manual (`atletaId`, `campeonatoId`, `quantidadeJogos`
inteira positiva, `motivo`, `aplicadaPorPresidenteId`, `aplicadaEm`, `revogadaEm`/`revogadaPorPresidenteId` juntos e
`saldoEncerradoEm`, com revogação e término do saldo mutuamente exclusivos) e `CumprimentoSuspensao`
(`PK` `suspensaoId` + `jogoId`, `registradoEm`). Origem automática e anulação vêm da
migração `suspensao_automatica` (MAR-79, abaixo). Triggers: a suspensão nasce vigente, com atleta aprovado e campeonato
planejado/em andamento (`FOR SHARE` de `Campeonato`); os dados da aplicação são imutáveis; revogação e término
são definitivos, e o término exige campeonato encerrado/cancelado; exclusão só na cascata do campeonato. O
cumprimento bloqueia a suspensão (`FOR UPDATE`) e exige suspensão vigente com saldo, jogo finalizado do mesmo
campeonato encerrado depois da aplicação, vínculo do atleta com um dos clubes do jogo no encerramento e
ausência de credenciamento do atleta nesse jogo anterior à aplicação; é somente de inclusão (exclusão só na
cascata do jogo ou da suspensão).
A migração `suspensao_quantidade_positiva` remove o teto inicial de 100 jogos, sem alterar a migração já
aplicada. A API aceita inteiros positivos no intervalo do tipo `INTEGER` do PostgreSQL.
A migração `suspensao_automatica` (MAR-79) acrescenta `LancamentoJogo.relatorioDisciplinar` (CHECK: obrigatório
somente no `temp_cartaoVermelho`; vermelhos anteriores ficam `false`; trigger impede alterá-lo, mudando só por
correção) e, em `Suspensao`, `origem` (`manual`/`automatica`, padrão manual), `jogoOrigemId` (FK para `Jogo`,
cascata), `regra` (enum `RegraSuspensao`, hoje só `desqualificacao_com_relatorio`) e `anuladaEm`;
`aplicadaPorPresidenteId` passa a opcional. CHECK: manual com presidente, sem jogo, regra ou anulação; automática
sem presidente, com jogo e regra; anulação exclusiva com revogação e término do saldo. Índice único parcial
(`atletaId`, `jogoOrigemId`, `regra`) sem `anuladaEm`. Triggers: automática nasce com jogo de origem finalizado do
mesmo campeonato; origem, jogo, regra e anulação são imutáveis; o cumprimento recusa a suspensão anulada e o
próprio jogo de origem. A migração `credenciamento_suspensao_anulada` faz o trigger de credenciamento ignorar a
suspensão anulada.
A migração incremental `gate_suspensao_automatica` instala a função de bloqueio consultivo por
atleta/campeonato e triggers que a obtêm antes dos validadores de nova automática e novo credenciamento.
A API usa a mesma função e adquire esses bloqueios antes das contas compartilhadas e dos cumprimentos.
A migração `reducao_suspensao` (MAR-84) acrescenta a `Suspensao` `quantidadeReduzida` (total atual, de 0 até
`quantidadeJogos` − 1; a punição original não muda) e `justificativaRevogacao` (1 a 500 caracteres, somente com
revogação), e cria `ReducaoSuspensao` (`suspensaoId` em cascata, `quantidadeAnterior`, `novaQuantidade` menor que a
anterior, `reduzidaEm`; CHECK: decisão do presidente com `reduzidaPorPresidenteId` e `justificativa`, ou herdada com
`herdadaDeReducaoId` e sem ambos). Triggers: a suspensão nasce sem redução nem justificativa; revogar exige
justificativa, que é definitiva com a revogação; `quantidadeReduzida` só diminui, em suspensão não revogada, anulada
nem encerrada, acompanhada da decisão registrada a partir do total atual. A decisão bloqueia a suspensão
(`FOR UPDATE`), exige saldo a cumprir e é imutável (exclusão só em cascata); a herdada exige automática anterior
anulada do mesmo atleta/jogo/regra e repete o total da decisão de origem. Cumprimento e credenciamento passam a
usar o total atual (`COALESCE(quantidadeReduzida, quantidadeJogos)`).
A migração `lancamentos` (MAR-68) cria `LancamentoJogo` (`operacaoId` UUID único enviado pelo cliente, `jogoId`,
`participacaoId`, `tipo` com os quatro valores `temp_`, `valor` e `registradoEm`) e as views `EstatisticasDoJogo`
(`temp_placarClubeA`/`B`, somente jogos com `iniciadoEm`) e `DesempenhoDoAtleta` (as quatro métricas `temp_`, somente
participações credenciadas), sem tabelas de totais. CHECKs: `valor` positivo e `participacaoId` obrigatório nos tipos
atuais, todos de atleta. O trigger exige jogo em andamento (`FOR SHARE` de `Jogo`) e participação credenciada do
mesmo jogo (`FOR SHARE`), recusa alteração e só permite exclusão na cascata do jogo. Não há coluna de autoria do
árbitro (RN-030).
A migração `correcao_lancamentos` (MAR-70) acrescenta `substituiLancamentoId` (FK para o próprio `LancamentoJogo`,
UNIQUE), `anuladoEm` e `anulacaoOperacaoId` (UNIQUE; CHECK: os dois juntos). O trigger passa a aceitar como única
alteração a anulação, uma vez e sem mudar os demais dados, com o jogo em andamento ou finalizado; o substituto nasce
com o jogo em andamento ou finalizado, apontando lançamento do mesmo jogo anulado pela mesma operação
(`anulacaoOperacaoId` = `operacaoId` do substituto). Inclusão sem `substituiLancamentoId` continua exigindo jogo em
andamento. As views passam a ignorar os anulados. Não há autoria da anulação (RN-030, PEN-007).
A migração `ciclo_jogo` (MAR-69) acrescenta o trigger de transições de `Jogo`, sem colunas novas: o jogo nasce
agendado; agendado passa a em andamento, cancelado ou finalizado (este último reservado ao W.O. sem início, MAR-72);
em andamento passa somente a finalizado. Finalizado e cancelado não mudam status, horários, data ou fuso;
`iniciadoEm` não muda depois de gravado; data prevista e fuso só mudam com o jogo agendado (adiamento). O adiamento
não tem status próprio: atualiza `inicioPrevistoEm` (nulo = sem data) e revoga as sessões com `jogo_adiado`.
A migração `jogos_excepcionais` (MAR-72) acrescenta a `Jogo` `resultado` (`ResultadoJogo`: normal, interrompido,
abandono ou wo), `inscricaoClubeVencedorId` e `invalidadoEm`, e cria `InterrupcaoJogo` e `AlteracaoResultadoJogo`.
CHECK: resultado preenchido exatamente com o jogo finalizado; `wo` somente sem `iniciadoEm` e os demais somente com
ele; vencedor vazio ou uma das duas inscrições do jogo (vazio no jogo finalizado = nenhum vencedor); invalidação só
no jogo finalizado. Os jogos já finalizados recebem `normal` e o vencedor pelo placar (empate = nenhum). Com o jogo
finalizado, resultado/vencedor só mudam com a correção registrada em `AlteracaoResultadoJogo` na mesma transação, e
`invalidadoEm` é gravado uma vez, com o registro de invalidação (motivo obrigatório); o histórico é somente de
inclusão. `InterrupcaoJogo` (`interrompidoEm`, `retomadoEm`) admite uma interrupção aberta por jogo, aberta e retomada
com o jogo em andamento; a retomada é a única alteração. Com interrupção aberta, triggers recusam lançamento novo
(não o substituto da correção) e entrada em quadra. `EstatisticasDoJogo` passa a incluir o W.O. sem início (0 a 0).
A migração `notificacoes_jogo` (MAR-73) cria `EventoJogo`, a caixa de saída das notificações Socket.IO: `id`
crescente (`bigserial`), `jogoId` (FK, exclusão em cascata com o jogo), `tipo` (`TipoEventoJogo`), `referenciaId`
opcional (lançamento, atleta ou arbitragem afetados), `criadoEm` e `publicadoEm` (vazio = pendente, com índice
parcial). A linha é gravada na transação da mudança; triggers emitem `pg_notify` (entregue só no commit) na
inserção do evento e na revogação de `SessaoArbitragem`, exclusão de `Arbitragem` e exclusão ou mudança de
validade de `AuthSession`, sem dados sensíveis no aviso. Não guarda dados esportivos nem pessoais.

## Convenções e implementação da herança

`UUID` identifica registros do domínio; `datetime` corresponde a `timestamptz`,
`date` a data e `string` a texto. `Usuario` concentra identidade e
ligação à identidade da biblioteca de autenticação por `authId` (único); não armazena senha
da conta nesta entidade. Better Auth e suas tabelas técnicas complementam o domínio conforme
[a arquitetura](arquitetura.md) e a seção técnica abaixo. Isso não exige um provedor de autenticação externo. `perfil`
aceita atleta, tecnico ou presidente, exclusivamente. Cada `Usuario` tem exatamente uma
extensão correspondente, com `usuarioId` como `PK` e `FK` para
`Usuario`.`id`. A exclusividade entre as três extensões exige validação
transacional/trigger na implementação; as relações de herança no desenho não são herança nativa de
tabelas PostgreSQL. `ativo` controla a conta e não se confunde com carteirinha ou
suspensão esportiva. As métricas foram confirmadas na MAR-82 (requisitos, seção 15); o banco/API
atual conserva `temp_` até migração compatível em tarefa própria.

## Chaves, campos opcionais e unicidade

Todos os `id` são `PK`. Campos terminados em Id são `FKs` para
a entidade indicada; exceções explícitas: `authId` e `tokenQr` são identificadores
externos/opacos, sem `FK`. `criadoPorPresidenteId`,
definida/aplicada/emitida/`incluidaPorPresidenteId` e demais campos de responsabilidade apontam para
`Presidente`.`usuarioId`. As relações essenciais estão desenhadas; `FKs`
administrativas não geram linhas adicionais.

| Registro               | Chave e restrições                                                                                                         | Campos opcionais                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Usuario`              | `PK` `id`; `UNIQUE` `authId`                                                                                               | Nenhum                                                                                                                           |
| `Atleta`               | `PK`/`FK` `usuarioId`                                                                                                      | `fotoChave`, `verificacaoSolicitadaEm`, `verificadoPorPresidenteId`, `verificadoEm`                                              |
| `Presidente`           | `PK`/`FK` `usuarioId`                                                                                                      | `criadoPorPresidenteId` nulo somente no presidente inicial                                                                       |
| `Tecnico`              | `PK`/`FK` `usuarioId`; `UNIQUE` `clubeId` quando preenchido                                                                | `clubeId` e campos de solicitação/decisão da verificação                                                                         |
| `Clube`                | `PK` `id`                                                                                                                  | `cidade`                                                                                                                         |
| `VinculoClube`         | `PK` `id`; um vínculo aberto por atleta; períodos sem sobreposição                                                         | `fim`; `definidoPorPresidenteId` no vínculo inicial solicitado pelo atleta                                                       |
| `Carteirinha`          | `PK` `id`; `UNIQUE` `atletaId`, `codigo`, `tokenQr`                                                                        | Nenhum após emissão                                                                                                              |
| `EventoCarteirinha`    | `PK` `id`; `FK` `carteirinhaId`; somente inclusão                                                                          | Nenhum                                                                                                                           |
| `Campeonato`           | `PK` `id`                                                                                                                  | `inicio`, `fim` enquanto não agendado                                                                                            |
| `InscricaoClube`       | `PK` `id`; `UNIQUE` `campeonatoId` + `clubeId`                                                                             | Nenhum                                                                                                                           |
| `Jogo`                 | `PK` `id`; clubes A e B distintos e inscritos no mesmo campeonato                                                          | `inicioPrevistoEm`, `iniciadoEm`, `encerradoEm`, `local`; `resultado` e `inscricaoClubeVencedorId` (vazio = nenhum) somente finalizado; `invalidadoEm` |
| `InterrupcaoJogo`      | `PK` `id`; `FK` `jogoId`; uma aberta por jogo                                                                              | `retomadoEm`                                                                                                                     |
| `AlteracaoResultadoJogo` | `PK` `id`; `FK` `jogoId`, `presidenteId`; somente inclusão                                                               | vencedores anterior/novo; `motivo` obrigatório na invalidação                                                                    |
| `EventoJogo`           | `PK` `id` (`bigserial`); `FK` `jogoId`; índice parcial dos pendentes                                                      | `referenciaId`; `publicadoEm` até o envio                                                                                        |
| `Participacao`         | `PK` `id`; `UNIQUE` `jogoId` + `vinculoClubeId`; `UNIQUE` `jogoId` + `inscricaoClubeId` + `numeroCamisa` quando preenchido | `escolhidaPorTecnicoId`, `escolhidaEm`, `carteirinhaId`, `credenciadoEm`, `numeroCamisa`, `entrouEmQuadraEm`                     |
| `AcessoArbitragem`     | `PK`/`FK` `jogoId`; uma senha compartilhada por jogo                                                                       | `revogadoEm`                                                                                                                     |
| `Arbitragem`           | `PK` `id`; `UNIQUE` `jogoId` + `usuarioId` quando preenchido                                                               | `usuarioId`, `designadoPorPresidenteId`, `designadoEm`, `acessouEm`                                                              |
| `LancamentoJogo`       | `PK` `id`; `UNIQUE` `operacaoId`; `FK` `substituiLancamentoId` para o lançamento corrigido; `UNIQUE` `substituiLancamentoId` e `anulacaoOperacaoId` quando preenchidos | `participacaoId` somente em ocorrência geral do jogo; `substituiLancamentoId`; `anuladoEm` e `anulacaoOperacaoId` (juntos); `relatorioDisciplinar` fora do vermelho |
| `EstatisticasDoJogo`   | `PK`/`FK` `jogoId`; projeção calculada                                                                                     | Registro ausente antes de iniciar o jogo                                                                                         |
| `DesempenhoDoAtleta`   | `PK`/`FK` `participacaoId`; projeção calculada                                                                             | Registro ausente antes do credenciamento                                                                                         |
| `Suspensao`            | `PK` `id`; `origem` manual ou automatica; `FK` `jogoOrigemId`; `UNIQUE` parcial `atletaId` + `jogoOrigemId` + `regra` sem `anuladaEm` | `jogoOrigemId` e `regra` (enum `RegraSuspensao`) na manual; `aplicadaPorPresidenteId` na automática; `revogadaEm`/`revogadaPorPresidenteId`/`justificativaRevogacao`; `saldoEncerradoEm`; `anuladaEm` (somente automática); `quantidadeReduzida` |
| `CumprimentoSuspensao` | `PK` composta `suspensaoId` + `jogoId`                                                                                     | Nenhum                                                                                                                           |
| `ReducaoSuspensao`     | `PK` `id`; `FK` `suspensaoId`; `FK` `herdadaDeReducaoId` para a decisão de origem                                          | `justificativa` e `reduzidaPorPresidenteId` na herdada; `herdadaDeReducaoId` na decisão do presidente                             |

Todos os demais campos são obrigatórios. Não se exige `nome` único para pessoas ou
clubes. Nome de campeonato/edição também não é uma chave de identidade.

## Cadastro, aprovação e clubes

- `Atleta` cria a própria conta, escolhe um clube já cadastrado e solicita verificação.
  Seu vínculo inicial é obrigatório e confirmado pelo presidente na aprovação.
- Técnico cria a própria conta e solicita verificação, podendo inicialmente ficar sem clube.
  Um clube tem zero ou um técnico; um técnico tem zero ou um clube.
  A aprovação/atribuição deve rejeitar ocupação simultânea da mesma vaga.
- `statusVerificacao`: pendente, aprovado ou rejeitado. Aprovado exige presidente e data da decisão.
- `Presidente` é pré-cadastrado ou criado por outro presidente para sucessão/divisão de tarefas.
  Só o presidente aprova perfis e cria/atribui clubes, campeonatos, jogos e arbitragem.
- Somente presidente muda clube do atleta ou substitui técnico. Não há `perfil` Administrador nesta versão.
- Vínculos anteriores permanecem com seus períodos; o atleta tem exatamente um vínculo aberto.
  O cadastro inicial é permitido mesmo com campeonato em andamento.
- Transferir atleta é proibido se o clube atual participa de algum campeonato em andamento.
  Fora desse impedimento, encerrar vínculo e abrir o seguinte ocorre na mesma transação.
- `clubeId` do técnico é atribuição atual. O técnico que escolheu cada atleta fica identificado
  na `Participacao` mesmo após substituição. Novo técnico aprovado consulta/altera escalação
  anterior até o início; a autoria da escolha vigente fica em `Participacao` e todas as inclusões e
  retiradas ficam em `AlteracaoEscalacao` (MAR-64).
  Não há carteirinha nem credenciamento de técnico. Sem técnico, arbitragem credencia diretamente.

## `Carteirinha`

É permanente por atleta, emitida após aprovação, com `codigo` único e `tokenQr`
opaco único. O QR identifica a carteirinha; não autoriza operações administrativas.
`status` aceita `ativa` ou invalidada. `Presidente` pode invalidar e
reativar, registrando data e responsável. Invalidar não bloqueia login e afeta apenas
credenciamentos futuros, preservando jogos já credenciados. Dados da carteirinha e aprovação não são
graváveis pelo próprio atleta. Presidente pode substituir `tokenQr`, invalidando o anterior,
sem criar outra carteirinha nem reescrever participações. Preservar histórico de substituições.
Invalidação, reativação e substituição ficam em `EventoCarteirinha`; `versaoQr` identifica o QR
vigente e torna a repetição da mesma substituição reconhecível. Tokens anteriores não são guardados.

## `Campeonato` e jogo

Cada `Campeonato` representa uma edição com uma `categoria` textual, sem validação de
idade/sexo nesta versão. `status` do campeonato: planejado, `em_andamento`, encerrado ou
cancelado. O presidente inclui clubes por `InscricaoClube`; não há entidade Equipe nem elenco fixo
por campeonato. Cada `Jogo` referencia duas inscrições distintas do próprio campeonato
(clube A e clube B). Implementar `FKs` compostas/validação transacional para preservar
essa coincidência. `status` do jogo: agendado, `em_andamento`, finalizado ou cancelado.
Datas finais não antecedem iniciais. Iniciar e encerrar preenchem os respectivos horários. Uma
correção de resultado não reabre o acesso de arbitragem.

O ciclo do campeonato é manual pelo presidente, com condições em requisitos, seção 11; datas
não mudam status automaticamente. `Jogo` passa a precisar de `fusoHorario` IANA do local,
independente do instante UTC de `inicioPrevistoEm`. Registrar resultado excepcional e vencedor
separadamente do placar (`inscricaoClubeVencedorId` opcional, limitado às inscrições do jogo);
a ausência de vencedor deve ser explícita no resultado de encerramento.
Representação (MAR-72): abandono, interrupção definitiva e W.O. são valores de `resultado` do jogo finalizado;
a interrupção temporária é um registro em `InterrupcaoJogo` com o jogo ainda em andamento, retomado no mesmo jogo,
sem outra partida; a invalidação é `invalidadoEm` no jogo finalizado, com o motivo no histórico. Correções do
presidente ficam em `AlteracaoResultadoJogo`. As estatísticas preservadas continuam nas projeções existentes.

## Escolha, credenciamento e participação

`Participacao` reúne as três etapas sem criar uma equipe:

1. Técnico do clube, aprovado, escolhe atletas; data e autoria são opcionais quando incluídos diretamente pela arbitragem.
2. `Arbitragem` credencia manualmente ou lê o QR. A confirmação automática exige carteirinha `ativa`,
   atleta aprovado, vínculo atual com um dos clubes do jogo e ausência de suspensão pendente naquele campeonato.
3. `Arbitragem` registra `entrouEmQuadraEm` uma única vez. Credenciado não significa que jogou.

No credenciamento, `carteirinhaId`, `credenciadoEm` e `numeroCamisa` são preenchidos juntos;
a carteirinha deve pertencer ao atleta do vínculo. A inscrição deve corresponder ao mesmo clube do
vínculo e ao mesmo jogo. Apenas atleta credenciado pode entrar em quadra ou receber gols/penalidades
de atleta. O técnico altera sua escolha até o início do jogo. A página pode abrir antes para
credenciamento; a arbitragem inicia formalmente a partida depois. `Arbitragem` pode credenciar
atrasados e atletas fora da escolha inicial durante a partida. Depois do encerramento apenas
presidente corrige. `numeroCamisa` é inteiro não negativo e único no clube por jogo; não é
atributo fixo do atleta. Não se mede tempo jogado nem cada substituição. A participação preserva
vínculo, clube e número usados, sem reescrever o passado em transferências. No caso de transferência
permitida antes do credenciamento, a escolha antiga não autoriza jogar pelo clube anterior;
credenciamento já realizado permanece histórico válido.

## `Arbitragem` e senha temporária

Há vários registros de `Arbitragem` por jogo, sem criar um `perfil` Juiz.
`usuarioId` opcional aponta a atleta/técnico; `nomeCompleto` identifica também quem entrou
com senha. Usuário autenticado e previamente designado para aquele jogo entra sem senha. Cadastro
isolado não autoriza acesso: os demais usam a senha compartilhada e informam `nome`
completo. Para esses acessos, `designadoPorPresidenteId` e `designadoEm` podem estar ausentes: a
autorização é a senha. Não guardar a senha em texto; `senhaHash` deve usar algoritmo próprio
para senhas. Manter também `senhaCifrada` para consulta posterior por presidente e conta
autenticada/designada, com proteção e gestão de chave na arquitetura. Sem senha em texto puro.
O acesso usa o dia no fuso do local; se a partida começou, continua após meia-noite até encerrar.
Sem início até a virada, exige reagendamento. Não há liberação manual adicional; o acesso é
revogado ao encerramento; toda requisição valida a disponibilidade de acesso, o `status` do jogo e a
operação solicitada. Antes de iniciar a partida, permitir credenciamento, mas não lançamentos de
jogo em andamento. Retirar uma designação deve invalidar as sessões correspondentes de acesso sem
senha. Para designados cadastrados que entram sem senha, impedir atleta/técnico de clube que disputa
o jogo; conferir também ao acessar. Quem entra pela senha compartilhada dispensa a conferência de
vínculo, mesmo se tiver cadastro; essa exceção foi expressamente confirmada por Marcus. Para
externos, confiar na autorização por senha, sem consultar vínculo. `visualizacao` aceita linha
ou banco; muda somente a tela, não as permissões. Não há atribuição individual de lançamentos entre
árbitros nesta versão. No dia marcado, a página permite credenciamento antes do início formal;
a arbitragem inicia o jogo em ação posterior, registrada em `Jogo.iniciadoEm`.
O campo `liberadoEm` foi retirado: não há uma operação de liberação manual.

A primeira senha é gerada automaticamente. Somente presidente ou usuário autenticado pela
própria conta e designado para aquele jogo pode solicitar troca manual. A sessão por nome e
senha não concede essa permissão, mesmo que a pessoa possua cadastro. A troca atualiza
`senhaHash` e `senhaCifrada` e revoga todas as `SessaoArbitragem` com `metodoEntrada = senha` na mesma transação,
preservando as sessões por designação. Não haverá retirada individual de acesso por senha.

Somente presidente adia ou cancela. Ambas as ações invalidam imediatamente todas as sessões
temporárias do jogo, de ambos os métodos. Adiar também gera nova senha e o acesso fica sujeito
à nova data; sem nova data, não há entrada. O mecanismo físico de reagendamento será detalhado
na implementação, sem reutilizar sessões antigas nem acrescentar um novo status por suposição.
Cancelar ou finalizar mantém o acesso bloqueado. Contas permanentes e outros jogos não são revogados.
Aplicar as mudanças junto da invalidação das sessões, com controle de concorrência e notificações
apenas após persistência (`EventoJogo`, MAR-73). Repetições de início/fim e conflitos de correção seguem requisitos, seção 11.

A correção administrativa de credenciamento aprovada na MAR-80 (requisitos, seção 13) é implementada pela
migração `correcao_administrativa` (MAR-83), somente com o jogo finalizado. `Participacao` ganha:
`entradaAnuladaEm` + `entradaAnuladaPorPresidenteId` (juntos, uma vez, sobre entrada registrada, que permanece);
`registradaPorPresidenteId` + `irregularidades` (`IrregularidadeParticipacao[]`: `conta_desativada`,
`carteirinha_invalidada`, `suspensao`) no registro administrativo da participação real, que dispensa as condições do
credenciamento normal mas exige atleta aprovado, a própria carteirinha, vínculo vigente no início do jogo e data da
transação; e `credenciamentoDesfeitoEm`, que mantém sem etapas a participação estornada pelo presidente, porque
lançamentos anulados ou transferidos continuam apontando para ela (só sai na cascata do jogo). O estorno pelo
presidente exige entrada ausente ou anulada e nenhum lançamento válido. `AlteracaoCredenciamento` passa a copiar
entrada, anulação, registro administrativo e irregularidades e ganha `presidenteId` (autor; null para a arbitragem e
registros anteriores). Os limites da arbitragem da MAR-71 não mudam. A entrada anulada deixa de contar no histórico.

## Métricas aprovadas, identificadores atuais, correções e histórico

`LancamentoJogo` é a fonte dos registros esportivos. A lista desta versão foi aprovada na MAR-82
(requisitos, seção 15). O `tipo` atual ainda usa identificadores legados:
`temp_gol`, `temp_cartaoAmarelo`, `temp_exclusaoDoisMinutos` e `temp_cartaoVermelho`. `valor` é
inteiro positivo, inicialmente 1 por ocorrência. O vermelho traz `relatorioDisciplinar` (MAR-79): `true` é a
desqualificação com relatório, sinalizada pelo azul, que não é segunda infração nem métrica separada. Ocorrências de atleta exigem `participacaoId`. Um
gol sempre identifica atleta; o clube é obtido pela participação e não informado separadamente. Não
há lançamento de gol sem atleta.

`EstatisticasDoJogo` e `DesempenhoDoAtleta` são projeções (views), não tabelas editáveis em paralelo:
somam os lançamentos não anulados. Placar é zero a zero ao iniciar. O histórico soma desempenho de
cada participação e continua válido após mudança de clube. As métricas atuais ainda têm prefixo
`temp_`: `temp_placarClubeA`, `temp_placarClubeB`, `temp_gols`, `temp_cartoesAmarelos`,
`temp_exclusoesDoisMinutos` e `temp_cartoesVermelhos`.

`Arbitragem` corrige durante o jogo; após o encerramento, somente o presidente corrige ou anula, sem
incluir lançamentos novos (MAR-70). Uma correção anula o lançamento anterior e cria o substituto apontando
`substituiLancamentoId`, na mesma transação, mudando tipo e/ou atleta credenciado; `valor` continua 1. Uma
exclusão lógica apenas anula. Não apagar o registro anterior. Isso é rastreabilidade mínima da
correção, não auditoria completa de autores e alterações. A correção também pode mudar só o
`relatorioDisciplinar` do vermelho. Após o encerramento, cada correção ou anulação do presidente reconcilia as
suspensões automáticas do jogo (MAR-79), sem duplicação; os cumprimentos continuam dependendo só do encerramento
e não são refeitos.

## Suspensões

Suspensão manual exige presidente, `motivo`, campeonato e `quantidadeJogos` positiva. A
automática (MAR-79) exige `jogoOrigemId` e `regra`, sem presidente, e só nasce após o encerramento do jogo
de origem, que não a cumpre. `RegraSuspensao` é um enum com o único critério aprovado na MAR-78
(requisitos, seção 12): `desqualificacao_com_relatorio`, um jogo, gerado pelo vermelho com
`relatorioDisciplinar` — a ocorrência carrega o relatório, sem inferi-lo de qualquer vermelho ou da terceira
exclusão. Não há acumulação entre partidas nem progressão automática; a tabela de regras parametrizáveis
(`tipoPenalidade`, `quantidadePenalidades`) prevista antes não foi criada por não haver critério que a use. A
geração é idempotente por atleta + `jogoOrigemId` + `regra` (índice único parcial). Retirar a ocorrência por
correção registra `anuladaEm`, que encerra o saldo restante e preserva os cumprimentos; restaurá-la gera nova
suspensão, aplicada a partir da correção.

Suspensão só impede jogos daquele campeonato, até cumprir a quantidade. Cada jogo encerrado
definitivamente do clube no campeonato e elegível após aplicação conta uma vez, mesmo sem
escolha/credenciamento.
Nova suspensão preserva jogo já credenciado; o impedimento e cumprimento se referem aos próximos
jogos. Jogos excepcionais e retomadas seguem requisitos, seção 11. O próprio jogo que originou
a punição não conta. Todo encerramento definitivo (normal, interrompido, abandono ou W.O.) cumpre uma vez;
interrupção temporária, correção de resultado e invalidação não registram nem desfazem cumprimentos (MAR-72). `CumprimentoSuspensao` registra os jogos usados
na contagem; saldo é o total atual (`quantidadeReduzida` ou, sem redução, `quantidadeJogos`) menos a quantidade
de cumprimentos, nunca negativo. Não
armazenar saldo divergente em outro campo. Jogos adiados só contam quando realizados; cancelados não
contam. Lançar cumprimento e verificar credenciamento exige consistência transacional. Alteração do
`status` de um jogo exige reconciliar cumprimentos. Não recontar ao corrigir placar.
Transferência durante campeonato em andamento está bloqueada, portanto não transportamos suspensão
entre clubes. Suspensões simultâneas são cumpridas em paralelo: cada jogo elegível cumpre cada suspensão
vigente uma vez, respeitando a chave composta. Presidente pode revogar, preservando original e
cumprimentos; `revogadaEm`, `revogadaPorPresidenteId` e, desde a MAR-84, `justificativaRevogacao` registram a
revogação (MAR-66).
Encerramento/cancelamento do campeonato registra o término do saldo em `saldoEncerradoEm`, distinto
de revogação e de jogos cumpridos. Redução parcial (MAR-84, requisitos, seção 14): o presidente define novo
total menor que o atual, inclusive zero, com justificativa; `quantidadeJogos` preserva a punição original,
`quantidadeReduzida` o total atual e `ReducaoSuspensao` cada decisão. O recálculo automático não altera o total
reduzido (a regra atual vale um jogo, então vale o menor entre regra e redução); a automática recriada após uma
anulação herda o menor total já decidido para o mesmo atleta/jogo/regra (decisão de Marcus, MAR-84). Anular a
origem libera o saldo indevido restante, e revogadas não são reativadas.

## Pendências que não bloqueiam esta versão documental

- Métricas confirmadas na MAR-82 (requisitos, seção 15); migração compatível dos identificadores `temp_` e adequação de carteirinha pendentes. Critérios automáticos aprovados em requisitos, seção 12, e implementados na MAR-79.
- Auditoria completa: autoria, valores anteriores/novos e justificativas de alterações.
- Redução administrativa e recálculo automático posterior (requisitos, seção 14) foram implementados na
  MAR-84. Revogação, paralelismo e recálculo sem compensação foram definidos em requisitos, seção 11.
  Correção administrativa de credenciamento (requisitos, seção 13) foi implementada na MAR-83.
- A ficha desta versão e os dados da carteirinha foram definidos na MAR-82 (requisitos, seção 15); verificar implementação sem acrescentar dados pessoais além dos aprovados.

Essas pendências limitam implementação das respectivas funcionalidades; esta versão não afirma que
as funcionalidades estejam prontas para produção ou que a auditoria completa esteja implementada.

## Esclarecimentos posteriores — 06/11/2026

Conforme a [arquitetura](arquitetura.md), somente fotos de atletas serão enviadas.
A verificação esportiva não terá upload de documentos. A ficha e a carteirinha desta versão
foram definidas posteriormente na MAR-82 (requisitos, seção 15).
A escolha do Better Auth foi concluída na PEN-030; seu complemento lógico está abaixo.
Os campos mínimos inicialmente provisórios foram confirmados para esta versão na MAR-82,
sem exigir dados pessoais adicionais. E-mail e credencial pertencem à
autenticação; atleta informa clube inicial e técnico pode ficar sem clube. Fotos usam Supabase
Storage na franquia gratuita. Formatos, tamanho e permissões definidos nos requisitos, seção 11.
`Atleta.fotoChave` guarda somente a chave privada do objeto atual (`atletas/<atletaId>/<uuid>.<ext>`), nunca URL;
cada envio cria chave nova, trocada com a linha do atleta bloqueada (MAR-75, sem migração).

## Complemento técnico de autenticação — PEN-030

Decisão de 07/11/2026, com esquema físico e integração local das contas permanentes validados
nesta entrega. Os nomes `Auth*` estão configurados nos modelos nativos; IDs técnicos usam texto.
O schema físico completo da versão fixada está em `server/prisma/schema.prisma`, com migrações
versionadas. A lista abaixo resume responsabilidades; não substitui esse contrato físico.
As convenções gerais de UUID e sufixo `Id` não substituem o contrato nativo: `providerId` e
`accountId`, por exemplo, são identificadores de autenticação, não FKs do domínio.

| Registro | Responsabilidade e vínculo |
| --- | --- |
| `AuthUser` (`user`) | Identidade de login, e-mail único, nome e campos técnicos. `emailVerified` não representa aprovação esportiva. |
| `AuthAccount` (`account`) | Credencial ligada por `userId` a `AuthUser`; hash de senha gerido pela biblioteca. |
| `AuthSession` (`session`) | Sessão por dispositivo ligada a `AuthUser`, com token único e expiração; revogação pelo mecanismo nativo. |
| `AuthVerification` (`verification`) | Identificador, valor e expiração para recuperação/verificação; não torna a confirmação de e-mail obrigatória. |

`Usuario.authId` continua `UNIQUE`, opaco e **sem FK**, associado a `AuthUser.id` pela aplicação.
Não há exclusão automática do histórico esportivo ao remover uma identidade técnica.
E-mail de login pertence a `AuthUser`; `Usuario.nomeCompleto` é a referência do nome no domínio.
Se `AuthUser.name` o reproduzir, a atualização deve ser controlada pelo backend, sem edição
independente. Cadastro e rotas nativas não podem contornar perfil, vínculo inicial ou aprovação.
Garantir tratamento de falhas/repetições entre identidade e domínio; hooks após criação, sozinhos,
não garantem transação compartilhada. Identidade sem cadastro válido não recebe autorização esportiva.

### `SessaoArbitragem`

Registro técnico próprio, separado da sessão de conta e da configuração `AcessoArbitragem`.
Um registro de `Arbitragem` pode ter várias sessões, sem criar um perfil permanente de juiz.

| Campo | Restrição lógica |
| --- | --- |
| `id` | UUID, PK. |
| `arbitragemId` | FK obrigatória para `Arbitragem.id`; o jogo é obtido por esse vínculo. |
| `authSessionId` | Referência à `AuthSession.id`, obrigatória na entrada por designação e ausente na entrada por senha. |
| `metodoEntrada` | `designacao` ou `senha`; determina a regra de autorização. |
| `tokenHash` | UNIQUE, obrigatório; somente hash de token opaco aleatório, nunca o token em texto. |
| `criadaEm`, `expiraEm` | Obrigatórios; expiração técnica não substitui revogação ao encerrar. |
| `revogadaEm` | Opcional; presente quando a sessão foi revogada. |

Na designação, revalidar sessão de conta de origem, `Usuario.ativo`, designação e impedimento
de clube. Remoção/expiração/revogação da sessão de origem invalida o acesso por designação;
o tratamento físico de exclusão dessa referência será definido no esquema gerado, sem permitir
que a ausência da sessão converta a entrada em acesso por senha. Na entrada por senha, não
exigir sessão de conta nem conferir vínculo com clubes (RN-025).

Reutilizar `Arbitragem` existente quando houver `usuarioId` para o mesmo jogo, preservando
`UNIQUE(jogoId, usuarioId)` e os dados da designação. Não presumir identificação de externos
pelo nome nem duplicar `visualizacao` na sessão; linha/banco continuam sem diferença de permissão.
O cookie temporário não sobrescreve o da conta; sua abrangência deve alcançar REST e Socket.IO.

Encerrar o jogo atualiza o estado, revoga `AcessoArbitragem` e suas sessões na mesma transação.
Escritas concorrentes precisam de controle transacional que impeça autorização anterior ao
encerramento de permitir gravação posterior. Preservar sessões da conta e acessos a outros jogos.
Notificações só chegam a destinatários ainda autorizados, inclusive em conexões já abertas: o publicador
revalida cada conexão antes de enviar e retira as revogadas (MAR-73).

As regras de dia de acesso, adiamento e troca de senha estão definidas na seção de arbitragem;
PEN-022 e PEN-021 resolvidas; esclarecimentos em requisitos, seção 11.
Recuperação de senha e sua prova estão adiadas nesta etapa; as estruturas nativas permanecem previstas.
Não introduzir tabela de tentativas, metadados pessoais ou retenção como obrigação nesta rodada.
