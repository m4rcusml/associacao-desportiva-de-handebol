# Associação Desportiva de Handebol

## Contexto do projeto

Aplicação para organizar clubes, atletas, campeonatos e jogos de uma associação de handebol. Abrange aprovação de cadastros, carteirinhas de atletas, escalação, credenciamento, arbitragem, resultados e histórico esportivo.

O repositório está na fase de definição de requisitos e modelagem. A arquitetura está planejada; a estrutura da aplicação e a infraestrutura ainda não foram criadas.

O presidente administra cadastros e competições; o técnico escolhe previamente os atletas; a arbitragem credencia os participantes e registra as ocorrências do jogo. Escalação, credenciamento e entrada em quadra são etapas distintas.

### Documentação de referência

Consulte os documentos conforme a tarefa, mantendo as definições detalhadas em suas fontes:

- [README.md](README.md): visão geral, fluxo principal e limites do escopo inicial.
- [docs/requisitos.md](docs/requisitos.md): funcionalidades, regras de negócio e requisitos não funcionais.
- [docs/arquitetura.md](docs/arquitetura.md): tecnologias e decisões técnicas aprovadas.
- [docs/modelo-banco-dados.md](docs/modelo-banco-dados.md): entidades, relacionamentos e restrições.
- [GLOSSARY.md](GLOSSARY.md): vocabulário do domínio a utilizar no código e nas discussões.
- [docs/pendencias.md](docs/pendencias.md): perguntas em aberto e comportamentos provisórios. Consulte antes de implementar uma regra afetada; pendências não são funcionalidades aprovadas.

## Direção do desenvolvimento

- A arquitetura aprovada prevê TypeScript, Next.js em `client/`, NestJS com Express em `server/`, PostgreSQL e Prisma. Frontend e backend terão builds e implantações independentes.
- Regras de negócio e autorização ficam no backend. A interface consome a API REST; Socket.IO notifica mudanças aos dispositivos autorizados após a persistência.
- A interface será responsiva, com prioridade para celular. Credenciamento e registros do jogo exigem internet; o planejamento não inclui modo offline.
- Consulte a arquitetura antes de criar a estrutura ou escolher dependências. Versões, biblioteca de autenticação, fornecedores e comandos de desenvolvimento ainda precisam ser definidos.
- Implemente o escopo solicitado com base nas decisões aprovadas. Se uma pendência afetar a tarefa, esclareça com o usuário antes de decidir esse comportamento.

## Colaboração entre agentes

Este projeto é desenvolvido pelo usuário com Codex, Claude, Antigravity e Kiro. O usuário coordena o trabalho e decide quais informações devem se tornar referência compartilhada.

### Discussões

- Inicie uma discussão entre agentes quando o usuário solicitar.
- Forme seu parecer de maneira independente, com base no pedido, na documentação do projeto e em fontes de pesquisa. Durante os turnos da discussão, não leia os arquivos de respostas dos outros agentes; entre os registros dos demais no tópico, consulte apenas `agents/discuss/[topic]/mediador.md`.
- Escreva sua própria resposta em `agents/discuss/[topic]/[agente].md`, usando `codex.md`, `claude.md`, `antigravity.md` ou `kiro.md`. Para o Codex, o caminho é `agents/discuss/[topic]/codex.md`.
- Em cada turno, registre em `agents/discuss/[topic]/mediador.md` sua opinião sobre quem deve mediar e uma justificativa breve, identificando seu nome. Preserve as entradas dos demais e mantenha esse documento dedicado à escolha do mediador, sem reproduzir os pareceres técnicos.
- Mantenha as contribuições objetivas: posição, justificativa e dúvidas relevantes. Preserve as contribuições dos outros agentes e atribua opiniões aos respectivos autores.
- Se houver dúvida que afete uma resposta ou opinião, pergunte ao usuário antes de se posicionar ou responder aos outros agentes.
- Ao fim de cada discussão, os agentes devem escolher entre si quem liderará como mediador, com base nas posições registradas em `mediador.md`. Registre a escolha nesse documento; uma indicação individual não equivale à escolha coletiva.
- Somente após a escolha, o mediador pode ler as respostas de todos os participantes para reuni-las, analisá-las e tomar a decisão final da discussão. Essa leitura é a exceção à independência dos pareceres. Se houver dúvidas que afetem a decisão, consulte o usuário antes de concluir.
- O mediador registra a decisão final e sua justificativa em `agents/discuss/[topic]/conclusao.md`, preservando os pareceres individuais em seus respectivos arquivos.

### Divisão e execução de tarefas

- Quando o usuário pedir a divisão de trabalho, discutam qual agente é mais adequado para cada tarefa, considerando o escopo, o contexto e as dependências.
- Explicite a distribuição proposta e eventuais divergências. Uma proposta individual não representa acordo dos demais agentes.
- Antes de editar arquivos, confira as alterações em andamento e preserve o trabalho dos outros agentes. Coordene sobreposições antes de modificar o mesmo trecho.

### Fonte da verdade

- Antes de registrar novas decisões ou contexto como referência compartilhada, pergunte ao usuário o que deve ser salvo, apresentando uma proposta curta do conteúdo e do local. Aguarde a aprovação para registrar.
- Os registros de discussão solicitados pelo usuário, incluindo a conclusão do mediador, podem ser escritos diretamente nos caminhos acima. Opiniões individuais são contribuições; a decisão final da discussão cabe ao mediador escolhido. Antes de incorporar essa conclusão à documentação de referência do projeto, confirme com o usuário o que deve ser salvo.
- Salve apenas o conteúdo aprovado e necessário para os demais agentes. Prefira atualizar a referência existente a duplicar informações em novos documentos.

## Git

- Não faça commit de `AGENTS.md` nem de arquivos em `agents/` sem permissão explícita do usuário. Criar ou editar esses arquivos não autoriza seu commit.
