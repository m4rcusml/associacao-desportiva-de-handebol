# Acesso e limpeza · Proposta Figma

## Pedido e direção

Marcus pediu refazer o acesso, remover referências visuais ao frontend antigo e corrigir sobreposições. Modo Operate; extensão de **Orientação de ginásio**, já aprovada para arbitragem, presidente, atleta e técnico. IBM Plex Sans, verdes profundos, superfícies claras e controles diretos. Sem nova identidade, tokens primitivos, código do aplicativo ou alteração de regras.

## Entrada e cadastro

Página `4:2` do arquivo `gwHYKm5u7V8uP1lXBmxPPG`. Login desktop `7:2`, celular `92:5465`; cadastro desktop `7:22`, celular `92:5575`. Desktop demonstra (1440 × 900 px), celular (390 × 844 px). Esses viewports não estabelecem breakpoints CSS.

Login pede e-mail e senha; perfil vem da conta. O board de revisão apresenta sessões de exemplo de atleta, técnico e presidente, sem converter esses exemplos em seletor de perfil no login. O acesso de arbitragem aponta para a entrada temporária existente.

Criar conta distingue atleta e técnico. Nome completo, e-mail e senha são comuns; atleta escolhe clube existente obrigatório, técnico não escolhe clube. Busca e seleção de clube têm exemplos próprios. Envio do cadastro leva ao estado pendente correspondente. Aprovação esportiva pelo presidente permanece separada, sem emissão de carteirinha na inscrição. Não há cadastro público de presidente nem recuperação de senha demonstrada.

Campos reutilizam `92:5434` e botões `29:295`. Login inválido, falha de rede, limite de tentativas, e-mail existente, conflito, lista de clubes vazia, carregamento e sessão expirada possuem snapshots explicativos.

Validações de nome, e-mail e senha usam navegação direta de ida e volta para os seis contextos: atleta sem clube selecionado, atleta com clube selecionado e técnico, cada um em desktop e celular. Doze snapshots dedicados completam os estados existentes. O readback em `contextReturnFix` confirmou 18 de 18 rotas campo → validação → mesmo formulário de origem, preservando perfil, clube selecionado e formato.

## Limpeza e correções

Foram removidos 30 frames com prefixos de versões anteriores e dez componentes Roboto sem instâncias, preservando as famílias atuais. O Figma apresenta as propostas vigentes, sem referências visuais ao frontend antigo. A visão geral `17:2` foi atualizada. Ledgers e capturas históricos locais permanecem como registro; referências antigas nesses arquivos não indicam nós ainda existentes no Figma.

Na página de componentes `4:7`, o índice `92:6511` reúne seis links para as famílias atuais, documentados na [captura do índice](../review/componentes-atuais.png). A auditoria de limpeza abrangeu sete páginas e não encontrou referências legadas remanescentes.

Atleta: fluxo vertical dos cartões de histórico recalculado e textos do board ajustados à largura útil. Técnico: identificação da seção ativa nas telas atuais. Presidente: textos acompanham a largura dos painéis. Arbitragem: nomes e ações das camisas acompanham as instâncias; intervalos do placar móvel ajustados ao espaço disponível. Conteúdo, direção visual e destinos atuais foram preservados.

## Evidência e limites

O ledger [figma-acesso-state.json](../figma-acesso-state.json) registra snapshots próprios e conexões. Saídas entre páginas usam URLs do protótipo canônico. Capturas: [desktop](../review/acesso-desktop.png), [celular](../review/acesso-mobile.png), [atleta](../review/acesso-cadastro-atleta.png), [técnico](../review/acesso-cadastro-tecnico.png) e [erro](../review/acesso-erro.png).

A validação dedicada do técnico está documentada nas capturas de [celular](../review/acesso-validacao-tecnico-mobile.png) e [desktop](../review/acesso-validacao-tecnico-desktop.png). Os resultados finais de retorno estão no readback literal de `contextReturnFix`; capturas intermediárias de retorno não substituem esse registro.

Limpeza: [ledger](../figma-limpeza-state.json) e [visão geral](../review/visao-geral-atual.png). Correções: [atleta e técnico](../figma-correcao-atleta-tecnico.json), [presidente e arbitragem](../figma-correcao-presidente-arbitragem.json), com capturas antes/depois. As verificações registraram zero colisões entre textos irmãos para atleta/técnico e zero textos fora do pai imediato para presidente/arbitragem após os ajustes. Esses testes geométricos têm o escopo descrito nos respectivos ledgers.

Inputs, autenticação, busca, envio, erros e aprovação são demonstrações entre snapshots; não executam API, persistência ou validação real de credenciais. QR de outras áreas permanece ilustrativo e sem validade real. Falha de rede não representa modo offline. Capturas e geometria não certificam teclado, leitores de tela ou acessibilidade de aplicativo; não houve teste com usuários. Regras continuam nas fontes do produto, incluindo requisitos, glossário, arquitetura e pendências. Os dez snippets HTML/CSS do sidecar permanecem demonstrações isoladas e foram preservados.
