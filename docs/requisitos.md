# Requisitos — gestão de handebol

Versão 1 — 04/11/2026, atualizada em 07/11/2026. Documento derivado das rodadas de levantamento com Marcus nesta conversa.

## 1. Escopo e situação dos requisitos

Esta versão cobre usuários, clubes, campeonatos, jogos, carteirinhas, credenciamento, arbitragem,
desempenho e suspensões. Requisitos descrevem o comportamento esperado; a modelagem descreve sua
representação no banco.

Referências: [modelagem lógica](modelo-banco-dados.md), [diagrama](modelo-banco-dados.mmd) e [glossário](GLOSSARY.md). [Definições iniciais](definicoes-iniciais.md) é um
registro histórico, substituído pelas decisões posteriores quando houver divergência.

Os identificadores RF, RNF e RN representam, respectivamente, requisitos funcionais, requisitos não
funcionais e regras de negócio. Não implicam ordem de implementação.

Implementação local em 07/11/2026: cadastro mínimo de atleta/técnico com solicitação pendente,
vínculo inicial obrigatório do atleta, login por e-mail/senha sem confirmação de e-mail,
consulta de sessão, rota autenticada de demonstração e logout revogável. Persistência em
PostgreSQL/Prisma validada com testes de falha e concorrência do cadastro e repetição do cookie
após logout. Aprovação esportiva, carteirinhas, recuperação, arbitragem e demais fluxos continuam
planejados. A rota demonstrativa não representa autorização para operar os fluxos esportivos.
Campos mínimos continuam provisórios conforme PEN-008. Comandos e provas no [README](../README.md).

| Situação   | Significado                                                                        |
| ---------- | ---------------------------------------------------------------------------------- |
| Confirmado | Decisão expressa ou proposta aceita por Marcus nas rodadas                         |
| Provisório | Comportamento adotado para a primeira versão, ainda dependente do cliente          |
| Proposto   | Requisito técnico derivado das necessidades, sem validação expressa como requisito |
| Pendente   | Decisão em aberto; não deve ser implementada por suposição                         |

“Confirmado” registra o alinhamento com Marcus; não significa validação direta pelo cliente. Os 12
RNFs foram aprovados por Marcus em 04/11/2026. Uma pendência não autoriza omitir os demais
comportamentos já confirmados.

## 2. Atores

| Ator            | Responsabilidade                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Atleta          | Criar sua conta, selecionar clube e solicitar verificação; participar dos jogos quando elegível                                     |
| Técnico         | Criar sua conta, solicitar verificação e escolher os atletas de seu clube para cada jogo                                            |
| Presidente      | Aprovar cadastros, administrar clubes e competições, designar arbitragem, aplicar suspensão manual e corrigir resultados encerrados |
| Arbitragem      | Credenciar atletas, confirmar entrada em quadra, registrar/corrigir ocorrências e encerrar jogos                                    |
| Árbitro externo | Atuar na arbitragem por acesso temporário, sem conta permanente                                                                     |

Arbitragem é uma atribuição em determinada partida, não um quarto perfil de usuário. Linha e banco
são visualizações, não conjuntos diferentes de permissões.

## 3. Requisitos funcionais

### 3.1. Contas, verificação e carteirinha

| ID     | Requisito                                                                                                                                     | Situação   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-001 | Permitir que o atleta crie sua própria conta, escolha um clube existente e solicite verificação ao presidente.                                | Confirmado |
| RF-002 | Permitir que o técnico crie sua própria conta e solicite verificação, com ou sem clube no cadastro inicial.                                   | Confirmado |
| RF-003 | Permitir ao presidente analisar e aprovar as solicitações de atleta e técnico.                                                                | Confirmado |
| RF-004 | Emitir automaticamente a carteirinha do atleta quando o presidente aprovar seu cadastro.                                                      | Confirmado |
| RF-005 | Disponibilizar identificação do atleta por carteirinha e QR code para uso no credenciamento.                                                  | Confirmado |
| RF-006 | Permitir ao presidente invalidar e reativar a carteirinha do atleta.                                                                          | Confirmado |
| RF-007 | Permitir pré-cadastro do presidente inicial e criação de outros presidentes por um presidente existente, para sucessão ou divisão de tarefas. | Confirmado |
| RF-008 | Oferecer autenticação para reconhecer usuários cadastrados e aplicar as permissões do perfil e das designações por jogo.                      | Confirmado |

### 3.2. Clubes e competições

| ID     | Requisito                                                                                                        | Situação   |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-009 | Permitir ao presidente criar clubes, inclusive temporariamente sem técnico.                                      | Confirmado |
| RF-010 | Permitir ao presidente atribuir, substituir e desvincular o técnico do clube.                                    | Confirmado |
| RF-011 | Permitir ao presidente transferir atletas entre clubes quando não houver impedimento de campeonato em andamento. | Confirmado |
| RF-012 | Preservar o histórico dos clubes representados pelo atleta, inclusive em jogos anteriores à transferência.       | Confirmado |
| RF-013 | Permitir ao presidente criar campeonatos, cada um com uma categoria.                                             | Confirmado |
| RF-014 | Permitir ao presidente incluir os clubes participantes do campeonato.                                            | Provisório |
| RF-015 | Permitir ao presidente criar jogos entre dois clubes inscritos no mesmo campeonato.                              | Confirmado |
| RF-016 | Permitir ao técnico escolher e alterar os atletas de seu clube para um jogo até o início da partida.             | Confirmado |

A inclusão de clubes pelo presidente é a operação vigente da primeira versão; Marcus indicou que
ainda precisa confirmá-la com o cliente.

### 3.3. Credenciamento e participação

| ID     | Requisito                                                                                                                   | Situação   |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-017 | Permitir à arbitragem credenciar o atleta por confirmação manual ou leitura do QR code da carteirinha.                      | Confirmado |
| RF-018 | Validar a elegibilidade antes de confirmar o credenciamento; por QR code, confirmar automaticamente se o atleta for válido. | Confirmado |
| RF-019 | Informar o número da camisa durante o credenciamento em cada jogo e impedir duplicidade no mesmo clube e partida.           | Confirmado |
| RF-020 | Permitir à arbitragem credenciar atletas atrasados após o início do jogo.                                                   | Confirmado |
| RF-021 | Permitir à arbitragem credenciar atleta válido do clube mesmo sem escolha prévia pelo técnico.                              | Confirmado |
| RF-022 | Registrar separadamente o credenciamento e a efetiva entrada em quadra.                                                     | Confirmado |
| RF-023 | Permitir à arbitragem confirmar uma vez que o atleta entrou em quadra, sem registrar cada entrada/saída.                    | Confirmado |

### 3.4. Arbitragem e acesso temporário

| ID     | Requisito                                                                                                                                         | Situação   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-024 | Permitir ao presidente designar vários árbitros para o mesmo jogo, incluindo atletas, técnicos ou pessoas sem cadastro.                           | Confirmado |
| RF-025 | Disponibilizar a página temporária de arbitragem somente no dia marcado para o jogo, sem liberação manual adicional.                             | Confirmado |
| RF-026 | Permitir acesso sem senha do jogo ao usuário autenticado que esteja designado como árbitro daquela partida.                                       | Confirmado |
| RF-027 | Permitir acesso dos demais responsáveis pela senha compartilhada e específica daquele jogo, solicitando nome completo de quem entra com senha.    | Confirmado |
| RF-028 | Permitir escolher visualização de linha ou banco, mantendo as mesmas permissões.                                                                  | Confirmado |
| RF-029 | Invalidar todos os acessos temporários de arbitragem ao encerrar, adiar ou cancelar o jogo, inclusive em dispositivos já conectados.                | Confirmado |
| RF-030 | Permitir abrir a página temporária antes da partida para credenciamento e permitir à arbitragem iniciar formalmente o jogo em uma ação posterior. | Confirmado |

### 3.5. Jogo, métricas e correções

| ID     | Requisito                                                                                                                                          | Situação   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-031 | Permitir à arbitragem registrar e atualizar as ocorrências e métricas do jogo e dos atletas durante a partida.                                     | Confirmado |
| RF-032 | Exigir a identificação do atleta ao registrar um gol e atualizar automaticamente o placar do clube que ele representa.                             | Confirmado |
| RF-033 | Apresentar métricas próprias de cada jogo e o histórico de desempenho de cada atleta a partir de suas participações.                               | Confirmado |
| RF-034 | Permitir à arbitragem corrigir ou desfazer lançamentos durante o jogo, preservando o registro da correção.                                         | Confirmado |
| RF-035 | Permitir à arbitragem encerrar o jogo.                                                                                                             | Confirmado |
| RF-036 | Permitir somente ao presidente corrigir os dados após o encerramento, diretamente, sem devolver o acesso à arbitragem.                             | Confirmado |
| RF-037 | Representar provisoriamente placar por clube, gols por atleta, cartões amarelos, exclusões de dois minutos e cartões vermelhos, com prefixo temp_. | Provisório |

### 3.6. Suspensões

| ID     | Requisito                                                                                                                           | Situação                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| RF-038 | Permitir ao presidente suspender manualmente um atleta em um campeonato, informando a quantidade de jogos.                          | Confirmado                            |
| RF-039 | Prever aplicação automática de suspensão a partir de penalidades, conforme critérios ainda a confirmar com o cliente.               | Confirmado; critérios pendentes       |
| RF-040 | Verificar impedimentos disciplinares no credenciamento e impedir participação quando houver suspensão a cumprir naquele campeonato. | Confirmado                            |
| RF-041 | Registrar os jogos que contam para cumprimento da suspensão e apurar quantos ainda faltam.                                          | Confirmado                            |
| RF-042 | Registrar minimamente presidente responsável e data na aplicação manual; detalhar auditoria completa em etapa posterior.            | Proposto; auditoria completa pendente |

## 4. Regras de negócio

### 4.1. Identidade e vínculos

| ID     | Regra                                                                                                                                               | Situação   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RN-001 | Cada pessoa possui exatamente um perfil: atleta, técnico ou presidente. Os perfis não são acumuláveis.                                              | Confirmado |
| RN-002 | Atleta e técnico solicitam sua própria verificação; a aprovação é atribuição do presidente.                                                         | Confirmado |
| RN-003 | Atleta deve pertencer a exatamente um clube atual, inclusive no cadastro inicial.                                                                   | Confirmado |
| RN-004 | Clube possui no máximo um técnico; técnico pertence a no máximo um clube. Ambos podem ficar temporariamente sem essa associação.                    | Confirmado |
| RN-005 | Somente presidente pode transferir atleta, atribuir técnico ou substituir o técnico do clube.                                                       | Confirmado |
| RN-006 | Transferência de atleta é impedida enquanto seu clube atual participar de campeonato em andamento.                                                  | Confirmado |
| RN-007 | Cadastro inicial em clube participante de campeonato em andamento é permitido e não é tratado como transferência.                                   | Confirmado |
| RN-008 | Transferência não altera o clube representado nos jogos anteriores nem seu histórico de desempenho.                                                 | Confirmado |
| RN-009 | Escolha anterior à transferência não autoriza credenciamento pelo clube antigo; credenciamento já realizado preserva sua validade histórica.        | Confirmado |
| RN-010 | Não há entidade Equipe ou lista fixa de elenco por campeonato na primeira versão. O clube é representado pelos atletas credenciados para cada jogo. | Confirmado |

### 4.2. Carteirinha, escolhas e credenciamento

| ID     | Regra                                                                                                                                                                         | Situação   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RN-011 | Carteirinha é identificação permanente do atleta, reutilizada entre jogos, e só é emitida após aprovação.                                                                     | Confirmado |
| RN-012 | Técnico não possui carteirinha nesta versão.                                                                                                                                  | Confirmado |
| RN-013 | Invalidar carteirinha não bloqueia a conta e não invalida participação em jogo no qual o atleta já foi credenciado; impede novos credenciamentos enquanto estiver invalidada. | Confirmado |
| RN-014 | Escolha do técnico é preliminar: não garante credenciamento nem comprova entrada em quadra.                                                                                   | Confirmado |
| RN-015 | Após o início do jogo, a arbitragem pode incluir atletas válidos, inclusive atrasados e não escolhidos previamente.                                                           | Confirmado |
| RN-016 | Credenciamento exige atleta aprovado, carteirinha ativa, vínculo com um dos clubes do jogo e ausência de suspensão a cumprir naquele campeonato.                              | Confirmado |
| RN-017 | Confirmação manual também deve aplicar as validações de elegibilidade; ela não é uma exceção às regras.                                                                       | Confirmado |
| RN-018 | Não haverá validações específicas de idade, sexo ou outros critérios de categoria na primeira versão.                                                                         | Confirmado |
| RN-019 | Número da camisa pertence à participação naquele jogo e deve ser único entre os atletas do mesmo clube na partida.                                                            | Confirmado |
| RN-020 | Atleta credenciado que ficou no banco deve ser distinguido de atleta que efetivamente entrou em quadra.                                                                       | Confirmado |
| RN-021 | Registrar a entrada em quadra uma vez é suficiente; tempo jogado e controle de substituições estão fora desta versão.                                                         | Confirmado |

### 4.3. Competições e arbitragem

| ID     | Regra                                                                                                                                                                                                                                         | Situação   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RN-022 | Cada campeonato tem uma única categoria; cada jogo é disputado por dois clubes distintos inscritos naquele campeonato.                                                                                                                        | Confirmado |
| RN-023 | O presidente cria campeonatos e jogos e designa sua arbitragem.                                                                                                                                                                               | Confirmado |
| RN-024 | Vários árbitros podem atuar no mesmo jogo; não é necessário perfil permanente de juiz.                                                                                                                                                        | Confirmado |
| RN-025 | Na entrada sem senha de usuário autenticado e designado, atleta ou técnico que arbitra não pode pertencer a nenhum dos clubes envolvidos. Na entrada pela senha compartilhada, dispensar essa conferência, mesmo que a pessoa tenha cadastro. | Confirmado |
| RN-026 | Para árbitro externo, confiar na indicação/autorização; não há verificação automática de vínculo com clube.                                                                                                                                   | Confirmado |
| RN-027 | Ter conta não concede acesso sem senha: é necessário estar autenticado e designado para aquele jogo.                                                                                                                                          | Confirmado |
| RN-028 | A senha é compartilhada, específica do jogo e gerada automaticamente na primeira emissão e no adiamento. Trocas manuais seguem as permissões da seção 10.                                                                                      | Confirmado |
| RN-029 | Linha e banco diferem apenas na tela apresentada.                                                                                                                                                                                             | Confirmado |
| RN-030 | Não é necessário distinguir qual árbitro fez cada lançamento.                                                                                                                                                                                 | Confirmado |
| RN-031 | Encerramento do jogo expira o acesso temporário. Correções posteriores são feitas pelo presidente, sem reabertura para arbitragem.                                                                                                            | Confirmado |

### 4.4. Resultados e histórico

| ID     | Regra                                                                                                             | Situação   |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| RN-032 | Todo gol deve identificar o atleta responsável; não se lança gol diretamente para clube sem identificar o atleta. | Confirmado |
| RN-033 | O gol individual deve refletir automaticamente no placar do clube representado naquele jogo.                      | Confirmado |
| RN-034 | Correções de lançamentos devem preservar o registro do que foi corrigido.                                         | Confirmado |
| RN-035 | Métricas inventadas para a primeira versão usam prefixo temp_, nunca sufixo. A lista final depende do cliente.    | Confirmado |
| RN-036 | Histórico do atleta resulta dos registros de cada jogo e deve continuar preservado após mudanças de clube.        | Confirmado |

### 4.5. Disciplina

| ID     | Regra                                                                                                                                                              | Situação   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| RN-037 | Suspensão é cumprida por quantidade de jogos, inclusive quando aplicada manualmente.                                                                               | Confirmado |
| RN-038 | Suspensão afeta apenas o campeonato em que foi aplicada.                                                                                                           | Confirmado |
| RN-039 | Cada jogo efetivamente realizado pelo clube do atleta naquele campeonato, após a aplicação, conta para cumprimento, mesmo sem o atleta ser escolhido pelo técnico. | Confirmado |
| RN-040 | Jogos cancelados não contam; jogos adiados só contam quando realizados.                                                                                            | Confirmado |
| RN-041 | Suspensão automática passa a valer para os jogos seguintes, após o encerramento do jogo que originou a punição. O próprio jogo de origem não cumpre a suspensão.   | Confirmado |
| RN-042 | Não ativar regras automáticas com critérios inventados antes de sua validação pelo cliente.                                                                        | Proposto   |
| RN-043 | Não presumir soma nem cumprimento paralelo de suspensões simultâneas: o tratamento ainda depende de decisão.                                                       | Pendente   |

A exceção da RN-025 é deliberada: a senha compartilhada permite acesso sem conferir vínculo com os
clubes. O cadastro da pessoa não elimina essa exceção.

## 5. Requisitos não funcionais

Os requisitos abaixo derivam das necessidades levantadas e das escolhas técnicas da modelagem. Os 12
RNFs foram aprovados por Marcus em 04/11/2026. Não foram acordadas metas numéricas de desempenho,
disponibilidade ou capacidade.

| ID      | Requisito                                                                                                             | Verificação esperada                                                                                          | Situação   |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| RNF-001 | Aplicar autorização no servidor por perfil, clube e jogo, em todas as operações protegidas.                           | Requisições diretas sem permissão são recusadas, mesmo sem passar pela interface.                             | Confirmado |
| RNF-002 | Proteger senhas e credenciais temporárias; não persistir senha compartilhada em texto puro e não incluí-la em logs.   | Inspeção de armazenamento e logs não revela a senha; a validação usa hash apropriado para senhas.             | Confirmado |
| RNF-003 | Revalidar acesso temporário, disponibilidade por data e status do jogo em operações da arbitragem.                    | Sessões invalidadas por encerramento, adiamento, cancelamento ou troca de senha não continuam operando.       | Confirmado |
| RNF-004 | Impedir que o QR code da carteirinha conceda permissões administrativas ou substitua a autenticação da arbitragem.    | Possuir apenas o QR não permite credenciar terceiros nem alterar dados.                                       | Confirmado |
| RNF-005 | Preservar integridade de vínculos, inscrições e participações, inclusive em operações simultâneas.                    | Não se criam dois clubes atuais para o atleta, dois técnicos no clube ou camisa repetida no mesmo clube/jogo. | Confirmado |
| RNF-006 | Garantir consistência entre gol, placar e desempenho do atleta.                                                       | Uma gravação ou correção não deixa apenas parte dos totais atualizada.                                        | Confirmado |
| RNF-007 | Evitar duplicação por repetição de QR, reenvio da mesma operação e processamento repetido do encerramento.            | A mesma solicitação não duplica credenciamento, gol, suspensão automática ou jogo cumprido.                   | Confirmado |
| RNF-008 | Preservar histórico esportivo e rastreabilidade mínima das correções.                                                 | Corrigir lançamento permite identificar o registro anterior; transferir atleta não reescreve jogos antigos.   | Confirmado |
| RNF-009 | Manter uma definição consistente das métricas por jogo e dos totais históricos.                                       | Os totais históricos correspondem aos registros válidos dos jogos, sem contagem de lançamentos anulados.      | Confirmado |
| RNF-010 | Assegurar que cadastro próprio não permita autoaprovação, emissão de carteirinha ou obtenção do perfil de presidente. | Alteração de parâmetros pelo solicitante não eleva privilégios.                                               | Confirmado |
| RNF-011 | Permitir uso concorrente por múltiplos árbitros sem perder atualizações válidas.                                      | Lançamentos simultâneos são preservados e conflitos de correção são tratados explicitamente.                  | Confirmado |
| RNF-012 | Restringir o acesso aos dados pessoais e às funções esportivas ao necessário para cada operação.                      | Carteirinha/QR e telas de arbitragem não expõem credenciais ou dados cadastrais sem finalidade operacional.   | Confirmado |

Não foram levantados requisitos de operação offline, navegadores/dispositivos suportados,
acessibilidade mensurável, exportação, backup/restauração, retenção de dados, volume de usuários,
tempo máximo de resposta ou disponibilidade. Esses temas não devem ser tratados como compromissos já
assumidos. Exportação, doações e patrocínios aparecem nas anotações iniciais, mas não foram
detalhados nem aprovados nas rodadas que originaram este documento.

## 6. Métricas provisórias

| Contexto                      | Identificadores provisórios                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- |
| Placar do jogo                | temp_placarClubeA, temp_placarClubeB                                              |
| Desempenho individual no jogo | temp_gols, temp_cartoesAmarelos, temp_exclusoesDoisMinutos, temp_cartoesVermelhos |

A confirmação de registrar gols atribuídos a atletas não confirma a lista completa de métricas ou as
regras oficiais de handebol. Em particular, registrar uma penalidade não define, por si só, o
critério para gerar suspensão automática.

## 7. Pendências e perguntas de esclarecimento

O levantamento consolidado, incluindo casos específicos e ordem sugerida de resolução, está em
[pendencias.md](pendencias.md). A tabela abaixo preserva as pendências da primeira rodada.

| ID      | Questão                                                                                                            | Situação/impacto                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| PEN-001 | A página da arbitragem deve abrir antes do início formal para credenciar os atletas?                               | Resolvido: sim; abrir credenciamento antes e iniciar a partida depois (RF-030). |
| PEN-002 | Para usuário cadastrado que entra por senha, verificar igualmente o impedimento de pertencer a clube participante? | Resolvido: não; acesso por senha dispensa essa conferência (RN-025).            |
| PEN-003 | Quais métricas serão efetivamente utilizadas?                                                                      | Aguardando cliente; manter temp_.                                               |
| PEN-004 | Quais penalidades, limites de acumulação e quantidades de jogos geram suspensão automática?                        | Aguardando cliente; automática prevista, critérios não habilitados.             |
| PEN-005 | O presidente continuará incluindo os clubes no campeonato?                                                         | Operação provisória expressamente adotada; aguarda confirmação do cliente.      |
| PEN-006 | Como tratar múltiplas suspensões, revisões posteriores e cancelamento de punições?                                 | Não definido; não presumir acumulação.                                          |
| PEN-007 | Quais ações, autores, alterações e justificativas integram a auditoria completa?                                   | Necessidade reconhecida; detalhamento adiado por solicitação de Marcus.         |
| PEN-008 | Quais campos compõem a ficha cadastral e quais são obrigatórios?                                                   | Usar os campos mínimos essenciais provisoriamente; confirmar a ficha com o cliente. |

A conclusão da primeira versão documental não significa que as funcionalidades com critérios
pendentes estejam prontas para implementação completa.

## 8. Rastreabilidade das decisões

| Rodada/tema                 | Decisão principal                                                               | Requisitos relacionados                  |
| --------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| Proposta inicial            | Usuario como base, sem Equipe, clubes em campeonatos e métricas por jogo/atleta | RN-001, RN-010, RN-022, RF-033           |
| Perfis e aprovação          | Um perfil, autocadastro de atleta/técnico, aprovação e novos presidentes        | RF-001 a RF-008, RN-001 a RN-003         |
| Clubes e revisão do cliente | Um técnico por clube, com ausência temporária permitida                         | RF-009 a RF-012, RN-004 a RN-009         |
| Carteirinhas                | Somente atleta; invalidar/reativar sem bloquear conta                           | RF-004 a RF-006, RN-011 a RN-013         |
| Escolha e credenciamento    | Arbitragem confirma, inclui atrasados e atletas fora da escolha                 | RF-016 a RF-023, RN-014 a RN-021         |
| Árbitros                    | Vários, linha/banco, usuário designado ou senha compartilhada                   | RF-024 a RF-030, RN-024 a RN-031         |
| Resultados                  | Gol identificado, correções durante/depois do jogo e histórico                  | RF-031 a RF-037, RN-032 a RN-036         |
| Punições                    | Manual/automática, por jogos e campeonato; transferência bloqueada              | RF-038 a RF-042, RN-006, RN-037 a RN-043 |

## 9. Decisões complementares — 06/11/2026

A [arquitetura aprovada](arquitetura.md) consolida as decisões estruturais. Para o produto:

- Login por e-mail e senha, sem exigir confirmação de e-mail antes da aprovação esportiva.
- Recuperação de senha por link enviado ao e-mail.
- Múltiplos dispositivos permitidos para contas e acessos de arbitragem.
- Atualizações imediatas entre as telas dos árbitros autorizados ao jogo.
- Interface responsiva, priorizando navegador no celular, com leitura de QR pela câmera.
- Internet obrigatória; funcionamento offline não faz parte desta versão.
- Armazenamento apenas de fotos dos atletas; não haverá envio de documentos para verificação.
- Dois ambientes, teste e produção, com implantação online de teste para demonstrações.

Essas decisões complementam os requisitos existentes; a definição dos demais campos cadastrais,
das métricas, das regras disciplinares e das metas operacionais permanece pendente.

## 10. Acesso da arbitragem e início do desenvolvimento — 07/11/2026

Decisões confirmadas por Marcus nesta rodada:

- A arbitragem acessa somente no dia marcado para o jogo, por conta autenticada e designação
  ou por nome completo e senha do jogo. Não há etapa manual de liberação. Credenciar antes
  da partida e iniciar o jogo continuam sendo ações distintas.
- Somente presidente pode adiar ou cancelar; ambas as ações invalidam imediatamente todas
  as sessões temporárias do jogo. Adiar gera nova senha, e o acesso depende da nova data.
- A primeira senha é automática. Somente presidente ou árbitro autenticado pela própria conta
  e previamente designado para aquele jogo pode solicitar troca manual. Entrar por nome e senha
  não concede essa permissão, mesmo para pessoa cadastrada.
- Troca manual invalida todas as sessões abertas pela senha anterior, exigindo nova entrada;
  preserva sessões por conta e designação. Não haverá retirada individual de acesso por senha.
- Contas permanentes e acessos a outros jogos permanecem válidos nessas operações.
- Fuso da data, partidas que atravessam meia-noite e distribuição da senha ainda precisam de
  esclarecimento antes de implementar os comportamentos correspondentes (PEN-021).
- Campos cadastrais mínimos necessários aos fluxos aprovados serão usados provisoriamente,
  com confirmação posterior do cliente (PEN-008). Não acrescentar dados pessoais sem necessidade.
- Serviço de e-mail e recuperação de senha estão adiados nesta etapa, incluindo sua prova;
  a recuperação por link permanece prevista para implementação posterior.
- Somente teste será provisionado agora. Produção será criada ao concluir a aplicação;
  backup/restauração será detalhado posteriormente (PEN-026).

Os contratos de API/eventos serão definidos tecnicamente em código, com API documentada em
OpenAPI. Isso não autoriza decidir regras de produto ainda pendentes, como conflitos visíveis
ao usuário (PEN-023). As escolhas de ferramentas e hospedagem estão na [arquitetura](arquitetura.md).
