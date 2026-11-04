> Registro histórico da reunião inicial. Decisões posteriores substituem estes apontamentos:
> consulte [a modelagem v1](modelo-banco-dados.md) e [o diagrama](modelo-banco-dados.mmd).

Freela de handball
================================================
Plano um pouco mais estruturado
================================================

acompanhamento da disponibilidade de cada atleta para campeonatos regionais, nacionais, etc

site vai ter 3 entidades: user comum, [presidente, admin]
usuários: atletas, presidente (prioridade)

objetivo é gerenciar os atletas

presidente: cria os campeonatos e só ele acessa isso; acessa clubes e atletas;

ter cadastro de atletas, clubes, campeonatos, jogos,

atualmente inscrição em campeonatos é feita em papel e outras coisas em papel e/ou excel

clubes de liga != clubes regionais

================================================
Plano um pouco mais estruturado
================================================

ponto principal: o caba quer automatizar o máximo possível

problema/funcionamento atual: não consegue gerenciar todos os atletas existentes, como quem tá jogando, que time tá jogando. o objetivo é facilitar a inscrição e o gerenciamento dos campeonatos para facilitar a obtenção de patrocínios e promover a liga da região (liga ouro etapa norte) por meio de divulgação no site de vitórias ou coisas assim. o cara quer ter doação na plataforma tbm para q as pessoas consigam contribuir com os times

exigência: ter clubes, atletas e identificação de carteirinha e identificação dos campeonatos regionais, clubes e ligas sei lá não entendi direito

o que já tem desenvolvido pela Rariane: tem um protótipo feito pela Rari que o cara gostou e outro protótipo feito pelo cara  inicialmente tbm

temos que desenvolver uma "carteirinha" pro atleta. toda vez que o usuário se cadastrar e for verificado, ele vai receber essa carteirinha que é uma identificação. essa carteirinha terá um código identificador a nível regional e o usuário vai usar isso quando for participar de jogos, igual ao app Luma, de eventos, mas a carteirinha é única e não uma carteirinha por evento (no luma é um qr code por evento e não é assim)

ele também precisa exportar as infos em pdf ou coisa assim

tecnologias de preferencia: firebase
