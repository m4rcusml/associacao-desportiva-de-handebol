---
name: "Acesso, Arbitragem, Presidente, Atleta e Técnico · Proposta Figma"
description: "Tokens e regras da proposta Figma de acesso e dos quatro perfis; são referência do frontend descrito em docs/frontend.md."
colors:
  gym-background: "#F2F4F0"
  panel-white: "#FFFFFF"
  dark-ink: "#182E29"
  muted-ink: "#566861"
  divider: "#D3DDD6"
  pine-action: "#174F42"
  deep-pine: "#103D33"
  pine-tint: "#E5F1E9"
  club-blue: "#285CA7"
  club-blue-tint: "#EDF2FC"
  club-copper: "#A44728"
  club-copper-tint: "#FBEEE7"
  danger-red: "#AB302B"
  danger-tint: "#FCEDEB"
  caution-amber: "#805400"
  caution-tint: "#FFF3D2"
  action-white: "#FFFFFF"
  disabled-surface: "#DDE3DE"
  disabled-ink: "#67766F"
typography:
  scoreboard:
    fontFamily: "IBM Plex Sans"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: "58px"
  scoreboard-compact:
    fontFamily: "IBM Plex Sans"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: "48px"
  shirt-number:
    fontFamily: "IBM Plex Sans"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "34px"
  shirt-number-compact:
    fontFamily: "IBM Plex Sans"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
  athlete-name:
    fontFamily: "IBM Plex Sans"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "17px"
  compact-label:
    fontFamily: "IBM Plex Sans"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  headline:
    fontFamily: "IBM Plex Sans"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "37px"
  title:
    fontFamily: "IBM Plex Sans"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
  body:
    fontFamily: "IBM Plex Sans"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "18px"
  label:
    fontFamily: "IBM Plex Sans"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "18px"
rounded:
  status-chip: "5px"
  action: "8px"
  field: "10px"
  panel: "12px"
spacing:
  step-4: "4px"
  step-6: "6px"
  step-8: "8px"
  step-10: "10px"
  step-12: "12px"
  step-16: "16px"
  step-20: "20px"
  step-24: "24px"
  step-32: "32px"
  step-48: "48px"
components:
  button-primary:
    backgroundColor: "{colors.pine-action}"
    textColor: "{colors.action-white}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    height: "50px"
  button-primary-hover:
    backgroundColor: "{colors.deep-pine}"
    textColor: "{colors.action-white}"
  button-primary-active:
    backgroundColor: "{colors.deep-pine}"
    textColor: "{colors.action-white}"
  button-secondary:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.dark-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    height: "50px"
  button-danger:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.action-white}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    height: "50px"
  button-disabled:
    backgroundColor: "{colors.disabled-surface}"
    textColor: "{colors.disabled-ink}"
    rounded: "{rounded.action}"
  mode-switch:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.action}"
    width: "72px"
    height: "48px"
  occurrence-mode-selected:
    backgroundColor: "{colors.pine-action}"
    textColor: "{colors.action-white}"
    rounded: "{rounded.action}"
    height: "48px"
  shirt-wide:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.club-blue}"
    rounded: "{rounded.action}"
    height: "112px"
  shirt-compact:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.club-blue}"
    rounded: "{rounded.action}"
    width: "83.5px"
    height: "80px"
  search-field:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.field}"
    height: "50px"
  nav-active:
    backgroundColor: "{colors.club-blue-tint}"
    textColor: "{colors.club-blue}"
    rounded: "{rounded.action}"
    height: "44px"
  status-chip:
    backgroundColor: "{colors.pine-tint}"
    textColor: "{colors.pine-action}"
    rounded: "{rounded.status-chip}"
  work-panel:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.panel}"
---

# Design System: Acesso, Arbitragem, Presidente, Atleta e Técnico · Proposta Figma

## Overview

**Escopo: tokens e regras da proposta Figma de acesso, Arbitragem, Presidente, Atleta e Técnico de associação esportiva de handebol. A direção foi selecionada como referência para implementar o novo frontend em docs/frontend.md. O desenho ainda não está implantado; a etapa documental não altera o backend nem o código experimental.**

**Creative North Star: "Orientação de ginásio"**

Leitura rápida por clube e camisa, com superfícies claras, contraste firme e controles diretos. A simplificação conserva a identidade e aproxima a ação da camisa: gol em um toque, duas equipes visíveis e confirmação curta na própria tela. A mesa concentra o registro; a linha acompanha e também pode registrar. A mudança de apresentação não define permissões. A escolha visual foi confirmada por Marcus; hipóteses de uso em ginásio ainda não foram testadas com árbitros reais.

Na visão do presidente, a mesma direção aproxima ficha, contexto e decisão. Avatares por iniciais, emblemas e calendários ajudam a localizar pessoas, clubes e jogos; a tarefa principal recebe prioridade sobre controles ocasionais. A extensão preserva a arbitragem v2 aprovada e reutiliza sua identidade, sem nova paleta ou pesquisa empírica.

Atleta e técnico estendem essa direção já aprovada. A carteirinha do atleta aparece aberta, com identificação, código e QR visíveis; ampliar o QR exige uma ação. A escalação do técnico coloca atleta, estado e ação na mesma linha: incluir ou retirar exige um toque por pessoa, com retorno próximo da lista. Iniciais, ícones e rótulos apoiam a identificação. Os quatro perfis compartilham a linguagem visual, preservando suas tarefas e permissões próprias.

A entrada e o cadastro agora compartilham essa mesma direção. Login por e-mail e senha leva à área da conta; exemplos de perfis ficam no board de revisão, sem seletor de perfil no login. O cadastro distingue atleta, com clube obrigatório, de técnico, sem escolha de clube. Envio do cadastro e aprovação esportiva permanecem etapas distintas.

**Key Characteristics:**
- Camisa vetorial clicável com número, nome e rótulo da ação.
- Duas equipes visíveis, placar compacto e retorno do último registro.
- Superfícies foscas, sem sombras e com separação por espaço, cor e divisórias.
- No presidente, ficha visível e decisão adjacente, com listas visuais e ações contextuais.
- No atleta, carteirinha imediata e QR ampliado em uma ação, sem confundir validade com elegibilidade no jogo.
- No técnico, inclusão ou retirada individual na própria lista, com confirmação e contexto do jogo.
- No acesso, formulário direto, rótulos visíveis e caminho próprio para a arbitragem.

Fonte visual: [mesa](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=24-273), [celular](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=24-409) e [tablet](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=26-507), página `4:6`. O [ledger v2](.impeccable/figma-arbitragem-v2-state.json) identifica os estados atuais. As variáveis visuais locais pertencem à coleção `Arbitragem · Proposta de experiência` (`VariableCollectionId:24:222`), namespace `Arb2/`. O frontmatter registra valores da proposta; sugestões `--arb-proposta-*` no code syntax do Figma não são CSS integrado ao projeto.

A visão do presidente está na página `4:3` do mesmo arquivo. O [brief do presidente](.impeccable/surfaces/figma-presidente.md) e seu [ledger](.impeccable/figma-presidente-state.json) concentram telas, estados, diálogos e referências específicas. Capturas principais: [desktop](.impeccable/review/presidente-desktop.png) e [celular](.impeccable/review/presidente-mobile.png).

Atleta está na página `4:5`: [carteirinha no celular](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=9-2) e [desktop](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=82-1316). Técnico está na página `4:4`: [escalação no celular](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=8-30) e [desktop](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=82-449). O [brief conjunto](.impeccable/surfaces/figma-atleta-tecnico.md) registra a direção; os ledgers de [atleta](.impeccable/figma-atleta-state.json) e [técnico](.impeccable/figma-tecnico-state.json) identificam estados e capturas. O atleta tem 74 snapshots e 12 capturas; o técnico, 43 estados além da entrada compartilhada e 10 capturas. Essas contagens descrevem a proposta editável, sem representar funcionalidades implementadas.

Acesso está na página `4:2`: [login desktop](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=7-2), [login celular](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=92-5465), [cadastro desktop](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=7-22) e [cadastro celular](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=92-5575). O [brief de acesso e limpeza](.impeccable/surfaces/figma-acesso-limpeza.md) e o [ledger de acesso](.impeccable/figma-acesso-state.json) registram estados, conexões e limites. A [visão geral atual](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=17-2) aponta para as propostas vigentes.

A limpeza removeu do Figma 30 frames de versões anteriores e dez componentes Roboto sem instâncias, preservando as famílias atuais. O [registro da limpeza](.impeccable/figma-limpeza-state.json) identifica os frames removidos. Ledgers e capturas históricos locais foram mantidos como evidência: suas referências a versões anteriores não representam nós vigentes. O arquivo Figma apresenta somente as propostas atuais, sem referências visuais ao frontend antigo.

O [índice de componentes atuais](https://www.figma.com/design/gwHYKm5u7V8uP1lXBmxPPG?node-id=92-6511), na página `4:7`, reúne seis links para as famílias preservadas; sua [captura](.impeccable/review/componentes-atuais.png) documenta a organização atual.

As correções de sobreposição estão registradas nos ledgers de [atleta e técnico](.impeccable/figma-correcao-atleta-tecnico.json) e [presidente e arbitragem](.impeccable/figma-correcao-presidente-arbitragem.json). Ajustaram larguras de texto e fluxo vertical, preservando identidade, conteúdo e destinos dos fluxos atuais.

## Colors

### Primary

Verde pinho identifica ações principais e o modo de ocorrência selecionado. Verde profundo dá peso ao cabeçalho e aos estados hover/pressed; a tinta verde clara acolhe confirmações e informação contextual.

### Secondary

Azul e cobre identificam os dois clubes do exemplo, acompanhados por seus nomes. Seus fundos claros preservam a leitura da camisa e do atleta. A associação de cor é estável dentro do jogo demonstrado, sem impor cores permanentes aos clubes do produto.

### Tertiary

Vermelho sinaliza encerramento e consequências destrutivas; âmbar chama atenção para revisão ou impedimento. Ambos exigem texto que explique a situação.

### Neutral

Fundo de ginásio, branco de painel, tinta escura, tinta secundária e divisória constroem a hierarquia. Superfície e tinta desabilitadas comunicam indisponibilidade. Branco de ação e branco de painel são papéis distintos com o mesmo valor observado.

**The Clube Legível Rule.** Cor acompanha o nome do clube e a camisa; nunca os substitui.

## Typography

Família única: **IBM Plex Sans**, com Regular, Medium, SemiBold e Bold disponíveis. Textos permanecem editáveis no Figma. Placar usa os papéis `scoreboard` e `scoreboard-compact`; `headline` e `title` organizam títulos, e `body`/`label` distinguem explicação de comando. A entrelinha é aproximadamente 1,32, arredondada em pixels. Os papéis do frontmatter resumem a hierarquia reutilizada, sem catalogar cada tamanho pontual.

Camisas usam `shirt-number` na visão ampla e `shirt-number-compact` no celular; nomes usam `athlete-name` e `compact-label`. Ações e instruções usam os papéis de (14 px) na visão ampla e (12 px) no celular. Nomes são abreviados na grade móvel e aparecem completos na confirmação. Textos de estado e confirmação permanecem junto ao registro; números grandes não eliminam o contexto do clube.

No presidente, `headline` e `title` dão títulos de desktop e celular; corpo varia de (14–16 px), metadados de (12–13 px) e nomes de lista de (15–18 px). Rótulos amigáveis usam **Registros do jogo** nos acessos à súmula, preservando o vocabulário de domínio nas suas fontes.

Atleta e técnico mantêm IBM Plex Sans e a hierarquia existente. Nome completo, clube, código da carteirinha e rótulo de estado permanecem legíveis junto ao QR. Na escalação, nome e situação precedem o comando explícito **Escalar** ou **Retirar**; alertas como suspensão pendente não dependem apenas de cor.

## Layout

Mesa demonstrada em (1440 × 900 px): conteúdo central de (1120 px), com padding interno de (8 px), placar compacto, seletor de ocorrência e clubes empilhados em faixas. Cada faixa apresenta nove camisas com intervalos de (8 px); os botões têm aproximadamente (112 px) de largura e altura de (112 px). Tablet em (1024 × 900 px) conserva a sequência vertical, adaptando a largura disponível.

Celular em (390 × 844 px): área útil de (358 px), dois clubes simultâneos de (173 px) separados por (12 px). Cada clube tem duas camisas de (83,5 × 80 px) por linha, com intervalos de (6 px). Nove atletas ocupam cinco linhas. Cabeçalho mostra Conectado; Credenciar, Súmula e Opções ficam na barra inferior de (56 px), com botões de (44 px). Opções aparece apenas na navegação inferior do celular.

Essas dimensões são viewports de referência, não breakpoints CSS aprovados. A escala de espaçamento está no frontmatter. Consulte [desktop v2](.impeccable/review/desktop-v2.png), [mobile v2](.impeccable/review/mobile-v2.png), [tablet v2](.impeccable/review/tablet-v2.png), [gol confirmado](.impeccable/review/gol-v2.png) e [modo exclusão](.impeccable/review/exclusao-v2.png). As capturas v1 permanecem somente como histórico local de comparação; os frames anteriores foram removidos do Figma.

**Presidente.** Desktop em (1440 × 900 px), com cinco áreas na navegação horizontal e conteúdo central de (1160 px). Cadastros combina fila de (430 px), intervalo de (28 px) e ficha de (702 px). No celular em (390 × 844 px), cabeçalho de (56 px), conteúdo de (358 px) e navegação inferior de (64 px), com cinco alvos de (78 × 56 px). A ficha já aparece aberta; listas e conteúdo longo usam rolagem, mantendo acesso à navegação.

Diálogos compartilhados têm largura de (390 px), alturas entre (480–800 px), rolagem interna e ações no rodapé. Uma variável de protótipo devolve o usuário ao formato de origem; não equivale a comportamento responsivo implementado.

**Atleta.** Celular em (390 × 844 px), com a carteirinha aberta no primeiro viewport e quatro destinos inferiores: Carteirinha, Histórico, Clubes e Conta. Desktop em (1440 × 900 px) leva esses destinos ao cabeçalho e coloca a carteirinha ao lado de registros e atalhos. Ampliar QR abre uma tela dedicada que conserva nome, código e retorno. Consulte [celular](.impeccable/review/atleta-mobile.png), [desktop](.impeccable/review/atleta-desktop.png) e [QR ampliado](.impeccable/review/atleta-qr.png).

**Técnico.** Os mesmos viewports apresentam a escalação em sequência vertical no celular e duas colunas no desktop: Escalados e Disponíveis para escalar. Contexto e atualização do jogo ficam acima da lista. Jogos, Meu clube e Conta permanecem acessíveis na navegação inferior. As telas principais de Jogos, Escalação, Meu clube e Conta possuem versão desktop; destinos secundários desse formato abrem snapshots móveis. Consulte [celular](.impeccable/review/tecnico-mobile.png), [desktop](.impeccable/review/tecnico-desktop.png) e [inclusão confirmada](.impeccable/review/tecnico-inclusao.png). Essa adaptação do protótipo não estabelece breakpoints ou navegação de produção.

**Acesso.** Desktop em (1440 × 900 px) combina apresentação à esquerda e formulário em painel branco à direita. No celular em (390 × 844 px), o formulário ocupa uma coluna com (16 px) de margem lateral; título, instrução, campos e ações seguem em ordem vertical. Campos e ações principais têm (50 px) de altura. Consulte [desktop](.impeccable/review/acesso-desktop.png), [celular](.impeccable/review/acesso-mobile.png), [cadastro de atleta](.impeccable/review/acesso-cadastro-atleta.png) e [cadastro de técnico](.impeccable/review/acesso-cadastro-tecnico.png). As correções nas demais áreas fazem textos acompanharem a largura útil dos contêineres e preservam rolagem onde o conteúdo excede o viewport.

## Elevation & Depth

Sem sombras. A profundidade vem do painel branco sobre fundo fosco, das tintas de estado e de divisórias finas. Foco usa contorno azul (2 px), sem depender de elevação. Não há tokens de animação estabelecidos pela proposta.

## Shapes

Botões têm cantos contidos; campos são ligeiramente mais suaves, painéis mais amplos e chips compactos. Os raios normativos estão no frontmatter. Linhas e bordas separam áreas de trabalho sem decoração adicional.

No presidente, avatares circulares por iniciais variam de (44–72 px); emblemas de clube de (48–72 px), acompanhados pelo nome. Ícones vetoriais funcionais usam (24 px). São recursos locais de identificação, não logotipos oficiais nem fotografias.

Atleta e técnico reutilizam identificação por iniciais, ícones vetoriais e superfícies claras. O QR ilustrativo do atleta é vetorial e tem área branca própria. Nenhuma foto foi fornecida; os estados de envio de foto são demonstrações sem imagem real. Os exemplos permanecem editáveis no Figma, sem captura raster usada como interface.

## Components

**Botões e modos.** Primário em pinho com texto branco; hover e pressed em verde profundo. Secundário branco com tinta escura. Desabilitado usa os papéis próprios de superfície e texto. Contorno de foco azul (2 px). Modos de ocorrência têm altura de (48 px). As variantes gerais ficam no conjunto Figma `29:295`.

**Camisas.** A família `39:2282` possui quatro variantes: Formato Amplo/Compacto × Clube A/B, com propriedades Camisa, Atleta e Ação. Ícone vetorial de camisa com número central, nome abaixo e rótulo `+ Gol`; a cor acompanha o clube. O botão inteiro representa a ação. A grade contém credenciados e não indica presença atual em quadra.

**Registro e retorno.** Gol exige um toque na camisa. Exclusão de dois minutos ou amarelo exige modo + camisa (dois toques); após envio confirmado, o modo retorna a Gol. Vermelho conserva revisão explícita e relatório. O último gol confirmado oferece Desfazer direto tanto na chegada quanto após novo registro, inclusive com modo de punição selecionado: representa anulação auditável permitida antes do encerramento, preservando o histórico. A confirmação mantém atleta, clube e camisa; variáveis STRING do protótipo personalizam esse texto, sem backend implementado.

**Navegação e detalhes.** Credenciamento, Súmula e Opções continuam acessíveis. Painel separado de ocorrência, busca, abas entre clubes e timeline extensa saem da operação principal; detalhes permanecem nas telas correspondentes. Busca mantém seu campo branco nas telas de apoio. A conferência de encerramento conserva uma etapa própria.

**Contratos do produto.** Consulte [requisitos](docs/requisitos.md), [glossário](docs/GLOSSARY.md), [pendências](docs/pendencias.md) e [arquitetura](docs/arquitetura.md) para regras, fotos, aprovação e autorização. Esta especificação visual não redefine esses contratos. Os snippets de `.impeccable/design.json` são demonstrações isoladas da proposta, não componentes implantados.

**Cadastros e fichas do presidente.** Ficha e ação ficam no mesmo painel: Aprovar e emitir carteirinha ocorre em uma interação no protótipo após os dados exibidos. Aprovar técnico tem rótulo próprio; atribuição ao clube aparece separadamente. A ficha de pessoa destaca carteirinha e quatro atalhos. Listas de clubes combinam emblema, nome e contexto; sem técnico, a atribuição aparece diretamente. Campeonatos usam calendário de jogos e ações por status. Os botões reaproveitam a família `29:295`, incluindo hover, foco, desabilitado e carregando. Em andamento, Consultar registros do jogo recebe prioridade e abre participantes e ocorrências somente para leitura, enquanto Designar arbitragem fica secundário.

Para os comportamentos do presidente, consulte também [personas, seção 5](docs/personas.md#5-proto-persona-3-presidente) e requisitos. A apresentação respeita esses contratos: presidente não arbitra nem corrige partida em andamento; transferência pode informar bloqueio por campeonato em andamento. O texto de invalidação definitiva preserva explicitamente placar, estatísticas e cumprimentos. Gestão de outros presidentes apresenta referências locais/ID, sem sugerir lista oficial ou situação previamente confirmada.

**Carteirinha e consultas do atleta.** A chegada já apresenta carteirinha, QR, código, nome, clube e estado, sem etapa intermediária. **Ampliar QR para leitura** exige um toque; o aviso adjacente distingue carteirinha ativa de elegibilidade por jogo. Histórico e participação diferenciam escalação, credenciamento e entrada em quadra; métricas podem estar indisponíveis antes do credenciamento. Clubes e conta usam os mesmos recursos de identificação. Cadastro pendente ou rejeitado tem caminhos próprios para atualizar dados, foto opcional e solicitar nova análise, sem acesso aos recursos esportivos. Estados de invalidação, carregamento, erro e ausência de conexão demonstram retorno e recuperação.

**Escalação do técnico.** As linhas reutilizáveis `82:259` e `82:325` unem iniciais, nome, detalhe e botão. **Escalar** ou **Retirar** abre diretamente o snapshot de confirmação individual, com contagem atualizada; não há salvamento em lote. Suspensão pendente mantém o alerta visível e distingue escalação preliminar de credenciamento. Após o início, o jogo é consultado somente para leitura. Referências de jogos são locais e não constituem agenda oficial; adversário e placar não são exibidos antes do início nessa consulta. Transferido pode ser retirado da escalação antiga sem expor sua foto ou histórico. Busca, desempenho, alterações, conta e estados de falha usam telas de apoio, sem acrescentar número de camisa ou controle do jogo à escalação.

**Acesso e solicitação de cadastro.** Campos editáveis no Figma reutilizam a família local `92:5434`; botões usam `29:295`. O login solicita somente e-mail e senha. Criar conta permite atleta ou técnico; nome, e-mail e senha são comuns, e clube é obrigatório apenas para atleta. Os estados de envio encaminham para cadastro pendente, sem aprovar ou emitir carteirinha. Acesso de arbitragem leva à entrada temporária já existente. Credenciais inválidas, rede indisponível, limite de tentativas, e-mail existente, conflito, ausência de clubes, carregamento e sessão expirada são exemplos separados. Não há cadastro público de presidente nem recuperação de senha demonstrada.

As validações de nome, e-mail e senha usam snapshots e navegação direta para devolver cada um dos seis formulários ao mesmo estado de origem, preservando perfil, clube selecionado e formato. O readback final registrou 18 de 18 rotas de ida e volta corretas. Essa verificação do protótipo não representa validação real dos campos.

## Do's and Don'ts

### Do:
- **Do** manter clube, camisa e atleta próximos da ação e da confirmação.
- **Do** preservar rótulos de estado, foco visível e alvos de toque nas adaptações de viewport.
- **Do** usar os tokens como referência do novo frontend, seguindo docs/frontend.md e preservando os contratos reais.

### Don't:
- **Don't** confundir referência de implementação com frontend integrado, publicado ou validado pelo cliente.
- **Don't** usar cor como única identificação de clube ou estado.
- **Don't** interpretar snapshots como jogo contínuo, sincronização, câmera ou API validados.
- **Don't** acrescentar cronômetro, modo offline, controle de substituições, agenda pública ou exportação ao escopo demonstrado.

As imagens em `.impeccable/review/` são PNGs de evidência exportados do Figma, não assets raster de produção. Não há imagens geradas nem teste com árbitros reais nesta entrega.

Na visão do presidente, senhas e QR são fictícios. Campos, upload e clipboard não executam APIs; estados e diálogos são cenários independentes, sem sessão contínua ou validação com presidentes reais. Sua quantidade não promete funcionalidades implementadas.

Nas visões de atleta e técnico, os dados são sintéticos e o QR não tem validade real. Conexões entre snapshots demonstram ações individuais; não executam edição de campos, upload, persistência, leitura de QR, atualização ao vivo, logout ou teste de rede. O estado de ausência de conexão não representa modo offline. A consulta visual e os contratos documentados orientaram a proposta, sem entrevistas ou testes com atletas e técnicos reais.

No acesso, snapshots próprios e suas conexões demonstram os caminhos registrados no ledger. Saídas entre páginas usam URLs do protótipo canônico. Inputs, busca de clube, autenticação, criação de conta e erros são simulações, sem validação real de credenciais, autorização, rede ou aprovação. As capturas e verificações geométricas das correções não certificam teclado, leitores de tela ou acessibilidade do app. A revisão preservou os tokens primitivos e os dez snippets de demonstração do sidecar.

As rampas tonais do sidecar são amostras OKLCH sintetizadas para o painel de documentação, não variáveis adicionais aprovadas no Figma. Os snippets usam valores literais e dependem apenas de HTML/CSS; a fonte IBM Plex Sans precisa estar disponível no ambiente de visualização.
