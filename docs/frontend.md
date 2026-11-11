# Novo frontend — especificação e entrega

## Objetivo e estado atual

Este documento define a experiência de acesso, presidente, atleta, técnico e arbitragem implementada em `client/`, sua integração à `main`, publicação no ambiente de teste e validação com o cliente. É a referência solicitada por Marcus após os redesenhos e a correção dos layouts. Implementação, revisão/merge, deploy saudável e aceite são marcos distintos; a seção de evidências e a PR registram suas verificações.

A apresentação experimental foi substituída, reaproveitando as integrações reais conferidas com os controllers. O [README](../README.md) preserva as verificações históricas e seus limites; elas não aprovam o novo frontend. A implementação acrescenta regressões de navegador, CI do client e capturas novas, sem alterar os módulos de domínio, permissões ou esquema do backend.

## Fontes e precedência

| Assunto | Fonte |
| --- | --- |
| Regras e permissões | [Requisitos](requisitos.md), [glossário](GLOSSARY.md), [pendências](pendencias.md) e contratos reais do backend/OpenAPI |
| Tecnologia, sessões, proxy e implantação | [Arquitetura](arquitetura.md) e procedimentos do [README](../README.md) |
| Experiência a implementar e critérios de entrega | Este documento e telas atuais do Figma |
| Tokens, tipografia e componentes visuais | [DESIGN.md](../DESIGN.md); sidecar [design.json](../.impeccable/design.json) como apoio |
| Contexto de uso e limites de dados | [Personas](personas.md), [arbitragem](persona-arbitragem.md) e [insights](insights.md) |

Figma governa apresentação, hierarquia e interação pretendida; não amplia endpoints ou permissões. Se faltar dado ou houver conflito com uma regra, implemente o estado honesto permitido pelo contrato e registre o desvio. Uma decisão de negócio em aberto exige esclarecimento antes de implementar a parte afetada. O restante do trabalho pode continuar.

O antigo guia visual de `tema.module.css` nas personas e a direção inicial do [plano de arbitragem](plano-frontend-arbitragem.md) descrevem a implementação experimental. Para o novo visual, prevalecem este documento, DESIGN.md e Figma atual. Preserve os comportamentos válidos, sem reproduzir o tema antigo.

## Figma e evidências

Arquivo: [Handebol — visão geral atual](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=17-2). As páginas de versões anteriores foram limpas; referências históricas em ledgers não significam que esses nós ainda existam.

| Área | Celular | Desktop / mesa | Inventário de estados |
| --- | --- | --- | --- |
| Acesso | [Login](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=92-5465), [cadastro](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=92-5575) | [Login](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=7-2), [cadastro](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=7-22) | [Acesso](../.impeccable/figma-acesso-state.json) |
| Presidente | [Cadastros](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=52-1543) | [Cadastros](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=6-20) | [Presidente](../.impeccable/figma-presidente-state.json) |
| Atleta | [Carteirinha](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=9-2) | [Carteirinha](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=82-1316) | [Atleta](../.impeccable/figma-atleta-state.json) |
| Técnico | [Escalação](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=8-30) | [Escalação](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=82-449) | [Técnico](../.impeccable/figma-tecnico-state.json) |
| Arbitragem | [Registro direto](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=24-409) | [Mesa](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=24-273), [tablet](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=26-507) | [Arbitragem v2](../.impeccable/figma-arbitragem-v2-state.json) e [fluxos complementares](../.impeccable/figma-arbitragem-state.json) |

Correções posteriores também fazem parte da referência: [atleta/técnico](../.impeccable/figma-correcao-atleta-tecnico.json), [presidente/arbitragem](../.impeccable/figma-correcao-presidente-arbitragem.json) e [limpeza](../.impeccable/figma-limpeza-state.json). Consulte primeiro os estados atuais e depois as correções; inventários históricos podem conter IDs removidos.

Capturas e revisões estão em [review](../.impeccable/review/), especialmente [atleta/técnico](../.impeccable/review/atleta-tecnico-verdict.md) e [acesso/limpeza](../.impeccable/review/acesso-limpeza-verdict.md). A revisão visual de uma amostra e os scans geométricos não são testes funcionais ou comprovação de acessibilidade do aplicativo. Não houve validação com usuários reais.

### Traduzir o protótipo para software

Os frames são cenários independentes com nomes, datas, QR e resultados fictícios. Implemente componentes e estados alimentados pela API, não uma rota por frame ou cópias dos mesmos formulários. Inputs, busca, validação, upload, clipboard e câmera devem funcionar de verdade. Links Figma usados entre páginas viram navegação interna do Next.js; boards de revisão e seletores de sessões de exemplo não entram no produto.

No cadastro, snapshots separados contornaram uma limitação do Figma. No React, um único estado de formulário deve preservar perfil, clube e valores digitados após validação/erro, sem duplicar formulários ou reproduzir a variável do protótipo. O QR exibido precisa codificar o token vigente retornado pela API, nunca o desenho ilustrativo.

## Direção de UX e UI

**Orientação de ginásio:** leitura rápida, contraste firme, superfícies claras, verde profundo nas ações, identificação consistente por clube e camisa quando aplicável. IBM Plex Sans, tokens e estados em DESIGN.md. Implemente a fonte com carregamento adequado ao Next.js e sem depender de fontes instaladas no dispositivo. Os snippets do sidecar são demonstrações, não componentes de produção.

- A tarefa frequente aparece junto da informação: ficha e decisão, atleta e escalação, camisa e registro. Detalhes ocasionais abrem por contexto.
- Prioridade móvel e informação vertical; desktop utiliza espaço para conteúdo relacionado lado a lado. Celular de referência 390 × 844, desktop 1440 × 900 e tablet da mesa 1024 px de largura são exemplos, não breakpoints obrigatórios. Verifique também 320 px e larguras intermediárias.
- Navegação sempre identifica o destino ativo. Texto e ícone complementam cor; iniciais são alternativa legítima à foto ausente.
- Botões de toque têm pelo menos 44 × 44 px; ações principais usam aproximadamente 50 px conforme o desenho. Tabelas podem ter rolagem local, sem empurrar controles essenciais para fora da tela.
- Rótulos visíveis, foco perceptível, operação por teclado, foco devolvido ao fechar diálogos, nomes acessíveis e feedback anunciado. Respeitar redução de movimento.
- Sem sobreposição: conteúdo deve refluír com nomes longos, erros multilinha, zoom e variação de dados. Não resolver cortes com altura fixa, texto minúsculo ou ocultação de informação essencial.
- Estados de carregamento, vazio, erro, sucesso, conflito, acesso negado/expirado e falta de conexão fazem parte do fluxo. Conexão indisponível não cria modo offline.

## Escopo por área

### Acesso

Login por e-mail/senha, com perfil obtido da sessão e destino seguro preservado quando aplicável. Cadastro público apenas atleta e técnico: nome, e-mail, senha de 8 a 128 caracteres; atleta escolhe clube existente, técnico começa sem clube. Cadastro fica pendente; aprovação pelo presidente é outra etapa. Técnico sem clube, pendência e rejeição têm orientação própria.

Mostrar validação junto ao campo, credenciais inválidas, limite de tentativas, erro de rede, e-mail existente e conflito. Retornos e falhas preservam valores e perfil; após sucesso incerto de cadastro, orientar login conforme contrato, sem afirmar que a conta não existe. Acesso temporário da arbitragem permanece separado. Recuperação de senha, troca de perfil e cadastro público de presidente não integram esta entrega.

### Presidente

Cinco destinos: Cadastros, Pessoas, Clubes, Campeonatos e Conta. Ficha já aberta para conferência e aprovação direta; rejeição e ações sensíveis mantêm contexto/confirmação apropriados. Atualizar o estado após a resposta real, sem confirmar uma aprovação antes da persistência.

Cobrir as capacidades já existentes: aprovar/rejeitar; conta, carteirinha/QR/foto, transferência e histórico; clubes e atribuição de técnicos; campeonatos, inscrições e ciclo; jogos, designações/senha e links; aplicação, redução e revogação de suspensões; consultas e correções pós-jogo; próprio nome e gestão permitida de outros presidentes. Operações válidas que não tenham frame dedicado continuam acessíveis por contexto, com o mesmo sistema visual.

Em andamento, priorizar consulta de registros; sem correção administrativa durante a partida ou controles de arbitragem. Pós-jogo, orientar a sequência real de correção/anulação/entrada/estorno, sem operação atômica fictícia. Invalidação definitiva preserva placar, estatísticas e cumprimentos. Contas de presidentes por ID/referências locais não são lista oficial nem comprovam status atual.

### Atleta

Carteirinha aberta na chegada, QR e código legíveis e ampliação em uma ação. Carteirinha ativa não garante elegibilidade para cada jogo. Foto é opcional; enviar/substituir e tratar ausência/falha respeitando o limite real. Histórico próprio diferencia **Escalado**, **Credenciado** e **Entrou em quadra**, preserva clube da época e indica anulações, cancelamento e invalidação. Entrada registrada não significa presença atual em quadra; métricas indisponíveis não viram zero.

Conta permite nome, foto e nova solicitação após rejeição, sem motivo de rejeição inventado. Incluir clubes e estados cadastrais. Não oferecer autosserviço de transferência, agenda geral ou extrato de suspensão. Histórico próprio pode informar adversário antes do início, diferentemente do contrato do técnico.

### Técnico

Abrir jogo por link/ID e retomar referências locais isoladas por usuário/clube. Não apresentar esses atalhos como agenda oficial. Mostrar campeonato, próprio clube, data/hora local com fuso, local e status. Antes do início, declarar que adversário e placar não estão disponíveis nessa consulta.

Listas de escalados/disponíveis com busca, identificação e **Escalar/Retirar em um toque por atleta**, cada operação persistida individualmente; sem salvar lote fictício. Suspensão pendente permite escolha, mas pode impedir credenciamento se ainda vigente. Transferido após escolha pode ser retirado, sem consultar sua foto/histórico pelo antigo clube. Explicar por que candidatos não representam elenco completo e orientar quando um atleta não aparece.

Após início/finalização, escalação fica encerrada e desempenho vira consulta com atualização explícita. Incluir clube, atletas atuais conhecidos, histórico permitido e conta, além de sem clube, vazio, cancelamento e conflitos. Técnico não tem carteirinha própria, não atribui camisa e não credencia nem controla o ciclo do jogo.

### Arbitragem

Mesa é o posto principal de registro; linha acompanha e também registra, com iguais permissões. Rótulo visual Mesa corresponde ao valor de contrato `banco`; não criar outro valor ou papel no backend. Abrir jogo por ID/link, por designação válida ou nome/senha, respeitando a janela do jogo e o cookie isolado.

Antes do início: conferência por lista/QR, impedimentos, camisa, estorno elegível, início e W.O. Durante: ambos os clubes identificados, camisas como alvos de ação, gol em um toque quando no modo Gol, exclusão com seleção de modo e camisa em dois toques. Amarelo/vermelho e relatório disciplinar respeitam os campos necessários; rapidez não elimina informação obrigatória. Não mostrar sucesso, mudar placar oficial ou registrar entrada só por tocar numa camisa.

Manter credenciamento tardio, entrada única, histórico, correção/anulação, interrupção, retomada e encerramento. Desfazer age sobre uma ocorrência identificada pela operação permitida, preservando autoria/histórico; não é decrementar placar local ou apagar registro. Só oferecer quando permitido pelo status. Após encerramento, mostrar o recibo recebido pelo próprio POST; outros dispositivos perdem acesso. Sem cronômetro oficial, substituições, lista de quem está agora em quadra ou consulta final pela sessão revogada.

## Integração e organização da implementação

Preserve Next.js/TypeScript, REST e infraestrutura existentes. Versões e comandos vêm dos manifests; arquitetura rege novas dependências. Organize componentes compartilhados em torno de controles, formulários, navegação, identificação, listas, diálogos e feedback. Substitua tema/componentes antigos gradualmente, sem manter duas experiências concorrentes ao final. Reaproveite contratos, helpers e proteções úteis do código existente, após conferi-los.

O backend fica preservado neste trabalho. Confirme payloads em controllers, tipos e OpenAPI antes de ligar cada fluxo; o layout não cria dado ausente. Uma necessidade real de backend vira desvio documentado e decisão do usuário, não endpoint improvisado. A implementação deve mapear as capacidades existentes, não apenas as telas de demonstração.

Requisitos transversais de integração:

- Sessão real, cookies HttpOnly, `credentials: include`, dados autenticados sem cache compartilhado e autorização final no backend. Preserve retorno seguro do login, isolamento de usuários e sessões por jogo.
- Nenhum segredo, senha, token QR ou foto no armazenamento persistente/log/URL. Referências locais guardam somente os metadados mínimos já permitidos, nunca estado oficial.
- Nas áreas permanentes, REST e atualização explícita. Na arbitragem, Socket.IO por long-polling no proxy atual apenas invalida consultas; conectar/reconectar relê REST. Eventos não substituem placar oficial.
- Controle de respostas antigas e revogação: uma consulta atrasada não restaura informação obsoleta ou privada. Revogar para câmera, eventos e ações; preservar separadamente o recibo permitido.
- Escrita confirmada seguida de erro na releitura continua confirmada; oferecer atualizar, sem repetir a escrita. Resposta incerta de lançamento/correção/anulação conserva `operacaoId` e conteúdo para reenvio explícito. Nenhuma fila offline ou retry automático cego de escrita.
- Câmera com permissão, fallback manual e encerramento das faixas de vídeo. QR vigente gerado localmente, foto privada pela API e clipboard com resultado verificável.
- Conservar `/api` e `/api/socket.io`, proxy e configuração do ambiente hospedado. Não introduzir SSR autenticado sem provar repasse de cookies e isolamento de cache conforme arquitetura.

## Plano de execução e coordenação

1. **Inventário.** Ler AGENTS.md e fontes acima, inspecionar Git, código, Figma atual e ambiente. Identificar modificações preexistentes, contratos, capacidades e divergências; registrar matriz área → rota → ação → API → estado → verificação. Cada capacidade fica implementada, já coberta ou bloqueada com motivo verificável.
2. **Base compartilhada.** Traduzir tokens/fontes, controles, navegação responsiva, formulários, diálogos e feedback. Definir responsabilidades de arquivos antes de paralelizar; um responsável integra a base e evita implementações visuais divergentes.
3. **Entrega por fluxo.** Acesso e sessão; atleta/técnico; presidente; arbitragem. Trabalhar em fatias completas com API real e estados de recuperação. Delegar áreas independentes, mantendo cookies, contratos e componentes compartilhados sob coordenação. Ordem pode mudar por dependência, não por omissão de um perfil.
4. **Integração e QA.** Validar os cinco conjuntos juntos e o ciclo completo de uma partida; confrontar capturas reais com Figma e repetir apenas checks afetados por correções. Remover amostras visuais antigas e navegação morta sem apagar histórico/dados do domínio.
5. **PR e revisão independente.** Implementador não revisa nem faz merge da própria PR. Revisor lê descrição, diff e todos os comentários; correções por outro agente, novas verificações e revisão. Merge somente sem problemas pendentes e com checks aplicáveis aprovados, conforme AGENTS.md.
6. **Deploy de teste e cliente.** Confirmar SHA integrado, deploy correspondente e smoke hospedado; apresentar roteiro e registrar resultado por perfil. Código em `main`, deploy saudável e validação do cliente são marcos distintos, cada um com evidência própria.

## Critérios de aceite e verificações

### Matriz de integração do novo frontend

Inventário confrontado com os controllers e componentes reais. Os caminhos de API abaixo são relativos a `/api`; nenhuma capacidade desta entrega cria endpoint ou permissão. Os specs de navegador em `client/tests/` exercitam a API local real e injetam falhas de transporte apenas nos cenários de recuperação. A matriz delimita cobertura; não declara que cada combinação possível já foi testada.

| Perfil / rota | Ação / API | Estados e verificação |
| --- | --- | --- |
| Acesso `/login`, `/cadastro`, `/` | Login/logout, `POST /cadastros`, `GET /clubes`, `/sessao` | Dois perfis, validação junto ao campo, preservação do formulário, erro de rede/resposta incerta, perfil da sessão e retorno seguro; `acesso.spec.ts` e asserts do técnico |
| Atleta `/atleta` | `GET /carteirinhas/minha` | QR vigente aberto/ampliado, ativa/invalidada/pendente/rejeitada, recuperação de foco; `pessoais.spec.ts` |
| Atleta `/atleta/historico` | `GET /atletas/:id/historico` | Etapas distintas, clube da época, métricas indisponíveis e invalidação; consulta e navegação em `pessoais.spec.ts` |
| Atleta/técnico `/conta` e `/clubes[/id]` | `PATCH /conta`, foto privada, nova solicitação; visão geral/detalhe de clubes | Nome, foto opcional, reanálise, sem clube, acesso negado, logout e consulta atrasada; `pessoais.spec.ts` |
| Técnico `/tecnico` e `/tecnico/jogos/:id` | Link/ID, atalhos locais; `GET/POST/DELETE /jogos/:id/escalacao`, `GET .../desempenho` | Escalar/retirar individual, sucesso persistido com falha na releitura, suspensão/transferência e bloqueio após início; `pessoais.spec.ts` e asserts de contratos |
| Técnico `/tecnico/clube`, `/tecnico/atletas/:id` | Histórico/foto autorizados; candidatos dos jogos conhecidos | Lista conhecida sob consulta explícita, sem alegar elenco completo; isolamento por usuário/clube e preservação da retirada de transferido |
| Presidente `/presidente` | `GET /verificacoes?status=...`, `POST .../:id/aprovacao` ou `/rejeicao` | Ficha aberta e aprovação direta; rejeição confirmada, conflito e erro de releitura; `presidente.spec.ts` |
| Presidente `/presidente/pessoas[/id]` | Carteirinha/QR/foto, ativação, vínculos/transferência e histórico | Ações contextuais, conta inativa, QR substituído, bloqueio real de transferência; navegação no spec e contratos preservados |
| Presidente `/presidente/clubes[/id]` | Listar/criar/editar clube, atribuir/substituir/desvincular técnico | Técnico aprovado/ativo, vaga concorrente e sucesso confirmado; fluxo contextual no spec |
| Presidente `/presidente/campeonatos[/id]` | Campeonato, inscrições/ciclo, jogos e suspensões | Abas por tarefa, estados reais e operações administrativas preservadas; navegação no spec |
| Presidente `.../jogos/:jogoId` | Designações/senha/links, consulta de registros, resultado, correções, anulações e estorno | Consulta em andamento; correção só no estado permitido; resposta incerta conserva caminho/corpo/`operacaoId`; APIs existentes preservadas |
| Presidente `/presidente/conta` | Nome, criação de presidente e ativação por ID/referência local | Confirmação de identidade; sem lista oficial fictícia ou persistência de senha |
| Arbitragem `/arbitragem[/jogos/:id]` | Entrada por senha/designação e sessão por jogo | Mesa envia `banco`; janela/conta/designação reais, sessão isolada; `arbitragem.spec.ts` |
| Arbitragem — credenciamento | Lista/leitura de QR, camisa, estorno e entrada única | QR identifica sem credenciar, câmera/fallback, impedimentos, camisa única e entrada distinta; contratos e asserts reais |
| Arbitragem — registros e ciclo | Lançamento/correção/anulação, início, interrupção/retomada, W.O./encerramento | Gol em um toque; modo+camisa; relatório explícito; reenvio idempotente; POST confirmado sobrevive ao GET falho; recibo; `arbitragem.spec.ts` |
| Dois dispositivos | Socket.IO polling invalida e relê REST | Reconexão, revogação e GET antigo não restauram dados; `arbitragem.spec.ts` |
| Todos os perfis | Navegação, formulários, diálogos e feedback compartilhados | 320/390/1024/1440 px, texto longo, erro multilinha, teclado/foco e alvos de toque; capturas novas sanitizadas e comparação com Figma |

Limites de composição mantidos: a sessão temporária não informa nome do campeonato; o técnico não tem agenda nem consulta geral de elenco; gestão de presidentes usa ID/referências locais. A interface apresenta esses limites sem preencher lacunas com dados de demonstração.

Para cada fluxo, verificar sucesso, carregamento, vazio, erro e estado de autorização relevante com dados reais de teste. Simular perda de resposta, consulta atrasada, clique repetido e conflito onde houver mutações. Usar dados fictícios isolados e não resetar banco compartilhado.

| Área | Evidência mínima |
| --- | --- |
| Acesso | Cadastro dos dois perfis; clube obrigatório só no atleta; erros preservam formulário; login/logout e retorno seguro; área por sessão; pendente/rejeitado sem acesso esportivo indevido |
| Presidente | Aprovação e emissão real; técnico/clubes; campeonato, inscrições e agendamento; links/designação; suspensão; consulta em andamento e correção pós-jogo; gestão por ID com confirmação de identidade |
| Atleta | QR vigente renderizado e ampliado; foto opcional/privada; nome; reanálise; histórico com etapas e métricas indisponíveis, clube anterior e invalidação |
| Técnico | Link/ID e atalhos; incluir/retirar em uma ação; suspensão/transferido; sem clube; bloqueio após início/cancelamento; desempenho e histórico autorizado |
| Arbitragem | Duas formas de entrada; lista/QR e fallback; camisa duplicada/impedimento; entrada; quatro tipos de lance; reenvio idempotente; correção/anulação; interrupção/retomada; W.O./encerramento e recibo |
| Múltiplos dispositivos | Mudança em um aparece no outro via releitura; reconexão, troca de senha, encerramento e resposta antiga respeitam revogação e isolamento |
| Visual/acessibilidade | 320/390 px, tablet e desktop; textos longos/erros/zoom sem sobreposição; teclado, foco, toque, semântica, contraste e redução de movimento; comparação com Figma atual |

Execute em `client/`, conforme manifests atuais: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`, além dos asserts existentes `node src/features/tecnico/contratos.test.mjs` e `node src/features/arbitragem/teste.mjs`. Acrescente testes de comportamento para regressões relevantes, usando ferramentas aprovadas; asserts antigos não substituem os fluxos reais de navegador.

O workflow existente cobre backend, não o frontend. Incluir checks de frontend no CI para PR/`main`, usando versões e lockfile do client, sem remover os checks do backend. Se infraestrutura ou contrato forem afetados com autorização, rodar também verificações correspondentes do servidor, incluindo integração com banco dedicado, conforme README. Não declarar um teste aprovado sem executá-lo; restrições do ambiente devem constar na PR e na entrega.

### Evidências da implementação — 11/11/2026

Lint, tipos, build de produção e os dois conjuntos de asserts do client foram executados e aprovados. Os **18 cenários únicos** dos quatro specs de navegador passaram juntos contra a API real local: nove de acesso, três pessoais, dois administrativos e quatro de arbitragem. A regressão administrativa adicional retém uma consulta de credenciamentos anterior à correção da camisa e verifica que sua resposta não restaura o estado antigo; a ampliação do QR compara tamanho, token vigente, foco e largura disponível em 320/390/1024/1440 px. A execução conjunta no Chromium fica também no check `Frontend checks`; o Windows local utilizou Edge instalado, sem substituir API ou regras por mocks. Falhas de transporte e nomes longos são injetados apenas nos cenários que os identificam.

As capturas abaixo são do aplicativo executando o novo código, confrontadas com os contextos e screenshots atuais do Figma. As máscaras magenta ocultam QR e fotos privadas; não são componentes do produto. Dados exibidos são fictícios. Foram verificadas larguras 320, 390, 1024 e 1440 px, reflow com zoom CSS de 200%, foco de campos/diálogos, retorno de foco e alvos de toque. Os pares principais de cores dos tokens têm contraste de pelo menos 5,27:1; isso não substitui uma auditoria completa por leitor de tela.

| Área | Celular | Desktop / tablet |
| --- | --- | --- |
| Acesso | [390 px](evidencias/frontend/acesso-mobile.png) | [1440 px](evidencias/frontend/acesso-desktop.png) |
| Presidente | [Ficha com nome longo](evidencias/frontend/presidente-mobile.png) | [Fila e ficha](evidencias/frontend/presidente-desktop.png) |
| Atleta | [Carteirinha](evidencias/frontend/atleta-mobile.png), [320 px com erro multilinha](evidencias/frontend/atleta-320-erro.png) | [Carteirinha e registros](evidencias/frontend/atleta-desktop.png) |
| Técnico | [Escalação](evidencias/frontend/tecnico-mobile.png) | [Escalados e disponíveis](evidencias/frontend/tecnico-desktop.png) |
| Arbitragem | [Registro por camisa](evidencias/frontend/arbitragem-mobile.png) | [Mesa](evidencias/frontend/arbitragem-desktop.png), [tablet](evidencias/frontend/arbitragem-tablet.png) |

Na arbitragem foram executados: credenciamento manual e camisa duplicada, câmera negada/fallback, entrada única, gol/exclusão/vermelho com relatório, anulação identificada, interrupção/retomada, encerramento/recibo, falha na releitura após POST confirmado, resposta perdida e reenvio com o mesmo `operacaoId`, dois contextos de navegador, reconexão, troca de senha/revogação e GET antigo liberado após a revogação. Na área pessoal: QR correspondente ao token vigente, edição/foto privada com tamanho recusado, isolamento, etapas do histórico, escalação/retirada individual e recuperação de resposta incerta. No presidente: aprovação direta, rejeição/foco, conflito real, resposta antiga após decisão, erro de releitura, atribuição de técnico, campeonato/inscrições/agendamento e navegação administrativa.

Limites: não houve teste com cliente, câmera física, ginásio ou dois aparelhos físicos. Não foram repetidas pelo novo navegador todas as combinações administrativas de transferência, suspensão/redução, correção pós-jogo e W.O.; seus controles e contratos foram preservados, e a suíte de backend continua obrigatória. A leitura de câmera real e o roteiro completo abaixo permanecem parte da validação assistida. O detector mecânico apontou três imagens privadas sem `src` literal: são Blobs autenticados atribuídos no efeito, com descarte da URL, não assets ausentes; fotos reais foram enviadas/lidas e verificadas sem sessão no novo QA.

O smoke pré-publicação da origem estável passou em saúde, proxy, origem, cookies, sessão/logout, foto e polling com ping de 25 s. A consulta de metadados privados do bucket não foi executada por ausência das variáveis opcionais; isso fica distinto da leitura autorizada de foto e da recusa sem sessão. Após merge, é obrigatório acompanhar os deploys correspondentes e repetir o smoke. O resultado de merge/publicação deve ser conferido na PR e no deploy; o aceite do cliente exige retorno real.

### Pronto para integrar

Todos os perfis e capacidades mapeados; lint, tipos, build e testes aplicáveis aprovados; fluxos integrados e capturas revisados; sem regressões materiais ou mocks em produção; documentos atualizados; revisão independente concluída. Desvios e verificações não executadas ficam explícitos. A aceitação do cliente ainda pode estar pendente.

### Pronto para validar com o cliente

Use a implantação de teste já descrita no [README](../README.md#implantação-de-teste-mar-76): Vercel client, Render backend e Supabase. Confira configuração vigente e a origem estável `https://associacao-de-handebol.vercel.app` antes de publicar; não assuma que push/merge implica deploy saudável. Preserve proxy, cookies e segredos; `NEXT_PUBLIC_API_URL=/api` no ambiente hospedado. Não provisionar serviços ou alterar dados de produção para esta validação.

Registrar SHA de `main`, URL/identificador do deploy, resultado de saúde/smoke e cenário por perfil. Se deploy estiver automático, acompanhar seu resultado; se depender de credencial/ação humana, informar a ação exata pendente, sem anunciar publicação. Reusar procedimentos de smoke do README, sem copiar segredos para docs. Antes de rollback, identificar a versão anterior saudável e o efeito esperado; evitar reset/force-push ou reversão de dados.

Roteiro para o cliente: criar atleta/técnico, presidente aprovar/atribuir clube, agendar e compartilhar jogo, técnico escalar, atleta apresentar carteirinha, arbitragem credenciar/iniciar/registrar/encerrar, atleta e técnico consultar histórico, presidente corrigir quando cabível. Observar tempo e cliques, compreensão de status e erros. Câmera física e uso em ginásio exigem teste real; automação com vídeo simulado não os substitui. Registrar feedback e pendências, sem marcar validação do cliente como concluída antecipadamente.
