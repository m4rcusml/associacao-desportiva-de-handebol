---
version: 1
slug: "figma-presidente"
primary_target: "figma://gwHYKm5u7V8uP1lXBmxPPG/4:3"
related_targets: []
---

# Presidente no Figma

Modo: Operate. Pedido de Marcus em 10/11/2026: estender a facilidade de uso, os recursos visuais e a UX/UI aprovados na arbitragem à área do presidente. Escopo: as dez telas existentes de presidente, suas adaptações móveis e estados necessários aos fluxos demonstrados. Sem alterar código de aplicação ou regras de negócio.

## Direction contract

THESIS: uma decisão por vez, com os dados necessários próximos da ação. Aprovar a ficha conferida não exige reabrir a mesma informação em confirmações sucessivas; ações de risco continuam explícitas.

OWN-WORLD: herdar Orientação de ginásio, verde profundo e IBM Plex Sans, com fundos claros, divisórias leves, avatares por iniciais, emblemas de clubes, calendários e ícones funcionais. Sem novo mundo visual ou gráficos decorativos.

STORY: conferir e decidir cadastros; localizar uma pessoa ou clube; organizar campeonatos e preparar arbitragem; revisar resultados somente depois do encerramento. Usar linguagem clara, incluindo Registros do jogo para a súmula.

FIRST VIEWPORT: navegação estável em cinco áreas. Cadastros abre a fila pendente e a primeira ficha para análise; largo usa fila e decisão adjacentes, celular apresenta a ficha vertical com ações ao alcance. Clubes, campeonatos e jogos usam listas visuais e ações contextuais. A ficha de pessoa traz carteirinha e acesso aos detalhes; conta e controles raros deixam de competir com a tarefa principal.

FORM: extensão do sistema visual escolhido pelo usuário, sem nova rodada de identidade. A composição segue os fluxos e permissões existentes, não o layout experimental do frontend.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Limites e fontes

Requisitos, glossário, arquitetura, pendências e docs/personas.md, seção 5, são as fontes de comportamento. Presidente não escala, credencia, inicia, interrompe ou encerra jogos. Adiamento/cancelamento só antes do início; correções esportivas só após finalizar. Não há novos lançamentos pós-jogo. Estorno administrativo respeita entrada e lançamentos válidos, com operações individuais e histórico. Senha da arbitragem pode ser consultada; trocar afeta sessões por senha, não designadas. Transferência pode ser bloqueada pelo campeonato em andamento. Gestão de outros presidentes usa referências locais/ID, sem lista oficial ou situação confirmada previamente. Sem exportação, notificações de conta permanente, classificação automática ou aprovação em lote.

Dados fictícios e navegação entre exemplos; sem integração real, uso de câmera ou pesquisa de campo. O protótipo não significa que o frontend foi implementado. A arbitragem já aprovada foi preservada; as telas anteriores do presidente foram removidas do Figma, com evidências históricas mantidas somente nos registros locais.

## Ajustes da revisão independente

No jogo em andamento, Consultar registros do jogo abre participantes e ocorrências somente para leitura; Designar arbitragem fica secundário nessa fase. Em Outros presidentes, o campo ID da conta de presidente tem acionador Gerir este ID e revisão com o identificador completo. O nome exibido no exemplo é uma referência já conhecida no navegador, não resultado de consulta à API. Referências criadas localmente e gestão por ID continuam caminhos distintos; informar ID não cria uma lista oficial nem confirma a situação da conta.
