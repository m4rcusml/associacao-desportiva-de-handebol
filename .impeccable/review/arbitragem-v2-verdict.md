# Simplificação da arbitragem — 10/11/2026

Pedido: menos complexidade, mais recursos visuais, organização vertical e menos cliques nas ações importantes e frequentes.

Entrega no Figma: equipes simultâneas; camisas como botões com rótulo de ação; gol direto em um toque no modo padrão; modo de punição seguido da camisa; retorno a Gol após confirmação. Busca, troca de clube e painel de ocorrência deixam a operação principal. Súmula e opções preservam os detalhes. Desfazer do último gol fica disponível na chegada e após um registro novo, por anulação auditável.

Evidência: desktop-v2.png, mobile-v2.png, tablet-v2.png, gol-v2.png, exclusao-v2.png, gol-mobile-v2.png, exclusao-salva-v2.png, desfazer-v2.png e desfazer-inicial-v2.png. Exportações PNG de camadas editáveis do Figma, sem assets raster de produção. IDs e dimensões no ledger ../figma-arbitragem-v2-state.json.

Revisor independente: impeccable_finish_reviewer_v2. Revisão completa das oito capturas iniciais: leitura e redução de fricção confirmadas; um achado, uniformizar Desfazer no último gol já salvo. Correção aplicada com estados de placar próprios: 12→11 para anular o gol anterior, 13→12 para desfazer o recém-lançado. Verdict Pass: achado resolvido, sem regressões materiais identificadas nas composições, punição ativa ou placares. Disposition: ship no escopo avaliado.

Validação estrutural: o botão de camisa do modo Gol tem uma única interação ON_CLICK, que atualiza o nome da confirmação e navega diretamente ao estado salvo. A exclusão usa seleção do modo e toque na camisa. A anulação demonstrada tem uma única interação no botão Desfazer. Não houve alteração de código nem execução de testes de aplicação.

Limites: protótipo com nomes fictícios e placares de exemplo, sem simulação contínua, persistência, câmera ou sincronização real. A redução de toques foi representada no protótipo; ganho de tempo e prevenção de erros ainda exigem validação com árbitros em quadra. Sem detector HTML/CSS nesta rodada: não há fonte de UI web modificada e esse detector não verifica o Figma.
