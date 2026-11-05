# Gestão de handebol

Vocabulário consolidado na primeira versão da modelagem, em 04/11/2026. As decisões e restrições
estão em [docs/modelo-banco-dados.md](docs/modelo-banco-dados.md).

## Linguagem

### Usuário

Pessoa com uma conta e exatamente um perfil: atleta, técnico ou presidente.

### Atleta

Pessoa vinculada a um clube, sujeita à aprovação do presidente para obter sua identificação
esportiva.

### Técnico

Pessoa aprovada pelo presidente, responsável por escolher os atletas de seu clube para cada jogo.
Pode estar temporariamente sem clube.

### Presidente

Dirigente responsável por aprovações, organização das competições e decisões administrativas. Pode
cadastrar outros presidentes.

### Clube

Organização esportiva representada pelos atletas nos jogos e inscrita nos campeonatos.

_Evitar_: equipe como entidade independente.

### Vínculo com clube

Filiação de um atleta a um clube durante determinado período, preservada no histórico após sua
saída.

### Carteirinha

Identificação permanente do atleta, emitida após aprovação e reutilizada no credenciamento dos
jogos.

_Evitar_: ingresso, carteirinha do técnico, credencial por evento.

### Campeonato

Edição de uma competição esportiva com uma categoria, clubes participantes e jogos.

### Inscrição de clube

Inclusão de um clube pelo presidente em determinado campeonato.

_Evitar_: inscrição de equipe.

### Jogo

Partida entre dois clubes inscritos no mesmo campeonato.

_Evitar_: mandante e visitante nesta modelagem; usar clube A e clube B.

### Escalação

Escolha prévia dos atletas de um clube pelo técnico para um jogo. Não confirma quem será credenciado
ou entrará em quadra.

### Credenciamento

Validação pela arbitragem da identificação e da elegibilidade de um atleta para determinada partida.

### Participação

Registro que acompanha a escolha, o credenciamento e a efetiva entrada em quadra do atleta,
preservando o clube e o número da camisa daquele jogo.

### Arbitragem

Pessoas autorizadas a credenciar atletas e gerenciar os registros de uma partida, cadastradas ou
externas. Linha e banco são formas de visualização do mesmo trabalho.

### Lançamento de jogo

Registro de uma ocorrência esportiva, como um gol ou uma penalidade, usado para compor placar e
desempenho.

### Suspensão

Impedimento de um atleta por uma quantidade de jogos em determinado campeonato, aplicado pelo
presidente ou por regra automática.

### Cumprimento de suspensão

Registro de um jogo realizado que conta para reduzir o impedimento do atleta.
