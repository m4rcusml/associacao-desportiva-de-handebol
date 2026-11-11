# Associação Desportiva de Handebol

## Contexto do projeto

Aplicação para organizar clubes, atletas, campeonatos e jogos de uma associação de handebol. Abrange aprovação de cadastros, carteirinhas de atletas, escalação, credenciamento, arbitragem, resultados e histórico esportivo.

O projeto já contém funcionalidades de domínio e interfaces experimentais integradas. Consulte a arquitetura e o README para o estado atual, os comandos e os limites das validações. O novo frontend está especificado no Figma e em docs/frontend.md; sua implementação e publicação exigem validações próprias.

O presidente administra cadastros e competições; o técnico escolhe previamente os atletas; a arbitragem credencia os participantes e registra as ocorrências do jogo. Escalação, credenciamento e entrada em quadra são etapas distintas.

### Documentação de referência

Consulte os documentos conforme a tarefa, mantendo as definições detalhadas em suas fontes:

- [README.md](README.md): visão geral, fluxo principal e limites do escopo inicial.
- [docs/frontend.md](docs/frontend.md): ao implementar ou revisar interface, consulte o Figma atual, o escopo por perfil e os critérios de integração, QA e entrega.
- [docs/requisitos.md](docs/requisitos.md): funcionalidades, regras de negócio e requisitos não funcionais.
- [docs/arquitetura.md](docs/arquitetura.md): tecnologias e decisões técnicas aprovadas.
- [docs/modelo-banco-dados.md](docs/modelo-banco-dados.md): entidades, relacionamentos e restrições.
- [docs/GLOSSARY.md](docs/GLOSSARY.md): vocabulário do domínio a utilizar no código e nas discussões.
- [docs/pendencias.md](docs/pendencias.md): perguntas em aberto e comportamentos provisórios. Consulte antes de implementar uma regra afetada; pendências não são funcionalidades aprovadas.

## Direção do desenvolvimento

- A arquitetura aprovada prevê TypeScript, Next.js em `client/`, NestJS com Express em `server/`, PostgreSQL e Prisma. Frontend e backend terão builds e implantações independentes.
- Regras de negócio e autorização ficam no backend. A interface consome a API REST; Socket.IO notifica mudanças aos dispositivos autorizados após a persistência.
- A interface será responsiva, com prioridade para celular. Credenciamento e registros do jogo exigem internet; o planejamento não inclui modo offline.
- Consulte a arquitetura antes de alterar a estrutura ou escolher dependências. Use as versões, ferramentas e integrações aprovadas; diferencie decisões documentadas de integrações efetivamente testadas.
- Implemente o escopo solicitado com base nas decisões aprovadas. Se uma pendência afetar a tarefa, esclareça com o usuário antes de decidir esse comportamento.

## Orientações de trabalho

- Faça a menor alteração que resolva o pedido e preserve mudanças existentes que não pertençam à tarefa.
- O agente que implementou uma tarefa não revisa nem faz o merge da própria PR; a revisão cabe a outro agente. Ao abrir a PR, complemente a descrição com tudo o que o revisor precisa saber: escopo e o que ficou fora, decisões tomadas com o usuário e seus motivos, alternativas descartadas, pontos de risco e onde concentrar a atenção, migrações e efeitos em dados existentes, verificações executadas com resultados e o que não foi validado.
- Ao revisar uma PR, leia a descrição e todos os comentários existentes, incluindo comentários de revisão no código, para considerar esclarecimentos e decisões registrados na discussão.
- Se a revisão identificar erros, lance um subagente para corrigi-los. Se alguma decisão ou comportamento precisar de validação do usuário, pergunte antes de prosseguir com essa parte. Após as correções, revise novamente e execute as verificações aplicáveis; se não houver problemas pendentes e as verificações passarem, faça o merge da PR sem pedir nova autorização.
- Consulte os scripts e comandos no README e nos manifests. Execute as verificações adequadas à alteração e informe o que foi validado e o que permanece pendente.
- A interface experimental em `client/` pode ser substituída pelo novo frontend especificado em `docs/frontend.md` e no Figma atual. Reaproveite integrações válidas e preserve as regras, mas não infira a direção visual do tema experimental. Desenho, implementação, deploy e validação com o cliente são etapas distintas.
- Ao finalizar uma funcionalidade no backend, priorize testes no próprio backend. Crie um frontend básico para testar a integração somente se necessário e após confirmar com o usuário essa necessidade e o escopo da interface.
- Atualize a documentação de referência quando o trabalho alterar o comportamento ou as decisões que ela descreve. Mantenha cada definição em sua fonte, evitando documentos e processos desnecessários.
- Quando o usuário selecionar uma tarefa do Linear para implementação, essa seleção autoriza criar uma nova branch `feat/<identificador>-<descricao>`, fazer commits do escopo da tarefa, enviar a branch ao remoto `origin` e abrir uma PR vinculada à tarefa, sem pedir nova permissão.
- Fora de tarefas selecionadas do Linear, faça commits somente quando o usuário autorizar explicitamente.
