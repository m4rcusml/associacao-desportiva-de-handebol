# Pendências — gestão de handebol

Atualizado em 09/11/2026.

Resumo das confirmações com o cliente, lacunas de requisitos e casos específicos ainda sem decisão.
Referências: [requisitos](requisitos.md) e [modelagem](modelo-banco-dados.md).

Os IDs PEN-003 a PEN-008 preservam a identificação usada em requisitos.md. Os demais identificam
lacunas adicionais encontradas na revisão; são perguntas, não funcionalidades aprovadas ou
obrigações de implementar. Os responsáveis indicados são sugestões para conduzir o esclarecimento.

## 1. Confirmações com o cliente

| ID      | Pendência e decisão necessária                                                                                                                            | Impacto / situação vigente                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-003 | Confirmar métricas por jogo e atleta: quais dados registrar, definições e forma de cálculo.                                                               | Manter os campos provisórios com prefixo temp_. Placar, gols, cartões amarelos/vermelhos e exclusões de dois minutos são a proposta atual, não a lista definitiva. RF-037.                     |
| PEN-004 | Definir regras de suspensão automática: penalidades consideradas, limites, período de acumulação, quantidade de jogos e eventual reinício da contagem.    | Resolvida por Marcus em 09/11/2026 (MAR-78). Critérios em requisitos, seção 12; implementação/validação na MAR-79, ainda sem regras automáticas ativas.                                    |
| PEN-005 | Confirmar se o presidente continuará incluindo os clubes participantes dos campeonatos.                                                                   | É o procedimento provisoriamente adotado. Se houver inscrição pelo próprio clube, definir quem solicita, quem aprova e os prazos. RF-014.                                                      |
| PEN-008 | Ficha cadastral final, dados da carteirinha e critérios de verificação. | Parcial: campos mínimos provisórios autorizados; foto opcional e edição sem nova aprovação definidos em requisitos, seção 11. Campos finais e critérios do cliente continuam pendentes. |

## 2. Regras disciplinares e efeitos posteriores

Condução sugerida: Marcus com o cliente.

| ID      | Caso em aberto                                                                                                                    | Decisão necessária                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-006 | Suspensões simultâneas no mesmo campeonato. | Resolvido: cumprir em paralelo, inclusive manual com automática. Requisitos, seção 11. |
| PEN-009 | Revogação, redução parcial e recálculo de suspensão. | Parcial: presidente revoga com histórico; correção de penalidade recalcula automática sem compensar ausências ou alterar jogos passados. Redução parcial e justificativa obrigatória ainda pendentes. |
| PEN-010 | Saldo ao terminar/cancelar campeonato. | Resolvido: encerrar saldo e preservar histórico, sem transportar. Requisitos, seção 11. |
| PEN-011 | Nova suspensão depois do credenciamento. | Resolvido: preservar participação no jogo já credenciado; impedimento vale para próximos jogos. |
| PEN-012 | Jogos interrompidos, abandonados, W.O. ou invalidados. | Resolvido: cumprimento uma vez no encerramento definitivo; preservar estatísticas/placar; vencedor separado. Adiados/cancelados não contam enquanto não realizados. Requisitos, seção 11; representação e permissões detalhadas na MAR-72. |

## 3. Operação de contas, clubes e competições

Condução sugerida: Marcus com o cliente.

| ID      | Caso em aberto                                                                                                             | Decisão necessária                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-013 | Rejeição, reapresentação e retirada de aprovação. | Resolvido: rejeição sem motivo obrigatório, nova solicitação na mesma conta e edição sem nova aprovação. Não haverá retirada de aprovação. |
| PEN-014 | Troca de perfil. | Resolvido para esta versão: não permitir. Um perfil por pessoa permanece. |
| PEN-015 | Desativação/reativação de contas e sucessão. | Resolvido: presidente administra outras contas, sem apagar histórico e sem desativar o último presidente ativo. Efeitos em requisitos, seção 11; criação segue RF-007. |
| PEN-016 | Alteração de clube e retirada de inscrição. | Resolvido: editar nome/cidade; retirar inscrição somente sem jogos. Sem exclusão/desativação de clubes. Preservar histórico. |
| PEN-017 | Atleta troca de clube após sua participação no campeonato terminar, mas o campeonato como um todo ainda está em andamento. | A regra atual bloqueia a transferência enquanto o clube atual participar de campeonato em andamento. Confirmar se haverá exceção para clube eliminado/desistente; até lá, manter o bloqueio aprovado.     |
| PEN-018 | Troca de técnico e clube sem técnico. | Resolvido: novo técnico aprovado altera escalação até início; sem técnico, arbitragem credencia diretamente, sem escalação pelo presidente. |

## 4. Credenciamento, carteirinha e arbitragem

Condução sugerida: Marcus com o cliente para as regras; equipe técnica para o mecanismo.

| ID      | Caso em aberto                                                                                         | Decisão necessária                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PEN-019 | Correção/estorno de credenciamento e camisa. | Parcial: camisa corrigível pela arbitragem até encerramento; estorno somente sem entrada/lançamentos (implementados na MAR-71, com correção de camisa pelo presidente após o encerramento). Presidente resolve demais casos, mas procedimento com entrada/lançamentos, elegibilidade e reflexos nas estatísticas ainda pendente. |
| PEN-020 | Perda/cópia do QR e substituição. | Resolvido: presidente substitui QR na mesma carteirinha; anterior deixa de funcionar, credenciamentos preservados. Sem conferência manual obrigatória adicional. |
| PEN-021 | Dia de acesso, meia-noite e distribuição da senha. | Resolvido: fuso do local no backend; conversão visual no frontend. Após meia-noite acesso continua se jogo começou; se não, exigir reagendamento. Presidente e contas designadas consultam senha posteriormente, protegida por criptografia. |
| PEN-022 | Troca da senha compartilhada e retirada de acesso.                                                    | Resolvido em 07/11/2026: primeira senha automática; troca manual por presidente ou conta autenticada e designada. Entrada por nome/senha não permite troca. Trocar revoga todas as sessões por senha, preserva designadas; sem retirada individual. |
| PEN-023 | Início/encerramento e correções simultâneas. | Resolvido: repetição de início/fim informa ação já realizada; segunda correção conflitante recusada com estado atualizado. Um árbitro confirma encerramento. |

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

1. Confirmar métricas definitivas, ficha final e inclusão de clubes com o cliente (PEN-003/PEN-008/PEN-005). Critérios automáticos da PEN-004 já aprovados; implementar na MAR-79.
2. Detalhar correção de credenciamento com entrada/lançamentos e redução parcial de suspensão (PEN-019/PEN-009 residuais).
3. Confirmar eventual exceção de transferência para clube eliminado/desistente (PEN-017); até lá vale o bloqueio aprovado.
4. Detalhar condições operacionais, retenção e auditoria completa (PEN-025/PEN-026/PEN-007), sem reabrir itens já adiados.
5. Decidir escopo dos pedidos históricos (PEN-027 a PEN-029).

As pendências bloqueiam apenas a definição completa dos comportamentos afetados; não impedem
continuar as partes já acordadas.

## 8. Decisões já encerradas

Não são pendências:

- PEN-004: critérios de suspensão automática aprovados por Marcus em 09/11/2026 (MAR-78),
  em [requisitos, seção 12](requisitos.md#12-critérios-de-suspensão-automática--mar-78--09112026).
  A aprovação encerra a decisão; implementação e validação continuam na MAR-79.

- Esclarecimentos desta rodada: PEN-006, PEN-010 a PEN-016, PEN-018, PEN-020, PEN-021 e PEN-023. Regras em [requisitos, seção 11](requisitos.md#11-esclarecimentos-para-o-planejamento-do-backend--07112026). PEN-009/PEN-019 conservam somente os detalhes residuais acima.
- Ciclo manual do campeonato e limites/permissões de fotos foram definidos na mesma seção.

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
  quando introduzido. Arbitragem temporária (MAR-65) validada localmente: cookie separado por jogo,
  revalidação transacional e revogação concorrente com troca de senha, retirada e desativação. Escritas
  esportivas reais e o ciclo do jogo foram validados localmente (MAR-67 a 69), e a revogação Socket.IO em conexões abertas na MAR-73; TLS/proxy/cookies e Socket.IO hospedados continuam fora da entrega. Recuperação e prova
  de reset seguem adiadas. A escolha está encerrada; a PEN-030 **não está totalmente encerrada**.
  Regras atuais da arbitragem substituem as pendências
  históricas da conclusão: PEN-022 e PEN-021 resolvidas.
- PEN-031 parcialmente resolvida: Vercel para frontend, Render para backend e Supabase para banco
  e fotos; usar franquia gratuita de armazenamento nesta etapa, conferindo limites antes de provisionar.
  Serviço de e-mail adiado. Fotos: limites/permissões definidos em requisitos, seção 11; faltam configurações de implantação;
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
  ainda indefinidas precisam ser esclarecidas; PEN-023 foi resolvida nesta rodada. Eventos, publicação após
  a transação e reconexão definidos e validados localmente na MAR-73 (arquitetura); destinatários, conteúdo do
  aviso e motivo da revogação aprovados por Marcus (requisitos, seção 11). Falta validar Socket.IO na
  implantação de teste (MAR-76).
