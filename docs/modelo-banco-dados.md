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
a linha do campeonato (`FOR SHARE`), serializando-os com as transições. `resultadoExcepcional`,
vencedor e demais colunas de jogo ficam para as tarefas correspondentes.
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
suspensão esportiva. Nenhum atributo de métrica provisória perde o prefixo `temp_` até
confirmação do cliente.

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
| `Jogo`                 | `PK` `id`; clubes A e B distintos e inscritos no mesmo campeonato                                                          | `inicioPrevistoEm`, `iniciadoEm`, `encerradoEm`, `local`, `resultadoExcepcional`, `inscricaoClubeVencedorId`                                                                         |
| `Participacao`         | `PK` `id`; `UNIQUE` `jogoId` + `vinculoClubeId`; `UNIQUE` `jogoId` + `inscricaoClubeId` + `numeroCamisa` quando preenchido | `escolhidaPorTecnicoId`, `escolhidaEm`, `carteirinhaId`, `credenciadoEm`, `numeroCamisa`, `entrouEmQuadraEm`                     |
| `AcessoArbitragem`     | `PK`/`FK` `jogoId`; uma senha compartilhada por jogo                                                                       | `revogadoEm`                                                                                                                     |
| `Arbitragem`           | `PK` `id`; `UNIQUE` `jogoId` + `usuarioId` quando preenchido                                                               | `usuarioId`, `designadoPorPresidenteId`, `designadoEm`, `acessouEm`                                                              |
| `LancamentoJogo`       | `PK` `id`; `FK` `substituiLancamentoId` para o lançamento corrigido; `UNIQUE` `substituiLancamentoId` quando preenchido    | `participacaoId` somente em ocorrência geral do jogo; `substituiLancamentoId`                                                    |
| `EstatisticasDoJogo`   | `PK`/`FK` `jogoId`; projeção calculada                                                                                     | Registro ausente antes de iniciar o jogo                                                                                         |
| `DesempenhoDoAtleta`   | `PK`/`FK` `participacaoId`; projeção calculada                                                                             | Registro ausente antes do credenciamento                                                                                         |
| `RegraSuspensao`       | `PK` `id`                                                                                                                  | Nenhum; permanece inativa sem confirmação dos critérios                                                                          |
| `Suspensao`            | `PK` `id`; `origem` manual ou automatica                                                                                   | `jogoOrigemId` na `origem` manual; `regraSuspensaoId` na `origem` manual; `aplicadaPorPresidenteId` na automática; `canceladaEm` |
| `CumprimentoSuspensao` | `PK` composta `suspensaoId` + `jogoId`                                                                                     | Nenhum                                                                                                                           |

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
  anterior até o início; a modelagem física deve preservar autoria das escolhas/alterações.
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
A representação física de interrupção/retomada, abandono, W.O. e invalidação será detalhada na
implementação; não confundir interrupção temporária com finalização nem criar outra partida
para retomada. As estatísticas preservadas continuam nas projeções existentes.

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
apenas após persistência. Repetições de início/fim e conflitos de correção seguem requisitos, seção 11.

## Métricas provisórias, correções e histórico

`LancamentoJogo` é a fonte dos registros esportivos. `tipo` usa provisoriamente:
`temp_gol`, `temp_cartaoAmarelo`, `temp_exclusaoDoisMinutos` e `temp_cartaoVermelho`. `valor` é
inteiro positivo, inicialmente 1 por ocorrência. Ocorrências de atleta exigem `participacaoId`. Um
gol sempre identifica atleta; o clube é obtido pela participação e não informado separadamente. Não
há lançamento de gol sem atleta.

`EstatisticasDoJogo` e `DesempenhoDoAtleta` são projeções (views), não tabelas editáveis em paralelo:
somam os lançamentos não anulados. Placar é zero a zero ao iniciar. O histórico soma desempenho de
cada participação e continua válido após mudança de clube. Todas as métricas provisórias têm prefixo
`temp_`: `temp_placarClubeA`, `temp_placarClubeB`, `temp_gols`, `temp_cartoesAmarelos`,
`temp_exclusoesDoisMinutos` e `temp_cartoesVermelhos`.

`Arbitragem` corrige durante o jogo; presidente corrige também após encerramento. Uma correção
anula o lançamento anterior e cria o substituto apontando `substituiLancamentoId`, na mesma transação; uma
exclusão lógica apenas anula. Não apagar o registro anterior. Isso é rastreabilidade mínima da
correção, não auditoria completa de autores e alterações. Corrigir penalidades exige reconciliar
suspensões automáticas e cumprimentos afetados, sem duplicação.

## Suspensões

Suspensão manual exige presidente, `motivo`, campeonato e `quantidadeJogos` positiva. A
automática exige `jogoOrigemId` e `regraSuspensaoId`; só se aplica após encerramento do jogo de
`origem`. `RegraSuspensao` prevê `tipoPenalidade`, `quantidadePenalidades` e `quantidadeJogos`;
todos os critérios e o alcance da contagem ainda dependem do cliente. Não preencher regras fictícias
nem ativá-las. Garantir idempotência da geração automática por atleta + `jogoOrigemId` +
`regraSuspensaoId`.

Suspensão só impede jogos daquele campeonato, até cumprir a quantidade. Cada jogo encerrado
definitivamente do clube no campeonato e elegível após aplicação conta uma vez, mesmo sem
escolha/credenciamento.
Nova suspensão preserva jogo já credenciado; o impedimento e cumprimento se referem aos próximos
jogos. Jogos excepcionais e retomadas seguem requisitos, seção 11. O próprio jogo que originou
a punição não conta. `CumprimentoSuspensao` registra os jogos usados
na contagem; saldo é `quantidadeJogos` menos a quantidade de cumprimentos, nunca negativo. Não
armazenar saldo divergente em outro campo. Jogos adiados só contam quando realizados; cancelados não
contam. Lançar cumprimento e verificar credenciamento exige consistência transacional. Alteração do
`status` de um jogo exige reconciliar cumprimentos. Não recontar ao corrigir placar.
Transferência durante campeonato em andamento está bloqueada, portanto não transportamos suspensão
entre clubes. Suspensões simultâneas são cumpridas em paralelo: cada jogo elegível cumpre cada suspensão
vigente uma vez, respeitando a chave composta. Presidente pode revogar, preservando original e
cumprimentos; `canceladaEm` representa revogação, com responsável e histórico a modelar.
Encerramento/cancelamento do campeonato exige registro de término do saldo, distinto de
revogação e de jogos cumpridos. Redução parcial e justificativa obrigatória continuam pendentes.

## Pendências que não bloqueiam esta versão documental

- Validar métricas `temp_` e critérios de punição automática com cliente.
- Auditoria completa: autoria, valores anteriores/novos e justificativas de alterações.
- Redução parcial de suspensão, justificativa obrigatória e procedimento de correção de
  credenciamento com entrada/lançamentos. Revogação, paralelismo e recálculo sem compensação
  foram definidos em requisitos, seção 11.
- Detalhes da ficha cadastral além de `nome`, autenticação, foto opcional e vínculos.

Essas pendências limitam implementação das respectivas funcionalidades; esta versão não afirma que
regras automáticas ou auditoria completa estejam prontas para produção.

## Esclarecimentos posteriores — 06/11/2026

Conforme a [arquitetura](arquitetura.md), somente fotos de atletas serão enviadas.
A verificação esportiva não terá upload de documentos. A ficha cadastral continua pendente.
A escolha do Better Auth foi concluída na PEN-030; seu complemento lógico está abaixo.
Para começar, os campos já modelados e essenciais aos fluxos serão usados provisoriamente,
sem exigir dados adicionais até confirmação do cliente. E-mail e credencial pertencem à
autenticação; atleta informa clube inicial e técnico pode ficar sem clube. Fotos usam Supabase
Storage na franquia gratuita. Formatos, tamanho e permissões definidos nos requisitos, seção 11.

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
Notificações só chegam a destinatários ainda autorizados, inclusive em conexões já abertas.

As regras de dia de acesso, adiamento e troca de senha estão definidas na seção de arbitragem;
PEN-022 e PEN-021 resolvidas; esclarecimentos em requisitos, seção 11.
Recuperação de senha e sua prova estão adiadas nesta etapa; as estruturas nativas permanecem previstas.
Não introduzir tabela de tentativas, metadados pessoais ou retenção como obrigação nesta rodada.
