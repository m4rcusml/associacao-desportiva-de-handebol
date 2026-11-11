# Plano do frontend de arbitragem

**Registro da etapa experimental.** A direção visual e o plano de implementação atual estão em [frontend.md](frontend.md) e no Figma ali vinculado. Este documento conserva contexto das integrações já desenvolvidas e suas garantias; a tabela de responsáveis e a restrição de Git ao final pertencem à rodada original, não definem a execução da próxima entrega.

10/11/2026. Escopo solicitado: persona, planejamento e implementação da experiência operacional do árbitro, preservando o backend. Referências: [persona](persona-arbitragem.md), [requisitos](requisitos.md), [arquitetura](arquitetura.md) e [insights](insights.md).

## Entregas e responsáveis

| Etapa | Responsável | Resultado verificável |
| --- | --- | --- |
| Persona e contexto | Antigravity; revisão Codex | Papel temporário, jornadas por fase, hipóteses e critérios observáveis. |
| Direção de interface | Claude Code, com `frontend-design` | Tema atual de quadra/súmula, paridade linha/banco, revisão de atleta/ocorrência e ações adequadas ao status. |
| Interface operacional | Codex #2 | Rotas, entrada, dados, credenciamento, participação, ocorrências, correções, ciclo e atualização Socket.IO. |
| Integrações e câmera | Codex | Leitor local de QR, links do presidente, acesso pela conta pessoal/login e dependências necessárias. |
| Revisão e QA | Codex e revisor independente | Contratos e permissões conferidos, checks do client e fluxos reais no Portal do Maestri. |

## Organização e fronteiras

- `/arbitragem`: abrir link ou UUID recebido, sem prometer agenda pública.
- `/arbitragem/jogos/[id]`: primeiro consulta o cookie temporário daquele jogo; oferece entrada por designação ou nome/senha quando não há acesso. Designação usa a sessão permanente, mas não a substitui.
- `features/arbitragem/` e `lib/arbitragem.ts`: componentes e contratos específicos, reutilizando tema, controles, diálogo e confirmação existentes.
- Antes da partida: credenciar atletas, corrigir camisa, desfazer credenciamento elegível, iniciar ou encerrar por W.O.
- Durante a partida: credenciar atrasados, confirmar entrada uma vez, registrar gols/penalidades, corrigir/anular ocorrências, interromper, retomar e encerrar. Interrupção impede novas ocorrências e entradas, mas preserva as correções permitidas pelo contrato.
- Linha e banco reorganizam a apresentação; ambos mantêm todas as ações autorizadas.
- Depois de encerrar: quem confirmou vê somente o recibo devolvido pelo POST; os demais recebem aviso de acesso encerrado. Não existe consulta final liberada à sessão revogada. Correções posteriores pertencem ao presidente.

## Persistência, concorrência e acesso

- Escritas REST, cookies HttpOnly por jogo, nenhuma senha ou token em URL, log ou armazenamento do navegador.
- `operacaoId` identifica cada intenção de lançamento/correção/anulação. Reenvio de resultado incerto conserva ID e conteúdo; uma nova intenção exige outro ID. Não há deduplicação automática de dois fatos lançados por dispositivos com IDs distintos.
- Respostas de GET anteriores a uma escrita ou revogação não podem substituir estado novo. Erro de releitura após escrita confirmada mantém o sucesso e oferece nova consulta, sem repetir a escrita.
- Socket.IO recebe avisos após persistência. A interface deduplica eventos repetidos, agrupa consultas e relê REST ao conectar/reconectar. Nunca aplica o aviso como placar oficial.
- Revogação invalida consultas em voo, para a câmera, retira dados privados e bloqueia ações. O recibo do próprio encerramento é tratado separadamente da sessão ativa.
- Sem offline, cronômetro inventado, novo perfil permanente ou permissões extras no frontend.

## QR e dependências

Usar `getUserMedia` com câmera traseira quando disponível e decodificação local; falha ou ausência de câmera mantém a seleção manual por lista. O leitor devolve o token bruto apenas em memória; o backend identifica e decide o credenciamento com a camisa informada. Fechar o leitor ou perder o acesso para todas as faixas de vídeo.

`socket.io-client` 4.8.4 acompanha a versão do servidor e usa long-polling no caminho configurado da API, compatível com o proxy atual. `jsqr` 1.4.0 oferece decodificação local de imagem, carregada sob demanda. Fontes primárias: [Socket.IO, opções do cliente](https://socket.io/docs/v4/client-options/) e [jsQR](https://github.com/cozmo/jsQR). As versões ficam fixadas no manifest e no lockfile do client.

## Critérios de conclusão

1. Entrar por senha sem conta e por conta designada, manter outras sessões e jogos isolados e preservar destino após login.
2. Credenciar manualmente e por QR, indicar impedimentos e camisa duplicada, confirmar entrada, corrigir camisa e estornar somente quando permitido.
3. Registrar cada tipo de ocorrência; corrigir/anular com histórico; reenviar resposta perdida sem duplicar a operação.
4. Iniciar, interromper, corrigir durante interrupção, retomar e encerrar; conferir W.O. e perda de acesso nos dispositivos.
5. Demonstrar atualização em outro dispositivo, reconexão e revogação por troca de senha/encerramento, sem sobrescrita por consultas antigas.
6. Conferir foco, teclado, bloqueio de diálogos durante envio e layout em 320/390 px, além de desktop.
7. Lint, tipos, build e asserts dos helpers passam. Registrar no README os cenários executados e as limitações de hardware/hospedagem que não foram testadas.

Sem commit, push, PR ou alteração de backend nesta rodada.
