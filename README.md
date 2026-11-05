# Associação Desportiva de Handebol

Projeto de uma aplicação para organizar clubes, atletas, campeonatos e jogos de handebol.
A proposta reúne aprovação de cadastros, carteirinhas, credenciamento, arbitragem e histórico
esportivo, apoiando o trabalho cotidiano da associação. O repositório está na etapa de
definição de requisitos e modelagem.

## Documentação

- [Requisitos funcionais, não funcionais e regras de negócio](docs/requisitos.md)
- [Modelagem do banco e suas regras](docs/modelo-banco-dados.md)
- [Diagrama com atributos e relações](docs/modelo-banco-dados.mmd)
- [Pendências e confirmações com o cliente](docs/pendencias.md)
- [Glossário](GLOSSARY.md)
- [Diagrama no Miro](https://miro.com/app/board/uXjVEU3V9rY=/?moveToWidget=3458764688860471326)

## Caminho feliz

1. **Preparação pelo presidente:** o presidente pré-cadastrado cria os clubes. Atletas e
   técnicos criam suas contas e solicitam verificação; o atleta informa seu clube, enquanto
   o técnico pode se cadastrar sem um. O presidente aprova os cadastros, gerando a carteirinha
   do atleta, e atribui um técnico a cada clube.
2. **Organização da competição:** o presidente cria um campeonato de uma categoria,
   inclui os clubes participantes, agenda os jogos e designa os árbitros. A inclusão dos
   clubes pelo presidente é a proposta inicial, ainda sujeita à confirmação do cliente.
3. **Preparação pelo técnico:** antes de cada partida, o técnico escolhe os atletas do seu
   clube que pretende levar ao jogo. Essa lista é preliminar e pode mudar até o início.
4. **Chegada e credenciamento:** antes da partida, os árbitros acessam a página temporária.
   Usuário autenticado e designado entra sem senha; os demais usam a senha do jogo e informam
   nome completo. O atleta apresenta sua carteirinha e informa o número da camisa.
   A arbitragem credencia manualmente ou lê o QR code; o sistema verifica aprovação,
   carteirinha ativa, clube participante e ausência de suspensão naquele campeonato.
5. **Durante o jogo:** a arbitragem inicia a partida, confirma quais atletas entraram em
   quadra e registra gols e penalidades. Cada gol identifica o atleta e atualiza o placar
   do clube. Árbitros de linha e banco usam telas diferentes, com as mesmas permissões.
   Atletas elegíveis podem ser credenciados mesmo atrasados ou fora da lista inicial.
6. **Encerramento e acompanhamento:** a arbitragem encerra o jogo e seu acesso temporário
   expira. O resultado e o desempenho ficam no histórico dos atletas; correções posteriores
   cabem ao presidente. Suspensões manuais são aplicadas por ele, por quantidade de jogos
   naquele campeonato; punições automáticas dependem de critérios a confirmar com o cliente.

As métricas ainda provisórias usam o prefixo `temp_`. As exceções e decisões em aberto
estão detalhadas nas [pendências](docs/pendencias.md).

## Fora do escopo inicial

- Equipes como entidade separada, carteirinha de técnico e múltiplas categorias por campeonato.
- Validação específica de categoria por idade/sexo, controle de substituições e tempo jogado.
- Auditoria completa, cujo detalhamento ficou para uma próxima etapa.
- Doações, patrocínios, divulgação pública de resultados e exportações, sem escopo confirmado.
