# Proto-persona operacional: Árbitro / Arbitragem

Para implementar a experiência atual, consulte [frontend.md](frontend.md) e o Figma ali vinculado. A mesa é prioritária para registros; a linha acompanha e também pode registrar. Mesa corresponde à visualização `banco` no contrato, com as mesmas permissões de `linha`. Este documento continua referência operacional e de hipóteses, sem impor a composição visual experimental.

> **Escopo documental:** hipótese de design e contrato de interface para orientar o frontend operacional de arbitragem, sem dados demográficos inventados e sem substituir validação em quadra. O backend está congelado; tudo abaixo reflete os contratos reais de `server/src/modules/arbitragem`, `participacoes`, `resultados`, `jogos` e `notificacoes`.

---

## 1. Papel temporário, modos de visualização e fronteiras de acesso

A arbitragem **não é um quarto perfil permanente de conta**. Trata-se de uma **função operacional temporária vinculada a um único jogo** (`RN-029`), exercida por:

1. **Conta permanente designada (`POST /api/arbitragem/jogos/:jogoId/entrada/designacao`):** exige sessão ativa e aprovada (`sessionCookie`) de `atleta` ou `tecnico` (nunca `presidente`), designada para a partida e **sem vínculo ou atribuição atual** com `clubeA` ou `clubeB` (`RN-025`). Atleta e técnico **não arbitram a partir de sua área permanente**: precisam ingressar explicitamente na sessão temporária da partida.
2. **Entrada sem conta por nome e senha compartilhada (`POST /api/arbitragem/jogos/:jogoId/entrada/senha`):** exige `nomeCompleto` e `senha` do jogo (comparação ignora maiúsculas, espaços e hifens; limite de 10 tentativas por IP a cada 10 min com `429`). Não exige conta cadastrada nem executa checagem de vínculo com clubes (`RN-025`).

**Regras de sessão, permissões e revogação:**
- **Cookie isolado por partida:** ambas as entradas emitem `handebol.arbitragem.{jogoId}` (`__Host-` em produção), independente de `sessionCookie` e de outros jogos.
- **Janela de disponibilidade:** acesso liberado apenas no **dia local do jogo** (`fusoHorario` IANA da partida) enquanto `status === "agendado"`, ou em qualquer horário enquanto `status === "em_andamento"` (inclusive após a meia-noite). Se o dia local virar com o jogo ainda `agendado`, o acesso fecha até reagendamento pelo presidente.
- **`linha` e `banco` têm as mesmas permissões (`RN-029`):** o modo de visualização (`"linha"` ou `"banco"`, escolhido na entrada ou alterado em `PUT /api/arbitragem/jogos/:jogoId/visualizacao`) adapta apenas o layout da tela ao posto de trabalho, sem bloquear credenciamento, lançamentos ou ciclo do jogo.
- **Sem acesso administrativo:** a sessão temporária não acessa rotas exclusivas de `presidente`. Consultar ou trocar a senha compartilhada (`GET/POST /api/jogos/:jogoId/arbitragem/senha...`) exige `sessionCookie` permanente de presidente ou de árbitro designado (`podeGerirSenhaPelaConta: true`); quem entrou por senha não vê nem gira a senha.
- **Revogação imediata:** encerrar (`jogo_encerrado`) ou cancelar (`jogo_cancelado`) revoga a senha/acesso da partida (`revogadoEm`) e todas as sessões temporárias. Adiar (`jogo_adiado`) encerra todas as sessões e renova a senha, ficando a nova entrada sujeita à nova data. Troca manual (`troca_senha`) renova a senha e derruba somente sessões por `senha`, preservando `designacao`. Remover designação, encerrar a sessão da conta de origem ou desativar a conta invalida a sessão por `designacao`. `POST .../saida` revoga apenas o dispositivo atual.

---

## 2. Contexto operacional, objetivo e hipóteses de frustração

- **Contexto de uso:** operação em ginásio (reflexo/iluminação variável, ruído, pressão de tempo), em celular ou tablet na mão/mesa, com **múltiplos dispositivos operando o mesmo jogo simultaneamente** (ex.: dupla de linha e mesa/banco). Exige **internet ativa** (sem modo offline) e câmera traseira no celular para leitura de QR Code de carteirinhas (`RF-018`). Não há cronômetro oficial sincronizado no servidor (`RN-021`).
- **Objetivo principal:** credenciar atletas elegíveis com camisa única por clube, registrar entrada em quadra e lançamentos (gols e punições) em tempo real com reenvio idempotente do mesmo `operacaoId` em caso de falha de rede e visibilidade imediata da súmula (já que dois árbitros enviando `operacaoId` distintos para o mesmo lance registram duas ocorrências), corrigir erros de toque antes do apito final e encerrar a súmula com resultado oficial íntegro.
- **Hipóteses de frustração:**
  - *H1 (Colisão entre dispositivos):* dois árbitros lançarem ou corrigirem o mesmo lance ao mesmo tempo sem perceber atualização concorrente na súmula.
  - *H2 (Confusão entre etapas):* achar que atleta `escalado` pelo técnico já está `credenciado`, ou que precisa marcar `entrouEmQuadra` antes de lançar gol/punição.
  - *H3 (Gargalo no credenciamento):* falha de foco na câmera ao ler QR Code ou atleta não escalado retornar `403` na foto antes de ser credenciado.
  - *H4 (Interrupção vs. lançamentos):* tentar lançar gol ou entrada em quadra com a partida pausada (`interrompidoEm !== null`) sem entender por que o botão está bloqueado.
  - *H5 (Perda de acesso no encerramento):* encerrar a partida antes de revisar uma camisa ou gol, descobrindo que o fechamento revoga o acesso imediatamente e restringe correções posteriores ao presidente.

---

## 3. Jornadas operacionais

### 3.1. Antes da partida (Ingresso e Credenciamento)
1. **Ingresso:** o árbitro acessa a tela do jogo no dia local da partida, escolhe **Entrar por designação** (se autenticado em conta permanente designada) ou **Entrar com senha do jogo** (`nomeCompleto` + `senha`), seleciona a preferência inicial `banco` ou `linha` e recebe o cookie `handebol.arbitragem.{jogoId}`.
2. **Conferência de elencos (`GET /api/arbitragem/jogos/:jogoId/atletas`):** visualiza `clubeA` e `clubeB` com indicação informativa de quem foi `escalado` pelo técnico, quem já possui `credenciamento` (`participacaoId`, `numeroCamisa`, `entrouEmQuadraEm`) e quem possui `impedimento` (`nao_aprovado`, `sem_vinculo_com_clubes_do_jogo`, `conta_desativada`, `carteirinha_invalidada`, `suspensao`).
3. **Credenciamento (`POST .../credenciamentos`):** **credenciar ≠ escalar ≠ entrar em quadra**. O árbitro credencia atletas com vínculo aprovado (escalados ou não) informando `numeroCamisa` inteiro não negativo, único por clube no jogo:
   - **Por QR Code (`RF-018`):** lê o QR (`POST .../leitura-qr` para pré-conferir nome, código/status da carteirinha, clube e impedimentos) ou envia `{ tokenQr, numeroCamisa }` direto em `POST .../credenciamentos`, confirmando automaticamente se elegível. QR substituído retorna `404`.
   - **Manual:** seleciona o atleta na lista do clube e informa `{ atletaId, numeroCamisa }`.
   - **Regra de foto (`GET .../atletas/:atletaId/foto`):** só retorna imagem para atleta **escalado ou já credenciado** na partida; para atleta fora da escalação ainda não credenciado, a UI não deve tentar carregar miniatura (`403`) até concluir o credenciamento.

### 3.2. Durante a partida (Início, Quadra, Lançamentos e Interrupção)
1. **Iniciar jogo (`POST .../inicio`) ou encerrar por W.O.:** no dia local, com `status === "agendado"`, inicia a partida (`status` passa a `"em_andamento"`, placar inicia em `0 × 0`). Se uma equipe não comparecer antes do início, encerra direto como `"wo"` (`0 × 0`).
2. **Atletas atrasados:** `POST .../credenciamentos` permanece disponível durante `"em_andamento"` (inclusive com partida interrompida) para credenciar atletas que chegarem após o início.
3. **Entrada em quadra (`POST .../credenciamentos/:atletaId/entrada`):** marca uma única vez que o atleta credenciado pisou em quadra, para registro de participação efetiva e histórico esportivo. Exige jogo `"em_andamento"` **sem interrupção aberta** e conta ativa (suspensão, invalidação de carteirinha ou transferência ocorridas após o credenciamento não bloqueiam a entrada).
4. **Lançamentos (`POST .../lancamentos`):** exige jogo `"em_andamento"` **sem interrupção aberta** e atleta **credenciado** (`participacaoId`), **mesmo que `entrouEmQuadra` ainda não tenha sido marcado**. Gera `operacaoId` (UUID v4 no cliente) antes do envio para reenvio idempotente seguro do **mesmo comando** em oscilações de rede (`alterado: false` se repetido; não impede que dois árbitros gerando `operacaoId` diferentes para o mesmo fato registrem duas ocorrências, o que exige anulação manual se ocorrer). Tipos aceitos (sempre com valor 1 para o clube da participação):
   - `gol`
   - `cartaoAmarelo`
   - `exclusaoDoisMinutos` (contagem visual nunca inventa cronômetro oficial de servidor)
   - `cartaoVermelho`, com toggle explícito `relatorioDisciplinar: boolean` (`true` = cartão azul / relatório disciplinar, que gera suspensão automática de 1 jogo no encerramento).
5. **Interromper e retomar (`POST .../interrupcao` e `POST .../retomada`):** pausa e retoma a partida em andamento. Enquanto `interrompidoEm !== null`, a UI bloqueia novos lançamentos e novas entradas em quadra, mas **mantém liberados** credenciamento de atrasados, ajuste de camisa, estorno de credenciamento, correção/anulação de lançamentos e encerramento definitivo.

### 3.3. Correções durante a partida (Antes do encerramento)
- **Trocar número de camisa (`POST .../credenciamentos/:atletaId/camisa`):** envia `{ numeroCamisaAtual, numeroCamisa }` (permitido mesmo após entrada em quadra ou lançamentos). Se outro dispositivo já trocou a camisa (`409`), exibe a `participacao` atual retornada.
- **Estornar credenciamento (`POST .../credenciamentos/:atletaId/estorno`):** envia `{ numeroCamisa }` para desfazer credenciamento feito por engano, **somente se** `entrouEmQuadraEm === null` e o atleta não tiver lançamentos (nem anulados). Caso contrário, informa que a retificação pós-jogo caberá ao presidente.
- **Corrigir ou anular lançamento (`POST .../lancamentos/:lancamentoId/correcao` e `.../anulacao`):** permitido em `"em_andamento"` (inclusive durante interrupção temporária), enviando novo `operacaoId`. A correção substitui logicamente o registro (`anuladoEm` + `substituidoPorId`) alterando atleta (`participacaoId`), `tipo` ou `relatorioDisciplinar`; a anulação retira o efeito do placar e métricas mantendo histórico auditável na súmula.

### 3.4. Finalização da partida
- **Encerramento definitivo (`POST .../encerramento`):** exige revisão final do placar e escolha explícita de `resultado` (`"normal"`, `"interrompido"` ou `"abandono"` para jogo iniciado; `"wo"` apenas para jogo `"agendado"` não iniciado) e `vencedorInscricaoId` (`clubeA`, `clubeB` ou `null` para empate/sem vencedor, independente do placar numérico).
- **Efeito imediato:** um único árbitro conclui o ato; o backend fecha a súmula atomicamente, processa suspensões e **revoga a senha/acesso da partida (`revogadoEm`) e todas as sessões temporárias**. A tela apresenta o resumo final retornado (`{ jogo, placar }`) em modo somente leitura e avisa que qualquer retificação posterior é exclusiva do presidente.

---

## 4. Diretrizes de UI, prioridades e estados operacionais

### 4.1. Identidade visual e tokens existentes (`client/src/features/ui/tema.module.css`)
Reutilizar estritamente a identidade "Placar de Ginásio & Súmula Oficial" já definida em `tema.module.css`, **sem criar nova paleta**:
- Superfícies e texto: `--fundo` (`#eef2f6`), `--superficie` (`#ffffff`), `--tinta` (`#172238`), `--suave` (`#4a576b`) e `--divisa` (`#cad3de`).
- Destaque de placar e cabeçalho da partida: `--quadra` (`#1b4d89`), `--quadra-escura` (`#123764`) e marcador `--sinal` (`#f4b63f`).
- Semântica de status e punições: `--aprovado` / `--aprovado-fundo` (credenciado/em quadra/sucesso), `--pendente` / `--pendente-fundo` (interrompido/amarelo/2 min/alerta) e `--rejeitado` / `--rejeitado-fundo` (impedimento/vermelho/erro).
- Tipografia local: `--display` (placar gigante, números de camisa em `tabular-nums`, cabeçalhos de clube) e `--texto` (listas, rótulos e histórico de súmula).

### 4.2. Prioridades de layout: modo `linha` vs. modo `banco`
Ambos os modos expõem **todas as ações no mesmo jogo**, mudando apenas a hierarquia primária com chaveador rápido no topo (`PUT .../visualizacao`):
- **Modo `linha` (foco em toque rápido em pé/quadra):** placar fixo no topo (`clubeA × clubeB` + status `agendado` / `em_andamento` / `interrompido`), grade de botões grandes por **número de camisa + nome curto** agrupada por clube para lançar `gol`, punição ou `entrada em quadra` em 2 toques, e botão flutuante para leitor de QR Code.
- **Modo `banco` (foco em mesa e súmula auditável):** visão dividida entre a lista de atletas disponíveis na consulta do jogo por clube (`GET .../atletas`, que retorna atletas aprovados com vínculo atual e atletas já credenciados, com filtros `Credenciados`, `Escalados não credenciados`, `Outros elegíveis` e `Impedidos`), barra de lançamento rápido e linha do tempo cronológica de `lancamentos` (destacando ativos vs. `anuladoEm`/`substituidoPorId` com ações diretas de **Corrigir** e **Anular**).

### 4.3. Estados, sincronização em tempo real, foco e mobile
- **Sincronização Socket.IO (`/api/socket.io`):** conecta com `auth: { jogoId }`. Ao receber `jogo:evento` (que traz apenas metadados `{ id, jogoId, tipo, referenciaId, ocorridoEm }`), deduplica por `id` e reconsulta via REST os recursos afetados (`sessao`, `atletas`, `lancamentos`), refazendo também a leitura completa ao reconectar.
- **Estados vazios, envio e conflito (`409`):**
  - *Vazio:* antes do início, placar exibe `— × — (Jogo agendado)` e lista de lançamentos informa que o registro abre ao iniciar a partida.
  - *Enviando (`operacaoId` fixo):* preserva o mesmo `operacaoId` até resposta definitiva; em caso de falha de rede, oferece botão **Reenviar mesmo lançamento** sem gerar novo UUID.
  - *Conflito (`409`):* em correção/anulação concorrente ou camisa já alterada por outro árbitro, atualiza a tela imediatamente com o objeto atual retornado pelo backend (`lancamento`/`substituto` ou `participacao`) e explica que outro dispositivo já modificou o registro.
  - *Revogação imediata (`acesso:encerrado` ou `401`/`403`):* exibe banner explicando o motivo exato (`jogo_encerrado`, `jogo_adiado`, `jogo_cancelado`, `troca_senha`, `saida` ou `acesso_indisponivel`) e retorna à tela de ingresso sem perder a leitura do resumo final caso o próprio dispositivo tenha acabado de encerrar o jogo.
- **Foco, diálogos e ações destrutivas:** diálogos (`dialogo.tsx` / `confirmacao.tsx`) para cartão vermelho com opção explícita `relatorioDisciplinar`, estorno de credenciamento, correção/anulação e encerramento do jogo devem **bloquear `Escape`, clique no backdrop e botões Fechar/Voltar enquanto `enviando === true`**, devolvendo o foco ao elemento acionador ao fechar.
- **Mobile e câmera:** alvos de toque mínimos de `44×44 px` (`48×48 px` na grade de camisas), câmera traseira (`facingMode: "environment"`) com fallback imediato para digitação/seleção manual sem fechar o fluxo, e nenhuma informação transmitida apenas por cor (sempre combinar cor + ícone/rótulo por extenso nos botões e badges: `Gol`, `Cartão amarelo`, `Exclusão 2 min`, `Cartão vermelho` e `Cartão vermelho + relatório disciplinar`).

---

## 5. Critérios observáveis de avaliação e perguntas de validação

### Critérios observáveis na interface
1. **Paridade `linha`/`banco`:** alternar entre `linha` e `banco` reorganiza a densidade visual sem ocultar nem bloquear credenciamento, lançamentos, correções ou ciclo do jogo.
2. **Distinção das 3 etapas:** a lista de atletas diferencia visualmente `Escalado (não credenciado)`, `Credenciado (no banco)` e `Em quadra`, permitindo lançar gol/punição para qualquer atleta `Credenciado` mesmo sem `entrouEmQuadra` marcado.
3. **Proteção de foto `403`:** a UI só requisita `/atletas/:atletaId/foto` para atletas `escalado === true` ou já credenciados, exibindo avatar tipográfico com iniciais/camisa para os demais até o credenciamento.
4. **Idempotência de lançamento:** simular timeout e clicar em reenviar reutiliza exatamente o mesmo `operacaoId`, resultando em apenas 1 lançamento na súmula.
5. **Bloqueios em partida interrompida:** com `interrompidoEm !== null`, botões de novo lançamento e entrada em quadra ficam desabilitados com aviso explícito (`Partida interrompida — retome o jogo para lançar`), enquanto credenciamento, troca de camisa e correção/anulação seguem operacionais.
6. **Fechamento e perda de sessão:** ao confirmar `POST .../encerramento`, o árbitro vê o recibo final (`jogo` + `placar`) e o aviso de sessão encerrada, sem loops de erro `401`.

### Perguntas para validar as hipóteses
1. No modo `linha`, a seleção em dois toques (`Camisa do atleta` → `Tipo de lançamento`) é mais rápida e menos propensa a erro sob pressão do que escolher primeiro o tipo de lance e depois o atleta?
2. Na entrada por `designacao`, fica claro para o técnico ou atleta designado que ele está operando em uma sessão temporária separada da sua conta permanente?
3. Durante uma interrupção de partida, os árbitros compreendem imediatamente quais correções continuam liberadas e por que novos gols/entradas exigem tocar em **Retomar jogo** primeiro?

---

## 6. Candidatos a insights (limitações do contrato atual e mitigação no frontend)

> *Itens abaixo excedem ou tensionam o contrato congelado; estão marcados apenas como candidatos para avaliação futura, sem alterar `docs/insights.md`.*

- **`CAND-ARB-01` — Listagem de jogos para ingresso por senha compartilhada:** o backend expõe os endpoints de entrada por `:jogoId`, mas a listagem pública/geral de jogos hoje fica nas rotas administrativas do presidente. *Mitigação de frontend:* permitir ingresso direto via link/QR da partida (`/arbitragem/jogos/:jogoId`) contendo o `jogoId` compartilhado junto com a senha pelo presidente ou árbitro designado.
- **`CAND-ARB-02` — Foto `403` para atleta não escalado durante pré-conferência:** `POST .../leitura-qr` e `GET .../atletas` não liberam `/foto` para atletas fora da escalação antes de `POST .../credenciamentos`. *Mitigação de frontend:* exibir destaque claro de `nomeCompleto`, `codigo` da carteirinha e identificação disponível na tela/carteirinha, carregando a foto oficial assim que o credenciamento for salvo.
- **`CAND-ARB-03` — Ausência de tempo de jogo ou cronômetro de 2 minutos no servidor (`RN-021`):** `exclusaoDoisMinutos` registra apenas `registradoEm` (UTC). *Mitigação de frontend:* exibir o horário local do registro (`registradoEm` formatado no `fusoHorario` do jogo) sem prometer cronômetro oficial sincronizado, pois o servidor não desconta pausas (`interrompidoEm`) de punições.
