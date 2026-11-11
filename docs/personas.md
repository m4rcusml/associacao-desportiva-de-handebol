# Proto-personas e guia transversal de UX/UI — Associação Desportiva de Handebol

Documento elaborado em 10/11/2026 para orientar a concepção de experiência do usuário (UX) e interface (UI) das áreas de **atleta**, **técnico** e **presidente** no frontend (`client/`).

**Referência atual de implementação:** [frontend.md](frontend.md) e Figma atual substituem a direção visual experimental deste documento. As hipóteses, tarefas e limites de contrato continuam como contexto; tabelas de cores/fontes e exemplos de composição da seção 2 descrevem a versão anterior, não o visual a reproduzir. Em decisões de interação já redesenhadas, como aprovação direta junto da ficha, prevalece frontend.md.

As três proto-personas descritas aqui são **hipóteses de design** derivadas das regras de negócio, dos requisitos aprovados e dos contratos reais do backend — **não representam pesquisa empírica com usuários reais** e evitam estereótipos demográficos inventados (idade, profissão paralela, renda ou citações fictícias). Cada hipótese traz critérios observáveis de avaliação e perguntas de validação para testes futuros.

> **Restrição arquitetural vigente:** o backend (`server/`) está congelado. Nenhuma decisão de UX descrita aqui cria endpoints, altera permissões, introduz operação offline, envia notificações em tempo real para contas permanentes ou antecipa pendências abertas em [docs/pendencias.md](pendencias.md). Este guia orientou a implementação das áreas de **atleta**, **técnico** e as melhorias do **presidente**. O [README](../README.md#áreas-do-atleta-e-do-técnico-interface) registra o escopo efetivamente entregue; sugestões adicionais deste documento continuam hipóteses de design a validar.

---

## 1. Fronteiras do domínio e separação obrigatória de etapas

Toda tela, rótulo e mensagem do frontend deve preservar o vocabulário do [glossário](GLOSSARY.md) e refletir as fronteiras implementadas nos controllers e services do backend:

1. **Escalação, credenciamento e entrada em quadra são três etapas distintas da `Participacao`** ([`server/src/modules/resultados/historico.ts`](../server/src/modules/resultados/historico.ts)):
   - **Escalação (`escalado` / `escolhidaEm`):** escolha preliminar feita exclusivamente pelo **técnico aprovado atual** do clube, somente enquanto o jogo está `agendado` ([`EscalacaoController`](../server/src/modules/participacoes/escalacao.controller.ts), [`escalacao.ts`](../server/src/modules/participacoes/escalacao.ts)). Não garante presença, não atribui camisa, não credencia e não comprova entrada em quadra (`RN-014`).
   - **Credenciamento (`credenciado` / `credenciadoEm` + `numeroCamisa`):** validação feita pela **arbitragem autorizada da partida** (por confirmação manual na lista ou leitura do QR code da carteirinha), antes do início ou durante o jogo (`RF-017` a `RF-021`, [`CredenciamentoController`](../server/src/modules/participacoes/credenciamento.controller.ts), [`credenciamento.ts`](../server/src/modules/participacoes/credenciamento.ts)). Exige camisa única no clube/jogo e barra impedimentos vigentes (`nao_aprovado`, `sem_vinculo_com_clubes_do_jogo`, `conta_desativada`, `carteirinha_invalidada`, `suspensao`). Atleta elegível pode ser credenciado mesmo sem escalação prévia (`RN-015`).
   - **Entrada em quadra (`entrouEmQuadra` / `entrouEmQuadraEm`):** confirmação única registrada pela **arbitragem autorizada**, somente com o jogo `em_andamento` e sem interrupção aberta (`RF-022`, `RF-023`, `RN-020`, `RN-021`). Distingue quem ficou apenas no banco de quem efetivamente jogou, sem medir tempo jogado nem substituições.
2. **Divisão estrita entre perfis permanentes e arbitragem temporária:**
   - Cada conta possui um único perfil permanente (`atleta`, `tecnico` ou `presidente` — `RN-001`, [`ator.ts`](../server/src/modules/autorizacao/ator.ts)).
   - **Atleta** não possui ferramentas administrativas: gerencia apenas seu nome, sua foto e sua solicitação cadastral, apresenta sua carteirinha/QR e consulta seu próprio histórico e a visão geral de clubes.
   - **Técnico** escala atletas do próprio clube até o início da partida e consulta o desempenho dos jogos do clube e o histórico/foto dos atletas atualmente vinculados ao seu clube. **Técnico não credencia atletas, não define número de camisa, não confirma entrada em quadra e não inicia ou encerra jogos.**
   - **Presidente** administra cadastros, carteirinhas, clubes, atribuição de técnicos, transferências, campeonatos, agendamento de jogos, designação/senha de arbitragem, suspensões e correções pós-jogo. **Presidente não escala atletas (nem quando o clube está sem técnico — `PEN-018`) e não inicia, interrompe, retoma ou encerra jogos.**
   - **Arbitragem** é uma atribuição temporária por partida, autenticada pelo cookie isolado `handebol.arbitragem.{jogoId}` ([`ArbitragemController`](../server/src/modules/arbitragem/arbitragem.controller.ts), [`acesso.ts`](../server/src/modules/arbitragem/acesso.ts)), aberta apenas no dia local do jogo (ou enquanto `em_andamento`). Atletas e técnicos aprovados sem vínculo com os clubes do jogo podem ser designados pelo presidente para arbitrar uma partida específica (`RN-025`).

---

## 2. Guia transversal de concepção de interface (UX/UI)

Esta seção registra a orientação usada na interface experimental de atleta, técnico e presidente. Para implementar o redesenho, use [frontend.md](frontend.md) e [DESIGN.md](../DESIGN.md); `tema.module.css` pode ser substituído. Orientações gerais de clareza e acessibilidade permanecem aplicáveis quando compatíveis com a experiência atual.

### 2.1. Ancoragem no domínio e calibragem contra padrões genéricos

O produto pertence ao cotidiano de **quadras e ginásios de handebol**: leitura rápida sob iluminação variável, conferência visual de carteirinhas, leitura de placares, controle de camisas e rastreabilidade de súmulas e punições.

Para evitar interfaces com aparência genérica ou automatizada, futuras telas devem **rejeitar explicitamente**:
- Fundos creme aquecidos (`#F4F1EA`) com títulos serifados e destaque terracota (`#D97757`), ou fundos pretos com neon ácido.
- O "kit de cartões SaaS": empilhar múltiplos cartões arredondados idênticos com sombras difusas e gradientes decorativos sem hierarquia funcional.
- Rótulos *eyebrow* em CAIXA ALTA espaçada acima de todo título, metadados separados por ponto médio (`A · B · C`) por hábito visual, palavras isoladas em itálico/cor dentro de títulos ou setas `→` anexadas ao texto de botões.
- Numeração artificial (`01 / 02 / 03`) em blocos que não representam uma sequência temporal ou passo a passo obrigatório.

### 2.2. Sistema compacto de tokens visuais (de `tema.module.css`)

As telas devem reutilizar os tokens CSS existentes na classe `.tema` de [`client/src/features/ui/tema.module.css`](../client/src/features/ui/tema.module.css), sem criar paletas paralelas:

| Token CSS | Valor em `tema.module.css` | Papel funcional na interface |
| --- | --- | --- |
| `--fundo` e `--superficie` | `#eef2f6` / `#ffffff` | Fundo geral da aplicação e superfície limpa de súmulas, listas, diálogos e área do QR code. |
| `--tinta`, `--suave` e `--divisa` | `#172238` / `#4a576b` / `#cad3de` | Texto principal, metadados secundários e linhas divisórias estruturais (`1px solid var(--divisa)`). |
| `--quadra` e `--quadra-escura` | `#1b4d89` / `#123764` | Identidade de quadra, ação primária, cabeçalho e anel de foco visível (`outline: 3px solid var(--quadra)`). |
| `--sinal` | `#f4b63f` | Ponto focal único de destaque/atenção (marcador de seção ativa, sinalização de quadra ou estado em andamento). |
| `--aprovado` / `--aprovado-fundo` | `#1d7046` / `#e2f2e8` | Estado apto, cadastro aprovado, conta ativa e carteirinha ativa. |
| `--pendente` / `--pendente-fundo` | `#7a4f00` / `#fff0cc` | Estado de aguardo, verificação pendente, interrupção temporária ou alerta de `suspensaoPendente`. |
| `--rejeitado` / `--rejeitado-fundo` | `#ae2a22` / `#fbe7e5` | Bloqueio, rejeição, carteirinha invalidada, conta desativada, desqualificação ou ação destrutiva. |

### 2.3. Tipografia local e hierarquia numérica

Conforme definido em [`tema.module.css`](../client/src/features/ui/tema.module.css):
- **Texto e controles (`--texto: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`):** aplicada ao corpo da página, formulários, mensagens de erro e tabelas descritivas, mantendo linhas abaixo de 80 caracteres e entrelinha confortável.
- **Títulos e súmula numérica (`--display: Bahnschrift, "DIN Alternate", "DIN Condensed", "Roboto Condensed", "Arial Narrow", sans-serif` com `font-variant-numeric: tabular-nums`):** aplicada a cabeçalhos de seção, placares (`placarClubeA × placarClubeB`), números de camisa (`numeroCamisa`), código de 10 caracteres da carteirinha (`codigo`), saldos de suspensão (`jogosRestantes`) e horários com fuso (`inicioPrevistoLocal`).
- **Regras tipográficas:** usar *Sentence case* (apenas a primeira letra maiúscula) em títulos, abas, cabeçalhos e botões; não usar `ALL CAPS` em rótulos de formulário nem empilhar rótulos redundantes acima de dados autoexplicativos.

### 2.4. Conceito de layout, alinhamento e estruturas base (ASCII)

- **Alinhamento:** todo conteúdo textual, listas de atletas, históricos e formulários são alinhados à esquerda. O alinhamento centralizado é restrito ao bloco do QR code na carteirinha do atleta e ao placar de confronto quando disponível.
- **Prioridade móvel (mobile-first):** uma coluna principal em telas estreitas, com alvos de toque mínimos de `44×44px` (`2.75rem`) e ações primárias acessíveis ao polegar, expandindo para grade de duas colunas apenas em áreas densas do presidente em telas largas.

```text
[Atleta — Mobile (Carteirinha)]      [Técnico — Mobile (Escalação)]       [Presidente — Subcontexto Jogo]
+-------------------------------+    +-------------------------------+    +-------------------------------------+
| Clube Atual · Status: Aprovado|    | Campeonato · Local (se houver)|    | Campeonatos > Campeonato > Jogo     |
+-------------------------------+    | Meu Clube · Agendado          |    | Clube A 24 x 21 Clube B · Finalizado|
| [Foto 3x4]  Nome Completo     |    | Início: Data/Hora (Fuso IANA) |    +------------------+------------------+
|             Clube Atual       |    | (Adversário visível após      |    | Participações e  | Lançamentos e    |
|             Cód: 9H4K2M8P7Q   |    |  início do jogo no placar)    |    | Credenciamentos  | Correções Pós-   |
|  +-------------------------+  |    +-------------------------------+    | - Camisa / Quadra|   Jogo (MAR-83)  |
|  |                         |  |    | Escalados (7)                 |    | - Reg. Admin.    | - Transferir Gol |
|  |       [ QR CODE ]       |  |    | - Nome Atleta    [Retirar]    |    | - Estornar       | - Anular         |
|  |                         |  |    | - Nome (!Susp.)  [Retirar]    |    +------------------+------------------+
|  +-------------------------+  |    +-------------------------------+    | Arbitragem / Senha / Resultado      |
|  Situação: ATIVA              |    | Aptos no Clube (5)            |    +-------------------------------------+
+-------------------------------+    | - Nome Atleta   [+ Escalar]   |
| [Carteirinha] [Histórico] [Eu]|    +-------------------------------+
+-------------------------------+    | [Jogos] [Meu Clube] [Conta]   |
                                     +-------------------------------+
```

### 2.5. Movimento, diálogos e diretrizes de escrita (Copywriting)

- **Movimento intencional:** animações existem apenas para responder à ação da pessoa (abrir diálogo, confirmar inclusão/remoção) e devem respeitar `prefers-reduced-motion: reduce`. Não usar efeitos automáticos de entrada em cascata por seção.
- **Comportamento de diálogos modais (padrão de [`Dialogo`](../client/src/features/ui/dialogo.tsx) e [`Confirmacao`](../client/src/features/ui/confirmacao.tsx)):**
  - Nas confirmações de ações sensíveis, o foco inicial abre no botão seguro (`"Voltar"`) e, ao fechar, retorna ao elemento que abriu o diálogo (ou a um `focoAlternativo` se o gatilho saiu da tela).
  - `Escape`, cancelamento nativo e o botão `"Voltar"` fecham o diálogo **somente quando não há envio em andamento** (`!enviando`). Enquanto uma mutação está em voo (`enviando: true`), bloquear `Escape`, cancelamento nativo e os botões `"Fechar"`/`"Voltar"` do diálogo para que o resultado ou o erro da operação não se perca. Esse comportamento não bloqueia a navegação do navegador.
- **Linguagem orientada à tarefa e fiel ao contrato:**
  - Usar verbos na voz ativa e manter o mesmo termo em todo o fluxo: o botão `"Solicitar nova análise"` produz a confirmação `"Solicitação enviada para análise"`.
  - Nunca usar termos evitados pelo glossário (*"equipe"*, *"mandante/visitante"*, *"ingresso"*, *"carteirinha do técnico"*).
  - Tratar erros e telas vazias como direção objetiva, sem pedidos de desculpa vagos: explicar exatamente qual regra bloqueou a ação e qual é o próximo passo possível.

---

## 3. Proto-persona 1: Atleta

### 3.1. Contexto e tarefas do papel

Pessoa vinculada a um clube da associação que cria a própria conta, aguarda aprovação do presidente para obter sua carteirinha digital, mantém sua foto identificável para a mesa de arbitragem, apresenta o QR code no celular antes ou durante a partida para ser credenciada e acompanha seu histórico oficial de participações e métricas ao longo dos campeonatos, inclusive após transferências de clube. Eventualmente, quando aprovada e sem vínculo com os clubes de uma partida, pode ser designada pelo presidente para atuar na arbitragem daquele jogo.

### 3.2. Objetivo

Estar regularizado a tempo do jogo, apresentar a carteirinha com QR code válido de forma rápida na beira da quadra e consultar seu histórico esportivo real (jogos em que foi escalado, credenciado e entrou em quadra, gols e cartões) sem depender de terceiros.

### 3.3. Frustrações (hipóteses de design)

1. **Incerteza sobre o estado do cadastro:** após criar a conta ou ter o cadastro rejeitado sem motivo detalhado, não saber o que pode revisar no próprio perfil (nome completo e foto) antes de solicitar nova análise.
2. **Ansiedade no credenciamento em quadra:** abrir a carteirinha no ginásio com conexão instável ou brilho baixo, ou descobrir apenas na mesa de arbitragem que o QR antigo foi substituído, que a carteirinha está invalidada ou que há uma suspensão vigente no campeonato.
3. **Confusão entre etapas de participação no histórico:** ver uma partida listada no histórico com métricas `null` ou zeradas sem perceber a diferença entre ter sido apenas *escalado preliminarmente pelo técnico*, ter sido *credenciado com camisa no banco* e ter *entrado em quadra*.
4. **Dúvida sobre preservação de histórico após transferência:** receio de que a mudança para outro clube apague seus gols anteriores ou exija uma nova carteirinha.

### 3.4. Capacidades reais do backend vs. bloqueios por contrato ou pendência

| Capacidade / Fluxo | Situação no backend | Referência exata no código / documentação |
| --- | --- | --- |
| Autocadastro com escolha obrigatória de clube inicial | **Permitido** | `POST /api/cadastros` e `GET /api/clubes` ([`AuthController`](../server/src/modules/autenticacao/auth.controller.ts)) |
| Consulta da sessão, status de verificação e clube atual | **Permitido** | `GET /api/sessao` ([`AuthService.sessao`](../server/src/modules/autenticacao/auth.service.ts), [`carregarAtor`](../server/src/modules/autorizacao/ator.ts)) |
| Edição do próprio nome completo (sem reabrir aprovação) | **Permitido** | `PATCH /api/conta` ([`ContaPropriaController`](../server/src/modules/contas/conta-propria.controller.ts), [`editarNomeProprio`](../server/src/modules/contas/contas.ts)) |
| Nova solicitação de análise após rejeição | **Permitido** | `POST /api/verificacoes/solicitacao` ([`VerificacoesController.solicitar`](../server/src/modules/verificacoes/verificacoes.controller.ts), [`solicitarNovamente`](../server/src/modules/verificacoes/verificacoes.ts)) |
| Envio, substituição e leitura da própria foto (até 4 MiB) | **Permitido** (inclusive pendente/rejeitado) | `PUT` e `GET /api/atletas/:atletaId/foto` ([`FotosController`](../server/src/modules/fotos/fotos.controller.ts), `LIMITE_FOTO_BYTES` em [`fotos.ts`](../server/src/modules/fotos/fotos.ts)) |
| Consulta da própria carteirinha e QR vigente | **Permitido** (após aprovação) | `GET /api/carteirinhas/minha` ([`CarteirinhasController.minha`](../server/src/modules/carteirinhas/carteirinhas.controller.ts), [`consultarPropria`](../server/src/modules/carteirinhas/carteirinhas.ts)) |
| Consulta do próprio histórico esportivo e totais | **Permitido** (somente aprovado) | `GET /api/atletas/:atletaId/historico` ([`HistoricoController.historico`](../server/src/modules/resultados/historico.controller.ts), [`consultarHistoricoDoAtleta`](../server/src/modules/resultados/historico.ts)) |
| Consulta da lista de clubes e técnicos atuais | **Permitido** | `GET /api/clubes/visao-geral` e `GET /api/clubes/:clubeId` ([`ClubesController`](../server/src/modules/clubes/clubes.controller.ts)) |
| Entrada na arbitragem quando designado para um jogo | **Permitido** (no dia local / em andamento) | `POST /api/arbitragem/jogos/:jogoId/entrada/designacao` e `GET/POST /api/jogos/:jogoId/arbitragem/senha...` ([`ArbitragemController`](../server/src/modules/arbitragem/arbitragem.controller.ts)) |
| Motivo da rejeição do cadastro | **Bloqueado por contrato** | Rejeição não armazena nem retorna motivo (`PEN-013`, [`rejeitar`](../server/src/modules/verificacoes/verificacoes.ts)) |
| Alteração de e-mail, senha, clube ou perfil pela conta | **Bloqueado por contrato / pendência** | [`edicaoContaSchema`](../server/src/modules/contas/conta-propria.controller.ts) aceita só `nomeCompleto`; recuperação de senha adiada (`PEN-030`) |
| Agenda geral de campeonatos e jogos futuros sem participação | **Bloqueado por contrato** | [`CampeonatosController`](../server/src/modules/campeonatos/campeonatos.controller.ts) e [`JogosController`](../server/src/modules/jogos/jogos.controller.ts) exigem `presidente` |
| Consulta de extrato de suspensões ou linha do tempo de vínculos | **Bloqueado por contrato** | [`SuspensoesController`](../server/src/modules/suspensoes/suspensoes.controller.ts) e [`AtletasController.vinculos`](../server/src/modules/atletas/atletas.controller.ts) exigem `presidente` |
| Carteirinha offline ou notificações Socket.IO na conta | **Fora de escopo / Bloqueado** | Internet obrigatória (`PEN-025`); Socket.IO exige cookie de arbitragem ([`NotificacoesService`](../server/src/modules/notificacoes/notificacoes.service.ts)) |

### 3.5. Jornada principal

1. **Cadastro e envio de foto:** acessa `/cadastro`, seleciona perfil `atleta`, escolhe e confirma seu clube inicial a partir de `GET /api/clubes` e cria a conta (`POST /api/cadastros`). Faz login (`/login`), vê o estado `pendente` em `GET /api/sessao` e envia sua foto em `PUT /api/atletas/:atletaId/foto` (JPEG, PNG ou WebP até 4 MiB).
2. **Acompanhamento ou reapresentação:** se o presidente rejeitar a solicitação (`statusVerificacao: "rejeitado"`), revisa seu `nomeCompleto` (`PATCH /api/conta`), atualiza a foto se necessário e aciona `POST /api/verificacoes/solicitacao` para voltar à fila `pendente`.
3. **Apresentação da carteirinha para o jogo:** uma vez aprovado (`aprovado: true`), abre sua tela inicial focada na carteirinha (`GET /api/carteirinhas/minha` + `GET /api/atletas/:atletaId/foto`), confere que a situação é `ativa` e apresenta o QR code na tela do celular para leitura pela arbitragem do jogo.
4. **Conferência de histórico pós-jogo:** consulta `GET /api/atletas/:atletaId/historico` para verificar seus totais acumulados (`escaladas`, `credenciadas`, `comEntradaEmQuadra`, `gols`, `cartoesAmarelos`, `exclusoesDoisMinutos`, `cartoesVermelhos`) e a lista cronológica de jogos com o clube representado em cada partida.

### 3.6. Prioridades de informação e ações

- **Enquanto `statusVerificacao === "pendente"` ou `"rejeitado"`:**
  1. Situação atual da verificação (`Pendente de análise pelo presidente` ou `Solicitação não aprovada`).
  2. Botão `"Solicitar nova análise"` (destacado quando `rejeitado`) e edição do `nomeCompleto` (`PATCH /api/conta`).
  3. Envio ou substituição da foto (`PUT /api/atletas/:atletaId/foto`), informando que a foto apoia a identificação, mas que a aprovação cabe ao presidente.
- **Quando `aprovado === true`:**
  1. **Carteirinha digital em destaque imediato:** QR code amplo e centralizado sobre superfície branca (`var(--superficie)`), `codigo` alfanumérico de 10 caracteres, `nomeCompleto`, `clubeAtual.nome`, foto (`GET /api/atletas/:atletaId/foto` quando `possuiFoto: true`) e selo explícito de situação (`Ativa` ou `Invalidada`).
  2. **Resumo de totais esportivos:** contadores separados para as três etapas (*Escalado*, *Credenciado*, *Entrou em quadra*) ao lado das quatro métricas oficiais (*Gols*, *Amarelos*, *Exclusões 2min*, *Vermelhos*).
  3. **Lista de participações do histórico:** cada jogo exibindo campeonato/categoria, data, clube representado naquele jogo (`clube.clube.nome` — preservado após transferência), adversário, placar sob a ótica do atleta (`placar.clube × placar.adversario`, quando disponível), camisa usada, etapas cumpridas e sinalização quando o jogo foi `cancelado` ou `invalidadoEm`.

### 3.7. Navegação orientadora do atleta

Proposta de barra de navegação com três destinos para quando a área do atleta for implementada:
1. **Carteirinha (`/atleta`):** visão imediata da carteirinha e do estado cadastral.
2. **Participações e Histórico (`/atleta/historico`):** totais acumulados e lista detalhada de participações por jogo (habilitada após aprovação).
3. **Conta e Clubes (`/atleta/conta`):** edição de `nomeCompleto`, troca de foto, consulta de `GET /api/clubes/visao-geral` e botão de saída (`POST /api/auth/sign-out`).

### 3.8. Estados vazios, erro, sucesso e aguardo

- **Aguardo (`pendente`):** painel com cores `--pendente` / `--pendente-fundo` informando *"Cadastro em análise pelo presidente"*, exibindo o clube selecionado, controles de foto e nome e botão `"Atualizar situação"` (`GET /api/sessao`).
- **Rejeitado (`rejeitado`):** alerta com `--rejeitado` / `--rejeitado-fundo` informando *"Cadastro não aprovado na análise anterior"*, sem inventar motivo inexistente no backend, orientando a revisar o nome completo e acionar `"Solicitar nova análise"` (ou contatar o presidente se houve erro na escolha inicial do clube).
- **Carteirinha invalidada (`status: "invalidada"`):** faixa de bloqueio em `--rejeitado` sobre a carteirinha: *"Carteirinha invalidada pelo presidente. Ela não autoriza novos credenciamentos até ser reativada."*
- **Carteirinha sem foto (`possuiFoto: false`):** espaço reservado com iniciais/silhueta neutra e atalho *"Enviar foto (JPEG, PNG ou WebP até 4 MiB)"*, explicitando que a carteirinha continua válida mesmo sem foto (`requisitos, seção 15`).
- **Histórico vazio (`jogos: []`):** *"Nenhuma participação registrada ainda. Quando seu técnico escalar você ou a arbitragem credenciar sua participação em um jogo, a partida aparecerá aqui."*
- **Erros de envio de foto (`413` / `415` / `503`):** traduzir fielmente o contrato: arquivo acima de 4 MiB (`413`, mensagem da API `"A foto deve ter no máximo 4 MB."`), formato diferente de JPEG/PNG/WebP (`415`) ou armazenamento temporariamente indisponível preservando a foto anterior (`503`).
- **Sucesso:** confirmação inline após resposta da API (`"Nome atualizado"`, `"Foto atualizada"`, `"Nova análise solicitada ao presidente"`).

### 3.9. Acessibilidade e mobile

- **Apresentação do QR code em quadra:** renderizar o QR code sobre fundo `--superficie` (`#ffffff`), com margem de silêncio (*quiet zone*) de no mínimo 4 módulos e botão `"Ampliar QR para leitura"`, garantindo foco rápido pela câmera da arbitragem.
- **Alternativa textual ao QR:** exibir o `codigo` de 10 caracteres em `--display` tabular logo abaixo do QR code para conferência manual.
- **Sem dependência exclusiva de cor:** diferenciar `Escalado`, `Credenciado` e `Entrou em quadra` e os status `Ativa`/`Invalidada` por rótulos textuais explícitos, nunca apenas por cor.

### 3.10. Critérios observáveis de avaliação da interface

1. Um atleta aprovado exibe o QR code vigente e o código da carteirinha em **menos de 2 toques** após o login.
2. Um atleta com cadastro `rejeitado` identifica e aciona `"Solicitar nova análise"` sem precisar de instrução externa sobre onde clicar.
3. Ao inspecionar o histórico de jogos, o atleta distingue sem erro em quais partidas apenas foi escalado, em quais ficou no banco (credenciado sem entrada) e em quais entrou em quadra, além de distinguir jogos `agendado`, `em_andamento`, `finalizado` e `cancelado`.
4. Após uma transferência de clube, o atleta identifica na carteirinha o novo `clubeAtual` e, no histórico, reconhece que os jogos antigos continuam atribuídos ao clube representado na época.

### 3.11. Perguntas para validar as hipóteses

1. Na chegada à quadra, você abre o sistema na hora de passar pela mesa de arbitragem ou tenta guardar captura de tela antes? Como deixar evidente na tela que o QR pode ser substituído e que o credenciamento exige internet na mesa?
2. Quando um cadastro é rejeitado sem justificativa textual no sistema, por qual canal você fala com o presidente ou com seu técnico para saber o que corrigir?
3. Ao olhar para os jogos passados no seu histórico, a diferença entre *"Escalado"*, *"Credenciado (camisa N)"* e *"Entrou em quadra"* fica imediatamente compreensível?

---

## 4. Proto-persona 2: Técnico

### 4.1. Contexto e tarefas do papel

Pessoa responsável por escolher previamente os atletas do seu clube para cada partida agendada (escalação preliminar) e por acompanhar o desempenho coletivo dos jogos do clube e o histórico individual dos atletas atualmente vinculados ao seu clube. Cria sua conta sem clube inicial, aguarda aprovação cadastral e atribuição a um clube pelo presidente, e opera principalmente pelo celular antes e depois dos jogos. Não possui carteirinha (`RN-012`) e pode ficar temporariamente sem clube atribuído (`RN-004`).

### 4.2. Objetivo

Montar e ajustar com segurança a lista preliminar de atletas elegíveis do seu clube antes do início do jogo — ciente de quem possui alerta de suspensão pendente — para agilizar o credenciamento pela arbitragem, além de analisar os resultados e métricas reais após cada partida.

### 4.3. Frustrações (hipóteses de design)

1. **Falta de agenda automática e ausência do nome do adversário antes do início do jogo:** o backend restringe a listagem de campeonatos e jogos ao presidente; além disso, para um jogo ainda `agendado`, nem `GET /api/jogos/:jogoId/escalacao` nem `GET /api/jogos/:jogoId/desempenho` retornam o nome do clube adversário (pois `placar` é `null` antes do início e `resumoJogo` não inclui inscrições).
2. **Atletas do clube que não aparecem na lista de escalação:** em `GET /api/jogos/:jogoId/escalacao`, `atletasDoClube` traz apenas quem está aprovado, com conta ativa e carteirinha ativa; se um atleta não aparece ali, o técnico não sabe pelo sistema qual desses requisitos falta.
3. **Alerta de suspensão sem detalhes:** ver `suspensaoPendente: true` em um atleta na escalação sem conseguir consultar no sistema quantos jogos faltam cumprir ou o motivo da punição.
4. **Risco de confundir escalação com credenciamento:** achar que escalar garante a participação no jogo ou impede a arbitragem de credenciar um atleta elegível fora da lista.
5. **Mudança de status do jogo:** tentar alterar a escalação quando a arbitragem já iniciou a partida (`em_andamento`), já a encerrou (`finalizado`) ou quando o presidente a cancelou (`cancelado`), recebendo `409 Conflict`.

### 4.4. Capacidades reais do backend vs. bloqueios por contrato ou pendência

| Capacidade / Fluxo | Situação no backend | Referência exata no código / documentação |
| --- | --- | --- |
| Autocadastro inicial sem clube e solicitação de verificação | **Permitido** | `POST /api/cadastros` ([`AuthController.cadastrar`](../server/src/modules/autenticacao/auth.controller.ts)) |
| Consulta de sessão (`aprovado`, `clubeId`), edição de nome e reapresentação | **Permitido** | `GET /api/sessao`, `PATCH /api/conta`, `POST /api/verificacoes/solicitacao` |
| Consulta de todos os clubes e técnicos atuais | **Permitido** | `GET /api/clubes/visao-geral` e `GET /api/clubes/:clubeId` ([`ClubesController`](../server/src/modules/clubes/clubes.controller.ts)) |
| Consulta e edição da escalação preliminar do próprio clube em jogo `agendado` | **Permitido** (técnico aprovado com `clubeId`) | `GET`, `POST` e `DELETE /api/jogos/:jogoId/escalacao...` ([`EscalacaoController`](../server/src/modules/participacoes/escalacao.controller.ts), [`escalacao.ts`](../server/src/modules/participacoes/escalacao.ts)) |
| Consulta de resumo (`campeonato`, `local`, `status`, datas, `resultado`), `placar` e `participacoes` dos dois clubes | **Permitido** (técnico aprovado de um dos clubes do jogo) | `GET /api/jogos/:jogoId/desempenho` ([`HistoricoController.desempenho`](../server/src/modules/resultados/historico.controller.ts), [`consultarDesempenhoDoJogo`](../server/src/modules/resultados/historico.ts)) |
| Consulta do histórico completo e da foto dos atletas **atualmente vinculados** ao seu clube | **Permitido** (somente vínculo aberto atual no clube do técnico) | `GET /api/atletas/:atletaId/historico` ([`consultarHistoricoDoAtleta`](../server/src/modules/resultados/historico.ts)) e `GET /api/atletas/:atletaId/foto` ([`chaveParaConta`](../server/src/modules/fotos/fotos.ts)) |
| Credenciar atleta, informar camisa, registrar entrada em quadra ou iniciar/encerrar jogo | **Bloqueado por contrato** | Exclusivo da sessão temporária da arbitragem ([`CredenciamentoController`](../server/src/modules/participacoes/credenciamento.controller.ts), [`CicloJogoController`](../server/src/modules/jogos/ciclo.controller.ts)) |
| Listar campeonatos (`GET /api/campeonatos`) ou jogos (`GET /api/campeonatos/:id/jogos`, `GET /api/jogos/:id`) | **Bloqueado por contrato** | [`CampeonatosController`](../server/src/modules/campeonatos/campeonatos.controller.ts) e [`JogosController`](../server/src/modules/jogos/jogos.controller.ts) exigem `presidente` (`INS-001`) |
| Ver o nome do clube adversário enquanto o jogo está `agendado` | **Bloqueado pelo contrato atual dos payloads** | [`consultarEscalacao`](../server/src/modules/participacoes/escalacao.ts) filtra `inscricoes` pelo clube do técnico; em [`consultarDesempenhoDoJogo`](../server/src/modules/resultados/historico.ts), `resumoJogo` não traz inscrições e `placar` (que contém `clubeA` e `clubeB`) é `null` antes do início (salvo W.O. finalizado) |
| Ler foto ou histórico de atleta já transferido para outro clube (`vinculoAtual: false`) | **Bloqueado por contrato (`403 Forbidden`)** | [`chaveParaConta`](../server/src/modules/fotos/fotos.ts) e [`consultarHistoricoDoAtleta`](../server/src/modules/resultados/historico.ts) exigem vínculo aberto atual no clube do técnico |
| Consultar extrato de suspensões (`GET /api/campeonatos/:id/suspensoes`) | **Bloqueado por contrato** | [`SuspensoesController`](../server/src/modules/suspensoes/suspensoes.controller.ts) exige `presidente` (`INS-002`); técnico vê apenas o booleano `suspensaoPendente` na escalação |
| Listar elenco completo com atletas inaptos (pendentes, inativos ou com carteirinha invalidada) | **Bloqueado por contrato** | `atletasDoClube` em [`consultarEscalacao`](../server/src/modules/participacoes/escalacao.ts) retorna apenas atletas aptos |

### 4.5. Jornada principal

1. **Cadastro, aprovação e vínculo com clube:** cadastra-se como `tecnico` (`POST /api/cadastros`), acompanha sua aprovação (`GET /api/sessao`) e aguarda o presidente atribuí-lo a um clube (`PUT /api/clubes/:clubeId/tecnico`). Quando `aprovado: true` e `clubeId !== null`, sua área operacional é liberada.
2. **Abertura do jogo por link ou ID:** recebe do presidente o link da partida (proposta: `/tecnico/jogos/{jogoId}`) ou abre um jogo já conhecido pelo histórico de seus atletas. O frontend consulta `GET /api/jogos/:jogoId/escalacao` (obtendo seu `clube`, `status`, `inicioPrevistoLocal`, `fusoHorario`, `escalados`, `alteracoes` e `atletasDoClube`) e `GET /api/jogos/:jogoId/desempenho` (obtendo `jogo.campeonato` e `jogo.local`). Enquanto o jogo estiver `agendado` (`placar: null`), a tela exibe os dados confirmados pelo servidor e indica de forma transparente que o confronto completo com o adversário e placar ficará disponível em `/desempenho` quando a partida iniciar ou encerrar.
3. **Montagem e revisão da escalação preliminar:** enquanto `status === "agendado"`, inclui (`POST /api/jogos/:jogoId/escalacao`) ou retira (`DELETE /api/jogos/:jogoId/escalacao/:atletaId`) atletas a partir de `atletasDoClube`. Confere alertas de `suspensaoPendente: true` e escolhas antigas com `vinculoAtual: false` (atleta transferido após ter sido escalado, cuja escolha antiga pode ser retirada pelo técnico atual mas não servirá para credenciamento pelo clube anterior) e consulta `alteracoes`.
4. **Acompanhamento de desempenho e histórico:** após o início (`em_andamento`) ou encerramento (`finalizado`, inclusive W.O.), consulta `GET /api/jogos/:jogoId/desempenho` (atualizando sob demanda via REST), onde `placar` passa a exibir `clubeA` e `clubeB` com pontuação e métricas dos atletas dos dois clubes. Para atletas com vínculo atual no seu clube, abre `GET /api/atletas/:atletaId/historico`.

### 4.6. Prioridades de informação e ações

1. **Estado do vínculo do técnico:** exibir no topo o clube atual (`GET /api/clubes/:clubeId`) ou um aviso quando `aprovado: true` mas `clubeId === null` (*"Aprovado, aguardando atribuição a um clube pelo presidente"*).
2. **Cabeçalho contextual do jogo (fiel ao que o backend retorna em cada status):**
   - Sempre disponíveis via `/escalacao` + `/desempenho`: nome, edição e categoria do `campeonato`, nome do próprio `clube` do técnico, `local` (se cadastrado), `inicioPrevistoLocal` com `fusoHorario` e `status` (`agendado`, `em_andamento`, `finalizado`, `cancelado`).
   - Quando `placar !== null` (jogo `em_andamento` ou `finalizado`): exibir confronto `clubeA.clube.nome × clubeB.clube.nome`, placar atualizado, `resultado`, `vencedorInscricaoId` e estado de interrupção ou invalidação.
   - Quando `placar === null`, indicar a indisponibilidade conforme o estado: em jogo `agendado`, *"Adversário e placar indisponíveis nesta consulta antes do início"*; em jogo `cancelado`, *"Adversário e placar indisponíveis nesta consulta. Partida cancelada"*. Não prometer início para um jogo cancelado, inventar o adversário ou tratar parâmetros de URL como estado oficial.
3. **Painel de escalação dividido em duas listas claras:**
   - **Escalados para o jogo (`escalados`):** nome completo, quem escalou (`escolhidaPorTecnico.nomeCompleto`), alertas para `suspensaoPendente: true` (*"Suspensão vigente no campeonato: a escolha é permitida, mas o credenciamento será barrado se o saldo não for cumprido antes do jogo"*) e para `vinculoAtual: false` (*"Transferido após a escolha: não poderá ser credenciado por este clube"*), e botão `"Retirar"` (ativo apenas se `status === "agendado"`). Para atletas com `vinculoAtual: true`, pode exibir foto sob demanda (`GET /api/atletas/:atletaId/foto`); para `vinculoAtual: false`, exibir apenas iniciais/placeholder sem requisitar a rota de foto (que responde `403` após transferência).
   - **Disponíveis no clube para escalar (`atletasDoClube` não escalados):** busca rápida por nome, alerta `suspensaoPendente` quando houver e botão `"+ Escalar"`.
4. **Visão de desempenho da partida e ficha de atletas do clube:** tabela de participações de `GET /api/jogos/:jogoId/desempenho` separando `Camisa`, `Etapa (Escalado / Credenciado / Em quadra)` e métricas (`Gols`, `Amarelos`, `2min`, `Vermelhos`), com link para `GET /api/atletas/:atletaId/historico` apenas nos atletas que pertencem atualmente ao clube do técnico.

### 4.7. Navegação orientadora do técnico

Navegação com três seções para a área do técnico:
1. **Jogos e Escalação (`/tecnico` e `/tecnico/jogos/[jogoId]`):** entrada por link/ID do jogo enviado pelo presidente e lista de atalhos dos jogos já abertos naquele navegador (rotulados com o `campeonato`, `inicioPrevistoLocal` e, quando já iniciado/finalizado ou visto no histórico de um atleta, o confronto oficial).
2. **Meu Clube e Atletas (`/tecnico/clube`):** dados do clube atual (`GET /api/clubes/:clubeId`) e acesso ao histórico (`GET /api/atletas/:atletaId/historico`) e foto dos atletas atuais conhecidos pelas escalações/participações do clube.
3. **Conta (`/tecnico/conta`):** situação cadastral, edição do `nomeCompleto` (`PATCH /api/conta`), visão geral de clubes (`GET /api/clubes/visao-geral`) e logout.

### 4.8. Estados vazios, erro, sucesso e aguardo

- **Técnico aprovado sem clube (`clubeId === null`):** *"Sua conta de técnico está aprovada, mas você ainda não está vinculado a um clube. Solicite ao presidente a atribuição do seu perfil ao clube para escalar atletas."*
- **Nenhum jogo aberto ainda no navegador:** *"Abra o link do jogo enviado pelo presidente ou informe o identificador da partida para escalar atletas ou consultar o desempenho."*
- **Lista `atletasDoClube` vazia ou sem um atleta esperado:** nota explicativa permanente: *"Aparecem para escalação apenas atletas com cadastro aprovado, conta ativa, carteirinha ativa e vínculo atual com o clube. Se alguém do clube não estiver listado, confirme a situação cadastral com o presidente."*
- **Bloqueio de edição da escalação conforme o status real do jogo (`status !== "agendado"`):** distinguir cada estado sem agrupá-los em uma mensagem ambígua:
  - Quando `status === "em_andamento"`: *"Partida em andamento. A escalação preliminar foi encerrada no início do jogo; a partir de agora, somente a arbitragem inclui ou credencia atletas."*
  - Quando `status === "finalizado"`: *"Partida finalizada. A escalação preliminar está encerrada e os registros do jogo estão em modo de consulta."*
  - Quando `status === "cancelado"`: *"Partida cancelada pelo presidente. A escalação não pode mais ser alterada e este jogo não terá credenciamento nem contará para suspensões."*
  - Se o status mudar enquanto a página estava aberta e `POST`/`DELETE` retornar `409 Conflict`, recarregar os dados do jogo e exibir a faixa correspondente ao novo status.
- **Aguardo e atualização manual:** como o técnico não recebe eventos via Socket.IO, exibir botão `"Atualizar dados do jogo"` ao consultar uma partida.

### 4.9. Acessibilidade e mobile

- **Operação com uma mão antes do jogo:** botões `"+ Escalar"` e `"Retirar"` com altura mínima de `44px` (`2.75rem`), posicionados de forma consistente, evitando cliques acidentais.
- **Carregamento seguro de fotos:** requisitar `GET /api/atletas/:atletaId/foto` apenas para atletas com vínculo atual no clube do técnico (`vinculoAtual: true`), com `loading="lazy"`, tratando `404` (atleta sem foto) ou `403` (transferência concorrente) com avatar de iniciais sem novas tentativas automáticas.
- **Anúncio de mudanças para leitores de tela:** usar região `aria-live="polite"` para anunciar inclusões e retiradas confirmadas.

### 4.10. Critérios observáveis de avaliação da interface

1. Ao abrir um jogo `agendado` do seu clube, o técnico identifica o campeonato, o local, o horário local da partida e o seu clube, e compreende que o nome do adversário e o placar só aparecem na visão de desempenho após o início da partida.
2. O técnico consegue escalar atletas elegíveis e retirar escolhas (inclusive com `vinculoAtual: false`) sem erros, compreendendo que números de camisa e credenciamento cabem à arbitragem no dia do jogo.
3. Diante de um atleta com `suspensaoPendente: true`, o técnico compreende que o sistema permite a escolha preliminar, mas que a arbitragem bloqueará o credenciamento caso a suspensão continue vigente na partida.
4. Quando um atleta recém-cadastrado não aparece em `atletasDoClube`, o técnico reconhece pela explicação da tela que deve verificar aprovação/carteirinha com o presidente.

### 4.11. Perguntas para validar as hipóteses

1. Como o presidente avisa você sobre a tabela de jogos (grupo de mensagens, link direto, planilha)? Ao abrir o link de um jogo agendado para escalar seu clube, a ausência do nome do adversário na tela de escalação atrapalha a escolha ou você já sabe contra quem vai jogar pelo aviso do presidente?
2. Quando você vê o alerta de *Suspensão pendente* ao lado do nome do atleta na escalação, você já sabe quantos jogos faltam cumprir ou precisa perguntar ao presidente?
3. Quando um técnico substitui outro no clube, ver o histórico de quem incluiu ou retirou cada atleta na escalação ajuda na transição?

---

## 5. Proto-persona 3: Presidente

### 5.1. Contexto e tarefas do papel

Dirigente responsável pela governança esportiva e administrativa da associação: analisa e aprova ou rejeita cadastros de atletas e técnicos, administra carteirinhas (invalidação, reativação, substituição de QR e leitura de conferência) e fotos, cria e edita clubes, atribui ou substitui técnicos, transfere atletas entre clubes quando não há campeonato em andamento, conduz o ciclo manual dos campeonatos e inscrições, agenda jogos com fuso horário do local, designa árbitros e distribui/troca a senha compartilhada do jogo, aplica/reduz/revoga suspensões e realiza correções administrativas pós-jogo em partidas finalizadas.

### 5.2. Objetivo

Manter cadastros, clubes, campeonatos, escalas de arbitragem, punições disciplinares e resultados oficiais íntegros e auditáveis, resolvendo exceções operacionais (adiamentos, troca de senha de arbitragem, retificação de súmula após o encerramento) sem comprometer a consistência histórica do banco.

### 5.3. Frustrações (hipóteses de design)

1. **Dependência de sequência em correções administrativas pós-jogo (`MAR-83`):** para estornar o credenciamento de um atleta que não jogou mas recebeu entrada em quadra ou gols por engano, ou para atribuir a camisa dele ao atleta real que participou, o backend exige uma ordem estrita (anular a entrada em quadra → transferir ou anular cada lançamento individualmente → estornar o credenciamento → ajustar a camisa).
2. **Fronteira rígida entre jogo em andamento, agendado e finalizado:** tentar corrigir lançamento, resultado ou credenciamento enquanto a partida ainda está `em_andamento` (o backend bloqueia com `409`, pois durante o jogo a competência é exclusiva da arbitragem) ou tentar adiar/cancelar um jogo já iniciado ou finalizado.
3. **Bloqueio de transferência por campeonato em andamento (`RN-006`, `PEN-017`):** tentar transferir um atleta cujo clube atual já foi eliminado, mas cujo campeonato continua `em_andamento`, recebendo bloqueio até o encerramento do campeonato.
4. **Ausência de listagem oficial de presidentes no servidor (`INS-003`):** ao acessar a conta em outro navegador, não ver listados automaticamente os demais presidentes cadastrados nem sua situação ativa/inativa antes de executar uma ação.
5. **Reconciliação de suspensões automáticas após retificar súmula:** precisar verificar imediatamente se a correção ou anulação de um cartão vermelho com relatório disciplinar (`relatorioDisciplinar: true`) criou ou anulou uma suspensão automática (`suspensoesAutomaticas { criadas, anuladas }`).

### 5.4. Capacidades reais do backend vs. bloqueios por contrato ou pendência

| Capacidade / Fluxo | Situação no backend | Referência exata no código / documentação |
| --- | --- | --- |
| Aprovar ou rejeitar solicitações de atletas e técnicos | **Permitido** (aprovar atleta emite carteirinha e confirma vínculo) | `GET /api/verificacoes`, `POST /api/verificacoes/:usuarioId/aprovacao` e `/rejeicao` ([`VerificacoesController`](../server/src/modules/verificacoes/verificacoes.controller.ts)) |
| Gerir carteirinhas (consultar histórico, invalidar, reativar, substituir QR por `versaoQr` e ler QR) | **Permitido** | `GET /api/carteirinhas/atleta/:id`, `POST .../invalidacao`, `.../reativacao`, `.../substituicao-qr`, `POST /api/carteirinhas/leitura` ([`CarteirinhasController`](../server/src/modules/carteirinhas/carteirinhas.controller.ts)) |
| Enviar/ler foto de atleta (até 4 MiB) e desativar/reativar contas de terceiros | **Permitido** (protege último presidente ativo e recusa a própria conta) | `PUT/GET /api/atletas/:id/foto` ([`FotosController`](../server/src/modules/fotos/fotos.controller.ts)), `POST /api/contas/:id/desativacao` e `/reativacao` ([`ContasController`](../server/src/modules/contas/contas.controller.ts)) |
| Criar outro presidente informando `nomeCompleto`, `email` e `password` inicial | **Permitido** (resposta retorna apenas `usuario` e `criadoPorPresidenteId`, **sem devolver a senha**) | `POST /api/presidentes` ([`PresidentesController.criar`](../server/src/modules/presidentes/presidentes.controller.ts)) |
| Criar/editar clubes e atribuir, substituir (`substituirTecnicoId`) ou desvincular técnico | **Permitido** | `POST/PATCH/GET /api/clubes...`, `PUT/DELETE /api/clubes/:id/tecnico...` ([`ClubesController`](../server/src/modules/clubes/clubes.controller.ts)) |
| Consultar vínculos e transferir atleta aprovado (`clubeAtualId` → `clubeDestinoId`) | **Permitido** (bloqueado se clube atual está em campeonato `em_andamento`) | `GET /api/atletas/:id/vinculos`, `POST /api/atletas/:id/transferencia` ([`AtletasController`](../server/src/modules/atletas/atletas.controller.ts), [`transferencias.ts`](../server/src/modules/atletas/transferencias.ts)) |
| Criar campeonatos, gerir inscrições (só `planejado`) e transicionar (`iniciar`, `encerrar`, `cancelar`) | **Permitido** | `POST/GET /api/campeonatos...`, `POST/DELETE .../inscricoes...`, `POST .../iniciar|encerrar|cancelar` ([`CampeonatosController`](../server/src/modules/campeonatos/campeonatos.controller.ts)) |
| Agendar jogos (hora local + fuso IANA), adiar/cancelar jogo `agendado`, designar/retirar arbitragem e consultar/trocar senha do jogo | **Permitido** (consulta e troca da senha do jogo retornam `senha`) | [`JogosController`](../server/src/modules/jogos/jogos.controller.ts), [`CicloJogoController`](../server/src/modules/jogos/ciclo.controller.ts), [`ArbitragemController`](../server/src/modules/arbitragem/arbitragem.controller.ts) |
| Aplicar suspensão manual, listar suspensões e reduzir ou revogar (manuais e automáticas) com `justificativa` | **Permitido** | `POST/GET /api/campeonatos/:id/suspensoes`, `POST .../:suspensaoId/reduzir` e `/revogar` ([`SuspensoesController`](../server/src/modules/suspensoes/suspensoes.controller.ts)) |
| Corrigir pós-jogo (**somente com jogo `finalizado`**): resultado/vencedor, invalidação, camisa, participação administrativa (com irregularidades), anulação de entrada, estorno de credenciamento e correção/anulação de lançamentos existentes | **Permitido** | [`CicloJogoController`](../server/src/modules/jogos/ciclo.controller.ts), [`CredenciamentoPresidenteController`](../server/src/modules/participacoes/credenciamento.controller.ts), [`LancamentosPresidenteController`](../server/src/modules/resultados/lancamentos.controller.ts)) |
| Escalar atletas, iniciar/interromper/retomar/encerrar jogo ou arbitrar por designação | **Bloqueado por contrato** | Escalação é exclusiva do técnico ([`EscalacaoController`](../server/src/modules/participacoes/escalacao.controller.ts)); ciclo em quadra é exclusivo da arbitragem; presidente não é designado árbitro ([`jogos.ts`](../server/src/modules/jogos/jogos.ts)) |
| Adicionar novo lançamento (gol/cartão) após o encerramento ou corrigir durante o jogo | **Bloqueado por contrato** | [`LancamentosPresidenteController`](../server/src/modules/resultados/lancamentos.controller.ts) possui apenas `GET`, `:id/correcao` e `:id/anulacao` e exige `status === "finalizado"` |
| Listar presidentes cadastrados ou consultar status de conta sem mutação | **Bloqueado por contrato** | Não há `GET /api/presidentes` nem `GET /api/contas/:id` (`INS-003`, [`PresidentesController`](../server/src/modules/presidentes/presidentes.controller.ts)) |
| Retirar aprovação cadastral ou excluir clubes, campeonatos e contas | **Bloqueado por contrato** | `PEN-013`, `PEN-015`, `PEN-016`: histórico é preservado; apenas desativação de conta ou invalidação de carteirinha existem |

### 5.5. Jornada principal

1. **Triagem e habilitação de pessoas:** revisa `GET /api/verificacoes?status=pendente`, confere nome completo, foto (`GET /api/atletas/:atletaId/foto`) e clube informado e aprova (`POST /api/verificacoes/:usuarioId/aprovacao`) ou rejeita. Para técnicos aprovados, acessa o clube correspondente e realiza a atribuição (`PUT /api/clubes/:clubeId/tecnico`).
2. **Planejamento e abertura de campeonato:** cria o campeonato (`POST /api/campeonatos`), inscreve ao menos dois clubes enquanto `planejado` (`POST /api/campeonatos/:campeonatoId/inscricoes`), agenda os jogos definindo data/hora local e fuso IANA (`POST /api/campeonatos/:campeonatoId/jogos`) e inicia a competição (`POST /api/campeonatos/:campeonatoId/iniciar`).
3. **Preparação da arbitragem e acompanhamento da rodada:** no subcontexto do jogo (`/presidente/campeonatos/[id]/jogos/[jogoId]`), designa árbitros cadastrados ou externos (`POST /api/jogos/:jogoId/arbitragens`) e consulta ou troca a senha compartilhada (`GET/POST /api/jogos/:jogoId/arbitragem/senha...`) para entregá-la aos árbitros externos. Se houver imprevisto enquanto `agendado`, adia (`POST /api/jogos/:jogoId/adiamento`, renovando a senha) ou cancela (`POST /api/jogos/:jogoId/cancelamento`).
4. **Auditoria pós-jogo e gestão disciplinar:** após o encerramento pela arbitragem (`status: "finalizado"`), confere resultado (`GET /api/jogos/:jogoId/resultado`), credenciamentos (`GET /api/jogos/:jogoId/credenciamentos`), lançamentos (`GET /api/jogos/:jogoId/lancamentos`) e suspensões (`GET /api/campeonatos/:campeonatoId/suspensoes`). Quando necessário, executa correções administrativas de participação, lançamentos ou resultado, e aplica, reduz ou revoga suspensões com justificativa.

### 5.6. Prioridades de informação e ações

1. **Fila de verificações pendentes e fichas de pessoas:** acesso rápido às solicitações `pendente` (ordenadas por antiguidade de solicitação), separadas da consulta de pessoas conhecidas pelas verificações.
2. **Visão operacional do campeonato e de seus pré-requisitos de transição:** exibir claramente o que habilita ou bloqueia cada transição manual (`Iniciar` exige `>= 2` clubes inscritos em campeonato `planejado`; `Encerrar` exige campeonato `em_andamento` com `0` jogos agendados ou em andamento; `Cancelar` exige campeonato `planejado` ou `em_andamento` com `0` jogos em andamento e cancela os agendados).
3. **Painel do jogo organizado conforme o status (`agendado`, `em_andamento`, `finalizado`, `cancelado`):**
   - **Jogo `agendado`:** habilita adiamento, cancelamento, designação/retirada de arbitragem, consulta/troca da senha do jogo e leitura das escalações preliminares dos dois clubes.
   - **Jogo `em_andamento`:** mantém designação/retirada de arbitragem e consulta/troca de senha do jogo; desabilita adiamento e cancelamento (explicando que jogo iniciado só termina pelo encerramento da arbitragem) e mantém escalação, credenciamentos e lançamentos em modo consulta (com botão `"Atualizar"`), informando que correções do presidente só abrem após o encerramento.
   - **Jogo `finalizado`:** encerra a gestão de arbitragem/senha e habilita o bloco de **Correções Administrativas do Presidente** (registro de participação administrativa, anulação de entrada, transferência/anulação de lançamentos, estorno de credenciamento sem entrada nem lançamentos válidos, correção de camisa, correção de resultado/vencedor e invalidação com motivo).
   - **Jogo `cancelado`:** exibe o jogo em modo estritamente de consulta histórica, informando que os acessos da arbitragem foram revogados, que o jogo não cumpre suspensões e que não há operações de correção pós-jogo nem de reagendamento.
4. **Painel disciplinar do campeonato:** lista de suspensões distinguindo `origem: "manual"` e `origem: "automatica"`, exibindo `quantidadeJogos` original, `quantidadeAtual`, `jogosCumpridos`, `jogosRestantes`, `situacao` (`vigente`, `cumprida`, `revogada`, `saldo_encerrado`, `anulada`) e histórico de reduções e cumprimentos.

### 5.7. Navegação (cinco abas principais e subcontextos)

Conforme implementado em [`PresidenteShell`](../client/src/features/presidente/shell.tsx), a área do presidente possui **cinco abas** de navegação principal, com **Jogos** operando como subcontexto dentro de **Campeonatos**:
1. **Cadastros (`/presidente`):** fila de verificações (`pendente`, `aprovado`, `rejeitado`), filtro por perfil e ações de aprovar/rejeitar.
2. **Pessoas (`/presidente/pessoas` e `/presidente/pessoas/[usuarioId]`):** atletas e técnicos conhecidos pelas verificações e ficha individual (ativação da conta, carteirinha, foto, vínculos/transferência e histórico esportivo). *(Nota: eventual utilitário na UI para acionar `POST /api/carteirinhas/leitura` é proposta de melhoria futura, não funcionalidade entregue na tela atual).*
3. **Clubes (`/presidente/clubes` e `/presidente/clubes/[clubeId]`):** criação e edição de clubes, gestão da vaga de técnico (`atribuir`, `substituir`, `desvincular`) e elenco vinculado.
4. **Campeonatos (`/presidente/campeonatos` e `/presidente/campeonatos/[id]`):** criação, inscrições de clubes, transições de ciclo, suspensões e lista de jogos, que abre o **subcontexto do Jogo** em `/presidente/campeonatos/[id]/jogos/[jogoId]` (mantendo a aba `Campeonatos` ativa). No jogo agendado, a interface oferece o link para o técnico, com alternativa de cópia manual.
5. **Conta (`/presidente/conta`):** edição do próprio nome, criação de novo presidente (`POST /api/presidentes`), gestão de ativação de contas de presidentes por referência local/ID (`POST /api/contas/:usuarioId/desativacao|reativacao`) e logout.

### 5.8. Estados vazios, erro, sucesso e aguardo

- **Estados vazios (`empty states`):**
  - *Sem solicitações no filtro atual (`/presidente`):* informar que não há cadastros naquele status/perfil e oferecer atalho para alternar o filtro ou abrir `Pessoas`.
  - *Clube sem técnico (`/presidente/clubes/[clubeId]`):* indicar que o clube está sem técnico atribuído (permitido por `RN-004`, ficando sem escalação preliminar até que um técnico aprovado e ativo seja vinculado) e exibir o seletor de atribuição.
  - *Campeonato sem inscrições ou sem jogos (`/presidente/campeonatos/[id]`):* orientar a inscrever ao menos dois clubes enquanto `planejado` antes de iniciar o campeonato ou agendar partidas.
  - *Jogo sem credenciamentos, sem lançamentos ou campeonato sem suspensões:* declarar a ausência de registros naquele recorte sem confundi-la com falha de carregamento.
- **Aguardo e envio em andamento (`loading` / `enviando`):**
  - Na leitura inicial da página ou seção, exibir estado textual com `role="status"` (`"Consultando…"`).
  - Durante qualquer mutação (`POST`, `PUT`, `PATCH`, `DELETE`), desabilitar o botão de ação trocando seu rótulo para `"Enviando…"` (ou verbo correspondente) e bloquear o fechamento do diálogo modal (`bloqueado={enviando}` em [`Dialogo`](../client/src/features/ui/dialogo.tsx)), impedindo cliques repetidos, `"Voltar"` ou `Escape` até a resposta do servidor.
- **Sucesso confirmado:**
  - Apresentar confirmação somente após uma resposta HTTP de sucesso conforme o contrato (`200`, `201` ou `204`, inclusive sem corpo). Quando a resposta incluir `alterado`, distinguir mudança (`true`) de repetição sem novo efeito (`false`, por exemplo uma transição já aplicada).
  - Ao criar um novo presidente (`POST /api/presidentes`), limpar imediatamente os campos do formulário (especialmente a senha inicial digitada) após o sucesso.
  - Ao corrigir ou anular um lançamento pós-jogo, se `suspensoesAutomaticas.criadas.length > 0` ou `anuladas.length > 0`, exibir aviso explícito informando que a mudança do cartão vermelho com relatório disciplinar criou ou anulou suspensão automática no campeonato.
- **Erro de releitura após mutação já salva:**
  - Quando a requisição de escrita (`POST`/`PUT`/`PATCH`/`DELETE`) é confirmada pelo backend, mas a consulta subsequente (`GET`) para atualizar a lista ou ficha falha por oscilação de rede, a interface **deve preservar a confirmação de que a alteração já foi salva** e exibir um aviso separado de falha na releitura com botão `"Atualizar dados"`, evitando que o presidente reenvie a mutação pensando que ela não foi gravada.
- **Conflitos de estado (`409 Conflict`):**
  - Em correção de camisa (`credenciamentoMudou`), correção de lançamento (`conflitoAnulado`), correção de resultado (`corrigirResultado`) ou substituição de técnico (`atribuirTecnico`), exibir o estado vigente retornado pelo servidor e atualizar a tela para nova decisão.
  - No bloqueio de estorno de credenciamento (`409`), explicitar se restam entrada em quadra válida ou lançamentos válidos que precisam ser anulados/transferidos antes.

### 5.9. Acessibilidade e mobile

- **Diálogos de confirmação seguros e bloqueio durante mutação:** ações irreversíveis ou de alto impacto (aprovar/rejeitar cadastro, invalidar jogo, encerrar/cancelar campeonato, revogar/reduzir suspensão, desativar conta, trocar senha da arbitragem) usam o padrão de [`Dialogo`](../client/src/features/ui/dialogo.tsx) e [`Confirmacao`](../client/src/features/ui/confirmacao.tsx): foco inicial em `"Voltar"`, retorno do foco ao elemento de origem ao fechar, fechamento por `Escape` ou `"Voltar"` **apenas enquanto `!enviando`**, e bloqueio total de fechamento (`Escape`, cancelamento nativo e `"Voltar"` desabilitados) enquanto a mutação está em andamento.
- **Uso de fuso horário sem ambiguidade:** no agendamento e adiamento de jogos, validar o identificador IANA (ex.: `America/Recife`, `America/Sao_Paulo`) e exibir sempre o horário local da partida ao lado do fuso.
- **Responsividade no celular:** empilhar grades de duas colunas em coluna única abaixo do breakpoint móvel, mantendo tabelas e ações de correção legíveis e acionáveis no toque.

### 5.10. Critérios observáveis de avaliação da interface

1. O presidente consegue explicar, antes de confirmar `"Encerrar campeonato"` ou `"Cancelar campeonato"`, que os saldos restantes de suspensões daquele campeonato serão encerrados definitivamente.
2. Em um jogo `finalizado` onde o atleta A foi credenciado no lugar do atleta B (que estava suspenso) e marcou 1 gol, o presidente conclui o fluxo da `MAR-83` (registrar participação administrativa de B com irregularidade gravada, transferir o gol de A para B, anular a entrada de A, estornar o credenciamento de A e ajustar a camisa de B) guiado pelas mensagens e pré-condições da interface.
3. O presidente distingue imediatamente o que pode fazer em um jogo `agendado` (adiar, cancelar, gerir arbitragem/senha), em um jogo `em_andamento` (apenas gerir arbitragem/senha e consultar dados, sem adiar/cancelar nem corrigir súmula), em um jogo `finalizado` (correções pós-jogo habilitadas) e em um jogo `cancelado` (apenas consulta histórica).
4. Ao cadastrar um novo presidente (`POST /api/presidentes`), o presidente digita a senha inicial, vê o campo de senha ser limpo após a confirmação de criação e compreende que deve entregá-la ao novo dirigente por canal seguro (já que a API nunca devolve senhas de contas); já na gestão da arbitragem do jogo (`GET/POST /api/jogos/:jogoId/arbitragem/senha...`), consulta ou troca a senha gerada pelo servidor sabendo que a troca revoga apenas as sessões abertas por senha.

### 5.11. Perguntas para validar as hipóteses

1. Quando ocorre um erro de súmula percebido só depois que o árbitro encerrou o jogo (como camisa trocada ou gol anotado para o atleta errado), qual é a ordem em que você procura corrigir os dados na tela do jogo?
2. Como você entrega a senha inicial ao criar outro presidente e como distribui a senha compartilhada do jogo para árbitros externos?
3. Nas suspensões reduzidas ou revogadas, quais informações da justificativa e do histórico de decisões anteriores você precisa enxergar rapidamente ao analisar uma nova punição?

---

## 6. Candidatos de insights sobre limitações do backend e alternativas de frontend

Esta seção registra os candidatos de insights verificados nos controllers e services de `server/src/modules/` (sem editar `docs/insights.md`). Nenhuma limitação autoriza alterar o backend; todas têm contorno estritamente de frontend.

### CAND-001 — O técnico não lista jogos e não recebe o nome do clube adversário enquanto o jogo está `agendado`

- **Limitação e evidência exata:**
  - [`CampeonatosController`](../server/src/modules/campeonatos/campeonatos.controller.ts) e [`JogosController`](../server/src/modules/jogos/jogos.controller.ts) exigem `@Requer(somentePresidente)` em todas as rotas (`GET /api/campeonatos`, `GET /api/campeonatos/:campeonatoId/jogos`, `GET /api/jogos/:jogoId`).
  - Na rota autorizada ao técnico para escalar (`GET /api/jogos/:jogoId/escalacao`, [`consultarEscalacao`](../server/src/modules/participacoes/escalacao.ts), linhas 28–84), `inscricoes` é filtrada para conter apenas o clube do técnico (`inscricoes.filter(i => i.clube.id === clubeDoTecnico)`) e `inscricaoClubeA`/`inscricaoClubeB` são omitidas de `jogo`.
  - Na rota de desempenho (`GET /api/jogos/:jogoId/desempenho`, [`consultarDesempenhoDoJogo`](../server/src/modules/resultados/historico.ts), linhas 40–47 e 88–98), `resumoJogo` traz `campeonato` e `local`, mas **não traz as inscrições dos clubes**; os nomes de `clubeA` e `clubeB` ficam somente dentro de `placar`, que vem da view `EstatisticasDoJogo` e é **`null` enquanto o jogo está `agendado`** (só existindo em jogo `em_andamento` ou `finalizado`, inclusive W.O.).
- **Alternativa só de frontend:**
  - Para descoberta do jogo: acessar via link do jogo compartilhado pelo presidente, manter atalhos locais no navegador para jogos já abertos pelo técnico e aproveitar IDs de jogos presentes em `GET /api/atletas/:atletaId/historico` (para atletas do clube já escalados/credenciados).
  - Na tela de escalação do técnico (`/tecnico/jogos/:jogoId`): combinar `GET /api/jogos/:jogoId/escalacao` e `GET /api/jogos/:jogoId/desempenho` para mostrar todo o contexto oficial disponível antes do início (`campeonato`, `local`, `inicioPrevistoLocal`, `fusoHorario`, `status` e o próprio `clube`), exibindo `clubeA × clubeB` quando `placar !== null` e declarando explicitamente a indisponibilidade do nome do adversário enquanto `agendado`, sem inventar dados nem tratar metadados externos de link como estado oficial do servidor.

### CAND-002 — Alerta booleano `suspensaoPendente` sem extrato disciplinar para técnico e atleta

- **Limitação e evidência exata:**
  - [`SuspensoesController`](../server/src/modules/suspensoes/suspensoes.controller.ts) restringe `GET /api/campeonatos/:campeonatoId/suspensoes` ao presidente.
  - O técnico vê apenas `suspensaoPendente: boolean` em `GET /api/jogos/:jogoId/escalacao` ([`consultarEscalacao`](../server/src/modules/participacoes/escalacao.ts), linhas 64–78), e o atleta não possui consulta de suspensões (em `GET /api/atletas/:atletaId/historico`, `cartoesVermelhos` não distingue relatório disciplinar nem saldo cumprido/reduzido/revogado).
- **Alternativa só de frontend:**
  - Mostrar ao técnico o alerta `suspensaoPendente` explicando que a escalação preliminar é aceita, mas que o credenciamento será barrado pela arbitragem caso o saldo continue vigente no momento do jogo, orientando a confirmar detalhes com o presidente.
  - Para o atleta, nunca inferir saldo de suspensão a partir de cartões no histórico nem exibir seção *"Minhas suspensões"*.

### CAND-003 — Omissão silenciosa de atletas inaptos em `atletasDoClube` e bloqueio `403` de foto após transferência

- **Limitação e evidência exata:**
  - Em [`consultarEscalacao`](../server/src/modules/participacoes/escalacao.ts) (linhas 58–62), `atletasDoClube` filtra `statusVerificacao: "aprovado"`, `usuario: { ativo: true }`, `carteirinha: { status: "ativa" }` e vínculo aberto (`fim: null`). Atletas do clube fora dessas condições não são listados nem acompanhados do motivo do impedimento.
  - Em [`chaveParaConta`](../server/src/modules/fotos/fotos.ts) (linhas 102–111), `GET /api/atletas/:atletaId/foto` exige que o atleta tenha vínculo aberto atual com o clube do técnico; se um atleta já escalado for transferido (`vinculoAtual: false` em `escalados`), a leitura da foto pelo técnico anterior responde `403 Forbidden`.
- **Alternativa só de frontend:**
  - Exibir aviso fixo na escalação listando os quatro requisitos para um atleta aparecer como disponível e orientando o técnico a consultar o presidente se alguém do elenco estiver ausente.
  - Só requisitar `GET /api/atletas/:atletaId/foto` na visão do técnico quando `vinculoAtual === true`, usando iniciais/placeholder para `vinculoAtual === false` (e para qualquer resposta `403`/`404`).

### CAND-004 — Ausência de agenda futura sem participação e de histórico de vínculos para o atleta

- **Limitação e evidência exata:**
  - [`AtletasController.vinculos`](../server/src/modules/atletas/atletas.controller.ts) (`GET /api/atletas/:atletaId/vinculos`) exige `somentePresidente`, e [`consultarHistoricoDoAtleta`](../server/src/modules/resultados/historico.ts) (linha 158) retorna apenas jogos em que o atleta possui `escolhidaEm IS NOT NULL OR credenciadoEm IS NOT NULL`.
- **Alternativa só de frontend:**
  - Nomear a visão do atleta como **"Minhas participações e histórico"** (nunca como agenda completa do clube) e apresentar o clube representado em cada partida registrada no histórico, sem prometer linha do tempo de transferências sem jogos.

### CAND-005 — Gestão de contas de presidentes sem listagem oficial e criação sem retorno de senha

- **Limitação e evidência exata:**
  - [`PresidentesController`](../server/src/modules/presidentes/presidentes.controller.ts) expõe apenas `POST /api/presidentes` (que recebe `password` inicial e retorna `{ usuario, criadoPorPresidenteId }`, sem devolver a senha) e [`ContasController`](../server/src/modules/contas/contas.controller.ts) expõe apenas `POST /api/contas/:usuarioId/desativacao` e `/reativacao`, sem `GET` de listagem ou situação de presidentes.
- **Alternativa só de frontend:**
  - Manter referências locais no `localStorage` por presidente autenticado (`{ id, nomeCompleto }`), deixar explícito que a situação da conta só é confirmada pela resposta da ação (com confirmação prévia exibindo o UUID completo) e, no formulário de novo presidente, limpar o campo de senha após o envio e instruir o presidente a entregar a senha escolhida por canal seguro.

### CAND-006 — Rejeição sem motivo no banco e impossibilidade de o atleta corrigir o clube inicial sozinho

- **Limitação e evidência exata:**
  - [`VerificacoesController.rejeitar`](../server/src/modules/verificacoes/verificacoes.controller.ts) não recebe motivo; [`ContaPropriaController.editar`](../server/src/modules/contas/conta-propria.controller.ts) aceita apenas `nomeCompleto`; e [`transferirAtleta`](../server/src/modules/atletas/transferencias.ts) (linha 61) exige atleta com `statusVerificacao === "aprovado"`.
- **Alternativa só de frontend:**
  - Destacar a confirmação do clube escolhido no formulário de `/cadastro` antes do envio.
  - Quando a conta estiver `rejeitado`, orientar a revisão de `nomeCompleto`, o envio/atualização de foto e o botão `"Solicitar nova análise"`; caso o atleta tenha selecionado o clube errado no cadastro inicial, instruí-lo a entrar em contato com o presidente para que o caso seja avaliado conforme as regras da associação, **sem nunca orientar uma aprovação indevida apenas para contornar o vínculo inicial**.
  - Não exibir botões inoperantes de troca de e-mail/senha ou recuperação de senha (`PEN-030`).

### CAND-007 — Socket.IO exclusivo da arbitragem temporária e exigência de internet

- **Limitação e evidência exata:**
  - [`NotificacoesService`](../server/src/modules/notificacoes/notificacoes.service.ts) (linhas 86–98) aceita no handshake Socket.IO apenas o cookie temporário `handebol.arbitragem.{jogoId}` com `auth: { jogoId }`. Contas permanentes operam exclusivamente via REST, e o credenciamento exige validação online (`PEN-025`, `RNF-004`).
- **Alternativa só de frontend:**
  - Usar atualização explícita via REST (botão `"Atualizar"`) nas telas de atleta, técnico e presidente, e alertar na tela da carteirinha quando o dispositivo estiver sem conexão (`navigator.onLine === false`).

### CAND-008 — Ordem obrigatória nas correções administrativas pós-jogo do presidente (`MAR-83`)

- **Limitação e evidência exata:**
  - As rotas de [`CredenciamentoPresidenteController`](../server/src/modules/participacoes/credenciamento.controller.ts) e [`LancamentosPresidenteController`](../server/src/modules/resultados/lancamentos.controller.ts) exigem `jogo.status === "finalizado"`, não permitem criar lançamentos novos e [`estornarPeloPresidente`](../server/src/modules/participacoes/credenciamento.ts) (linhas 535–540) exige anular antes a entrada em quadra e transferir/anular todos os lançamentos válidos, mantendo `numeroCamisa` único por clube/jogo em cada passo.
- **Alternativa só de frontend:**
  - Exibir na tela do jogo finalizado a sequência de pré-condições antes do botão de estorno (indicando se há entrada ativa ou lançamentos válidos pendentes) e orientar o uso de camisa livre temporária quando for necessário registrar a participação real antes de estornar quem ocupava a camisa.
