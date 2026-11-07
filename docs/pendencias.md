# Pendências — gestão de handebol

Atualizado em 07/11/2026.

Resumo das confirmações com o cliente, lacunas de requisitos e casos específicos ainda sem decisão.
Referências: [requisitos](requisitos.md) e [modelagem](modelo-banco-dados.md).

Os IDs PEN-003 a PEN-008 preservam a identificação usada em requisitos.md. Os demais identificam
lacunas adicionais encontradas na revisão; são perguntas, não funcionalidades aprovadas ou
obrigações de implementar. Os responsáveis indicados são sugestões para conduzir o esclarecimento.

## 1. Confirmações com o cliente

| ID      | Pendência e decisão necessária                                                                                                                            | Impacto / situação vigente                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-003 | Confirmar métricas por jogo e atleta: quais dados registrar, definições e forma de cálculo.                                                               | Manter os campos provisórios com prefixo temp_. Placar, gols, cartões amarelos/vermelhos e exclusões de dois minutos são a proposta atual, não a lista definitiva. RF-037.                     |
| PEN-004 | Definir regras de suspensão automática: penalidades consideradas, limites, período de acumulação, quantidade de jogos e eventual reinício da contagem.    | A funcionalidade foi solicitada, mas os critérios não podem ser inventados. Regras automáticas permanecem inativas até confirmação. RF-039 e RN-041/RN-042.                                    |
| PEN-005 | Confirmar se o presidente continuará incluindo os clubes participantes dos campeonatos.                                                                   | É o procedimento provisoriamente adotado. Se houver inscrição pelo próprio clube, definir quem solicita, quem aprova e os prazos. RF-014.                                                      |
| PEN-008 | Definir ficha cadastral e dados obrigatórios de atletas, técnicos, clubes e competições; dados exibidos na carteirinha e elementos usados na verificação. | Usar provisoriamente os campos mínimos essenciais aos fluxos já definidos e confirmar depois com o cliente. Sem documentos; somente fotos de atletas. Edição e efeitos na aprovação continuam pendentes. RF-001 a RF-005. |

## 2. Regras disciplinares e efeitos posteriores

Condução sugerida: Marcus com o cliente.

| ID      | Caso em aberto                                                                                                                    | Decisão necessária                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-006 | Mais de uma suspensão para o mesmo atleta no mesmo campeonato, inclusive por decisão manual ou revisão de jogo anterior.          | Definir se acumula, substitui ou cumpre em paralelo. Não presumir uma dessas opções. RN-043.                                                                                             |
| PEN-009 | Presidente corrige ou cancela punição; um cartão é removido depois que gerou suspensão ou depois que o atleta cumpriu parte dela. | Definir quem autoriza, justificativa, recálculo e efeitos sobre jogos já realizados e atletas que deixaram de jogar.                                                                     |
| PEN-010 | Campeonato termina ou é cancelado antes de o atleta cumprir todos os jogos.                                                       | Definir destino do saldo: extinguir, manter registrado sem bloquear ou outra regra. A restrição atual vale apenas naquele campeonato; não transportar automaticamente para outra edição. |
| PEN-011 | Suspensão manual é aplicada depois do credenciamento, antes da entrada em quadra ou durante a partida.                            | Definir quando o impedimento começa e se a elegibilidade deve ser revalidada. A exceção já aprovada para invalidação de carteirinha não resolve automaticamente o caso de suspensão.     |
| PEN-012 | Jogo é interrompido, abandonado, decidido por ausência de um clube ou invalidado depois de encerrado.                             | Definir se conta como realizado para cumprimento de suspensão e como tratar resultado/estatísticas. Cancelamento simples já está definido: não conta.                                    |

## 3. Operação de contas, clubes e competições

Condução sugerida: Marcus com o cliente.

| ID      | Caso em aberto                                                                                                             | Decisão necessária                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-013 | Cadastro rejeitado, solicitação corrigida ou aprovação posteriormente retirada.                                            | Definir motivo de rejeição, nova solicitação, edição dos dados e efeitos da retirada da aprovação. Invalidar carteirinha é uma operação já definida, distinta desse caso.                                 |
| PEN-014 | Pessoa precisa trocar de perfil, por exemplo atleta que passa a ser técnico ou presidente.                                 | Definir se a mudança será permitida, quem autoriza e como preservar histórico. A exclusividade de um perfil por vez permanece aprovada.                                                                   |
| PEN-015 | Sucessão de presidente e desativação de contas.                                                                            | Definir quem desativa outro presidente, como evitar ausência de responsável administrativo e quais efeitos a desativação tem sobre participações e designações existentes.                                |
| PEN-016 | Clube precisa ser retirado do campeonato, desativado ou alterado depois de possuir jogos e credenciamentos.                | Definir permissões, prazo e tratamento dos jogos/histórico. Não presumir exclusão de registros históricos.                                                                                                |
| PEN-017 | Atleta troca de clube após sua participação no campeonato terminar, mas o campeonato como um todo ainda está em andamento. | A regra atual bloqueia a transferência enquanto o clube atual participar de campeonato em andamento. Confirmar se haverá exceção para clube eliminado/desistente; até lá, manter o bloqueio aprovado.     |
| PEN-018 | Troca do técnico depois de ele escolher jogadores ou clube sem técnico no dia da partida.                                  | Definir se o novo técnico pode revisar a escolha anterior e se o presidente pode fazer a escolha preliminar. A arbitragem já pode credenciar atletas válidos fora da lista, inclusive sem escolha prévia. |

## 4. Credenciamento, carteirinha e arbitragem

Condução sugerida: Marcus com o cliente para as regras; equipe técnica para o mecanismo.

| ID      | Caso em aberto                                                                                         | Decisão necessária                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-019 | Credenciamento incorreto ou número da camisa errado, inclusive após entrada em quadra ou encerramento. | Definir correção/estorno, responsáveis e preservação do histórico. A unicidade da camisa por clube e jogo continua obrigatória.                                                                                                         |
| PEN-020 | QR code copiado, identificação perdida ou necessidade de substituir a carteirinha.                     | Definir conferência de identidade na entrada, possibilidade de trocar o código e tratamento da credencial antiga. A leitura automática para atleta válido já foi aprovada; não introduzir conferência manual obrigatória por suposição. |
| PEN-021 | Disponibilidade da página da arbitragem.                                                              | Parcialmente resolvido: acesso apenas no dia marcado, sem liberação manual. Só presidente adia/cancela, invalidando todas as sessões; adiamento gera nova senha e acesso depende da nova data. Faltam fuso do dia, partidas atravessando meia-noite e distribuição da senha. |
| PEN-022 | Troca da senha compartilhada e retirada de acesso.                                                    | Resolvido em 07/11/2026: primeira senha automática; troca manual por presidente ou conta autenticada e designada. Entrada por nome/senha não permite troca. Trocar revoga todas as sessões por senha, preserva designadas; sem retirada individual. |
| PEN-023 | Vários árbitros tentam iniciar/encerrar o jogo ou corrigir o mesmo lançamento simultaneamente.         | Definir comportamento visível para conflito e confirmação de encerramento. A solução técnica deve evitar perda/duplicação; não criar hierarquia entre linha e banco sem nova decisão.                                                   |

## 5. Auditoria e requisitos técnicos a detalhar

| ID      | Pendência                                               | Próxima decisão / condução sugerida                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-007 | Auditoria completa das ações manuais e administrativas. | Definir ações auditadas, autoria, valores anteriores/novos, justificativas, consulta e retenção. Necessidade reconhecida, detalhamento adiado. Não reabrir a decisão de dispensar identificação individual de lançamentos entre árbitros. Marcus + equipe técnica.        |
| PEN-024 | Aceitação dos 12 RNFs.                                  | Resolvido: RNF-001 a RNF-012 aprovados por Marcus em 04/11/2026. As metas operacionais não definidas continuam em PEN-025/PEN-026.                                                                                                                                        |
| PEN-025 | Condições de uso e metas de qualidade.                  | Celular prioritário, câmera para QR, internet obrigatória e tempo real aprovados; modo offline descartado. Definir navegadores, acessibilidade, capacidade, tempo de resposta e disponibilidade. Não há metas numéricas acordadas. Cliente + equipe técnica.              |
| PEN-026 | Dados pessoais e recuperação operacional.               | Definir acesso, retenção/remoção de dados e histórico após desativação. Backup/restauração adiado por Marcus nesta etapa; não bloqueia início local. Não há prazos ou metas de recuperação acordados. Marcus + equipe técnica. |

## 6. Itens das anotações iniciais ainda sem escopo confirmado

| ID      | Tema                                                                      | O que falta                                                                                                                              |
| ------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-027 | Exportação de informações em PDF ou outros formatos.                      | Confirmar entrada na primeira versão, documentos, campos e quem pode exportar.                                                           |
| PEN-028 | Doações, patrocínios e divulgação pública de resultados.                  | Confirmar se fazem parte do produto e de qual etapa; não integram o escopo detalhado nas rodadas atuais.                                 |
| PEN-029 | Diferenças entre clubes de liga/regionais e abrangências das competições. | Esclarecer se alteram cadastro, acesso ou regras. A anotação inicial é insuficiente para criar classificações e restrições obrigatórias. |

Origem desses três itens: [definições iniciais](definicoes-iniciais.md). Eles não devem ser tratados como compromissos já
aprovados.

## 7. Ordem sugerida de resolução

1. Confirmar métricas e critérios automáticos (PEN-003/PEN-004), ficha cadastral e inclusão de clubes (PEN-008/PEN-005).
2. Fechar exceções disciplinares (PEN-006 e PEN-009 a PEN-012), principalmente impedimento após credenciamento.
3. Resolver correção de credenciamento, detalhes residuais de data/distribuição e conflitos
   (PEN-019 a PEN-021 e PEN-023). Troca de senha (PEN-022) esclarecida.
4. Resolver ciclo de contas e clubes (PEN-013 a PEN-018).
5. Detalhar auditoria e condições operacionais (PEN-007, PEN-025 e PEN-026); a aprovação dos RNFs está concluída.
6. Decidir o escopo dos pedidos históricos (PEN-027 a PEN-029).

As pendências bloqueiam apenas a definição completa dos comportamentos afetados; não impedem
continuar as partes já acordadas.

## 8. Decisões já encerradas

Não são pendências:

- PEN-024: os 12 RNFs foram aprovados por Marcus em 04/11/2026.
- PEN-022: geração e troca de senha, permissões e revogação definidas em 07/11/2026;
  detalhes em [requisitos, seção 10](requisitos.md#10-acesso-da-arbitragem-e-início-do-desenvolvimento--07112026).

- PEN-001: a página abre antes da partida para credenciamento, e a arbitragem inicia o jogo depois.
- PEN-002: entrada por senha dispensa conferir vínculo com os clubes, inclusive para pessoa cadastrada.
  A conferência continua no acesso sem senha de usuário autenticado e designado.
- Há um único perfil por pessoa; clube tem no máximo um técnico e pode ficar sem técnico.
- Não há carteirinha de técnico nem entidade Equipe.
- Atleta atrasado ou fora da lista do técnico pode ser credenciado se for elegível.
- Número da camisa é definido por jogo no credenciamento e não se repete no mesmo clube.
- Não haverá validação específica de idade/sexo nesta versão nem medição de tempo jogado.
- Invalidar carteirinha afeta novos credenciamentos, sem bloquear conta ou invalidar credenciamento anterior.
- Após encerramento, somente presidente corrige os dados, sem reabrir acesso para arbitragem.

## 9. Atualizações da arquitetura — 06/11/2026

Decisões registradas em [arquitetura.md](arquitetura.md):

- PEN-008 parcialmente esclarecida: apenas fotos de atletas; nenhum documento será enviado
  para verificação. Em 07/11/2026, autorizado usar campos mínimos provisórios até confirmação
  com o cliente; os demais campos e critérios de aprovação continuam em aberto.
- PEN-025 parcialmente esclarecida: interface responsiva, celular prioritário, QR por câmera,
  internet obrigatória e atualizações imediatas. Não há modo offline. Múltiplos dispositivos
  são permitidos. Capacidade, navegadores suportados e metas operacionais ainda não foram definidos.
- Há somente dois ambientes planejados, teste e produção; teste terá implantação online para
  demonstrações. Criar somente teste agora; produção ao concluir a aplicação.

As menções anteriores a documentos e eventual modo offline são perguntas agora resolvidas,
não opções ainda em avaliação. Situação atualizada das decisões técnicas em 07/11/2026:

- PEN-030: escolha documental concluída em 07/11/2026 — Better Auth com Prisma/PostgreSQL,
  tabelas `AuthUser`, `AuthAccount`, `AuthSession`, `AuthVerification` e `SessaoArbitragem` própria.
  Prova local parcial concluída: versões fixadas, migrações/seed, cadastro atômico com falhas e
  repetição concorrente, cookies/CSRF/CORS, sessões persistidas e replays paralelos após logout
  HTTP validados. Client não usa SSR de sessão; será preciso validar seu repasse de cookies/cache
  quando introduzido. Arbitragem temporária, concorrência com escritas esportivas e revogação
  Socket.IO continuam fora da entrega, assim como TLS/proxy/cookies hospedados. Recuperação e prova
  de reset seguem adiadas. A escolha está encerrada; a PEN-030 **não está totalmente encerrada**.
  Regras atuais da arbitragem substituem as pendências
  históricas da conclusão: PEN-022 resolvida; PEN-021 com detalhes residuais.
- PEN-031 parcialmente resolvida: Vercel para frontend, Render para backend e Supabase para banco
  e fotos; usar franquia gratuita de armazenamento nesta etapa, conferindo limites antes de provisionar.
  Serviço de e-mail adiado. Faltam limites/permissões das fotos e configurações de implantação;
  produção e custos correspondentes serão avaliados posteriormente.
- PEN-032 parcialmente resolvida: npm e lockfile versionado, versões estáveis recentes compatíveis,
  preferência por Node.js LTS e scripts convencionais. Estrutura mínima de `client/` e `server/`
  criada em 07/11/2026, com pacotes/lockfiles independentes e matriz na arquitetura. PostgreSQL
  17.11 iniciado e consultado em Docker Compose, com volume persistente. Scripts de desenvolvimento,
  lint, tipos e build definidos no README. Prisma 7.10.1 e Better Auth/adaptador 1.7.18 fixados
  e validados juntos; três migrações aplicadas e seed fictício reproduzível. Onze testes de integração,
  navegador e lint/tipos/build aprovados. Node/npm executados: 26.8.2/12.2.0; patches-alvo ainda não.
  Conexão hospedada direta ou Session Pooler conforme rede. Faltam alinhamento à versão do Supabase
  provisionado e detalhes de implantação; produção permanece adiada. Alertas moderados de ferramentas
  de lint e a limitação de suporte do ESLint 9 continuam registrados na arquitetura.
- PEN-033: equipe define os contratos em código/OpenAPI e detalha eventos, reconexão, publicação
  após transação e conflitos. Não exige questionário técnico ao usuário; decisões de comportamento
  ainda indefinidas, inclusive PEN-023, precisam ser esclarecidas.
