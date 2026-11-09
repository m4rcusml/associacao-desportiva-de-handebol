# Associação Desportiva de Handebol

Projeto de uma aplicação para organizar clubes, atletas, campeonatos e jogos de handebol. A proposta
reúne aprovação de cadastros, carteirinhas, credenciamento, arbitragem e histórico esportivo,
apoiando o trabalho cotidiano da associação. Persistência e o fluxo mínimo de contas estão
implementados localmente. Os fluxos esportivos descritos no caminho feliz continuam planejados.

## Documentação

- [Requisitos funcionais, não funcionais e regras de negócio](docs/requisitos.md)
- [Arquitetura e tecnologias aprovadas](docs/arquitetura.md)
- [Modelagem do banco e suas regras](docs/modelo-banco-dados.md)
- [Diagrama com atributos e relações](docs/modelo-banco-dados.mmd)
- [Pendências e confirmações com o cliente](docs/pendencias.md)
- [Glossário](docs/GLOSSARY.md)
- [Planejamento do backend no Linear](https://linear.app/marcusml/project/handebol-backend-7b366946f85f)
- [Diagrama no Miro](https://miro.com/app/board/uXjVEU3V9rY=/?moveToWidget=3458764688860471326)

## Desenvolvimento local

Frontend e backend têm instalações, lockfiles e builds independentes. A matriz de versões
está em [arquitetura](docs/arquitetura.md#matriz-inicial--07112026); os manifests indicam
os runtimes aceitos. Instale Docker com Compose para executar o PostgreSQL local.
Copie `.env.example` da raiz para `.env` e `server/.env.example` para `server/.env`.
As credenciais de exemplo são exclusivamente locais. Em `server/.env`, gere e preencha
`BETTER_AUTH_SECRET` (mínimo 32 caracteres) e `ARBITRAGEM_SENHA_CHAVE` (64 caracteres hexadecimais);
o mesmo comando gera os dois:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Não versione o valor gerado. As outras variáveis estão nos `.env.example`:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL do backend e das migrações; deve corresponder ao Compose. |
| `TEST_DATABASE_URL` | Banco separado, com nome terminado em `_test`; nunca usar o banco de desenvolvimento. |
| `BETTER_AUTH_URL` | URL externa da API, localmente `http://localhost:3001`. |
| `CLIENT_ORIGIN` | Origem exata autorizada, localmente `http://localhost:3000`, sem curinga. |
| `BETTER_AUTH_SECRET` | Segredo local aleatório, mantido no backend. |
| `ARBITRAGEM_SENHA_CHAVE` | Chave AES-256 (32 bytes em hex) da cópia cifrada da senha da arbitragem; fora do banco e do repositório. Trocá-la torna ilegíveis as cópias existentes. |
| `PORT` | Porta da API, padrão 3001. |
| `NOTIFICACOES_VARREDURA_MS` | Opcional. Intervalo da varredura das notificações Socket.IO (padrão 30000): reprocessa eventos não publicados e retira conexões revogadas sem aviso do banco (expiração, virada do dia, vínculo). |
| `NEXT_PUBLIC_API_URL` | Opcional em `client/.env.local`, conforme `client/.env.example`; padrão `http://localhost:3001/api`. Incorporado no build do Next. |

Use `localhost` nas duas URLs do navegador; não misture com `127.0.0.1`.

Na raiz do repositório, inicie o banco:

```sh
docker compose config --quiet
docker compose up -d --wait
```

O volume nomeado preserva os dados entre reinicializações. `docker compose down` para o banco
sem remover o volume; não use `down -v` para uma parada normal.

Prepare a persistência em `server/`:

```sh
cd server
npm ci
npm run db:deploy
npm run db:seed
```

`db:deploy` aplica as migrações versionadas, sem resetar o banco. `db:seed` gera/compila o
cliente Prisma e cria, em transação, um clube fictício e seu presidente fictício **sem credencial
de login**. Pode ser repetido; não aprova atletas/técnicos nem cria acesso administrativo.
O seed recusa `NODE_ENV=production`.

#### Presidente inicial e novos presidentes (MAR-55)

O primeiro presidente com acesso é criado por um procedimento restrito, executado por quem
administra a implantação (acesso ao servidor e ao `DATABASE_URL`), após `npm run build`:

```sh
npm run presidente:inicial -- --nome "Nome Completo" --email pessoa@exemplo.org
```

A senha é digitada de forma oculta e confirmada no terminal; com entrada redirecionada, vale a
primeira linha. Não há senha padrão nem senha em argumentos ou arquivos versionados. Identidade,
credencial, `Usuario` e `Presidente` (sem criador) são gravados em uma transação. O procedimento é
serializado por advisory lock e recusa a execução quando já existe presidente ativo com credencial;
o presidente fictício do seed, sem credencial, não impede o procedimento. Falhas não deixam registros.

Depois disso, somente presidente ativo autenticado cria outros presidentes com
`POST /api/presidentes` (`nomeCompleto`, `email`, `password` com a senha inicial), e o criador fica
em `Presidente.criadoPorPresidenteId`. Campos adicionais são rejeitados; atleta, técnico, conta
inativa e cadastro público não criam presidentes. Enquanto recuperação e troca de senha não
existirem, a senha inicial deve ser entregue ao novo presidente por canal seguro.

Presidente ativo desativa ou reativa outras contas com `POST /api/contas/{usuarioId}/desativacao`
e `POST /api/contas/{usuarioId}/reativacao` (corpo vazio). Desativar bloqueia login e operações e
revoga as sessões já abertas; reativar exige novo login. Histórico e vínculos são preservados; não
há exclusão de conta nem troca de perfil. O último presidente ativo com credencial não pode ser
desativado, inclusive em solicitações simultâneas (MAR-60).

Qualquer conta autenticada e ativa altera o próprio nome com `PATCH /api/conta` (somente
`nomeCompleto`). A conta vem da sessão; não há rota para editar terceiros. O nome do domínio e o
`AuthUser.name` mudam na mesma transação, sem nova aprovação: perfil, clube, verificação, ativação,
carteirinha, e-mail e senha não são aceitos no corpo nem alterados. As rotas nativas do Better Auth
para nome, e-mail e senha continuam bloqueadas (MAR-59).

#### Clubes e técnicos (MAR-56)

Somente presidente ativo autenticado administra clubes: `POST /api/clubes` (`nome`, `cidade`
opcional; nome não precisa ser único) e `PATCH /api/clubes/{clubeId}` (`nome` e/ou `cidade`, que
aceita `null`). Não há exclusão nem desativação de clubes; a edição preserva vínculos.
Qualquer conta autenticada e ativa, inclusive pendente, lista todos os clubes com o técnico atual
(id e nome, ou `null`) em `GET /api/clubes/visao-geral` e consulta um clube em
`GET /api/clubes/{clubeId}`; somente o presidente recebe também `criadoPorPresidenteId` e `ativo`
do técnico. `GET /api/clubes` continua público e mínimo (id, nome, cidade), sem técnico, para o
cadastro. Técnico atribuído cuja conta foi desativada permanece no clube até ser substituído ou
desvinculado pelo presidente. A vaga de técnico é administrada com
`PUT /api/clubes/{clubeId}/tecnico` (`tecnicoId`; para substituir, `substituirTecnicoId` com o
técnico atual) e `DELETE /api/clubes/{clubeId}/tecnico/{tecnicoId}`, deixando o clube sem técnico.
Só técnico aprovado e com conta ativa é atribuído; técnico já atribuído a outro clube, vaga ocupada
sem indicar o técnico atual e atribuições concorrentes à mesma vaga respondem 409.

#### Campeonatos e inscrições (MAR-61)

Somente presidente ativo autenticado cria, lista e consulta campeonatos: `POST /api/campeonatos`
(`nome`, `edicao`, `categoria` textual e, opcionalmente, `inicio`/`fim` em AAAA-MM-DD, apenas
informativos), `GET /api/campeonatos` e `GET /api/campeonatos/{campeonatoId}` (inscrições e
contagem de jogos por status). Com o campeonato planejado, inscreve clubes em
`POST /api/campeonatos/{campeonatoId}/inscricoes` (`clubeId`; uma inscrição por clube) e retira
inscrição sem jogos em `DELETE /api/campeonatos/{campeonatoId}/inscricoes/{inscricaoId}`.
O ciclo é manual: `POST .../iniciar` (planejado, ao menos dois clubes), `POST .../encerrar` (em
andamento, todos os jogos finalizados ou cancelados) e `POST .../cancelar` (planejado ou em andamento,
sem jogo em andamento; cancela os agendados). Repetir a transição já aplicada devolve o estado com
`alterado: false`; transição inválida ou sem pré-condição responde 409. Não há exclusão de campeonatos.

#### Jogos e arbitragem (MAR-62)

Somente presidente ativo agenda jogos em `POST /api/campeonatos/{campeonatoId}/jogos` (`clubeAId` e
`clubeBId` distintos e inscritos no campeonato planejado ou em andamento, `inicioPrevisto` como hora
local `AAAA-MM-DDTHH:mm`, `fusoHorario` IANA do local e `local` opcional). O backend calcula o
instante (`inicioPrevistoEm`, UTC) e devolve também `inicioPrevistoLocal`; fuso desconhecido ou hora
inexistente/ambígua por horário de verão respondem 400. Agendar não inicia o jogo. Consulta em
`GET /api/campeonatos/{campeonatoId}/jogos` e `GET /api/jogos/{jogoId}`. A arbitragem é designada em
`POST /api/jogos/{jogoId}/arbitragens` com `usuarioId` (atleta/técnico aprovado, ativo, sem vínculo
com os clubes do jogo, uma vez por jogo) ou `nomeCompleto` (pessoa sem cadastro) e retirada em
`DELETE /api/jogos/{jogoId}/arbitragens/{arbitragemId}`, ambas com o jogo agendado ou em andamento.
Designar não abre acesso por si: a entrada é descrita abaixo (MAR-65); início, encerramento, adiamento e cancelamento, em "Ciclo do jogo" (MAR-69).

#### Transferência de atletas (MAR-63)

Somente presidente ativo transfere em `POST /api/atletas/{atletaId}/transferencia` (`clubeAtualId`,
que confirma a origem, e `clubeDestinoId`). Exige atleta aprovado (conta ativa ou desativada) e
nenhum campeonato em andamento com o clube atual inscrito, inclusive eliminado/desistente (PEN-017);
o destino não é restrito. O vínculo atual é encerrado e o seguinte aberto no mesmo instante; vínculos
anteriores não mudam. Repetir a transferência devolve `alterado: false`; origem divergente, atleta
pendente/rejeitado ou campeonato em andamento respondem 409. O histórico fica em
`GET /api/atletas/{atletaId}/vinculos`. A carteirinha não muda.

#### Escalação preliminar (MAR-64)

O técnico aprovado atual escala atletas do próprio clube em jogo agendado do clube:
`POST /api/jogos/{jogoId}/escalacao` (`atletaId`) inclui e `DELETE /api/jogos/{jogoId}/escalacao/{atletaId}`
retira. Só entram atletas aprovados, com vínculo atual no clube, conta ativa e carteirinha ativa: quem
seria barrado no credenciamento não é escolhido. Depois do início do jogo, ou com o jogo
finalizado/cancelado, a escalação responde 409. Repetir devolve `alterado: false`. `GET` na mesma rota
mostra ao técnico o próprio clube e ao presidente os dois: escolhidos (com o técnico que escolheu e
`vinculoAtual`), histórico de inclusões/retiradas e atletas que podem ser escolhidos. O novo técnico vê e
altera a lista do anterior; confirmar atleta já escolhido mantém a autoria original. Presidente não
escala; clube sem técnico apto fica sem escalação, e a arbitragem credencia diretamente (MAR-67).
Escalar não credencia nem confirma entrada em quadra. Depois de uma transferência, a escolha antiga
aparece com `vinculoAtual: false` e não serve para credenciar pelo clube anterior.

#### Acesso temporário da arbitragem (MAR-65)

No dia do jogo (no fuso do local) ou com o jogo em andamento, a arbitragem entra por
`POST /api/arbitragem/jogos/{jogoId}/entrada/designacao` (conta autenticada, designada, ativa, aprovada e
sem vínculo com os clubes do jogo) ou por `POST /api/arbitragem/jogos/{jogoId}/entrada/senha`
(`nomeCompleto` e `senha`, sem conta nem conferência de vínculo; 10 tentativas por IP a cada 10 minutos).
Ambas aceitam `visualizacao` (`linha`/`banco`) e emitem o cookie HttpOnly `handebol.arbitragem.{jogoId}`,
separado do cookie da conta. Com ele: `GET .../sessao`, `PUT .../visualizacao` e `POST .../saida` (só este
dispositivo). Jogo agendado sem início até a virada do dia local perde o acesso até ser reagendado.
O presidente e as contas designadas consultam a senha em `GET /api/jogos/{jogoId}/arbitragem/senha` (gerada
na primeira consulta) e a trocam em `POST /api/jogos/{jogoId}/arbitragem/senha/troca`, que revoga as sessões
por senha e preserva as designadas. A sessão temporária não consulta nem troca a senha. Retirar a
designação, encerrar a sessão da conta de origem ou desativar a conta invalida as entradas por designação;
cancelar o campeonato revoga os acessos dos jogos cancelados.

#### Suspensões manuais (MAR-66)

O presidente suspende atleta aprovado (conta ativa ou desativada) em campeonato planejado ou em andamento:
`POST /api/campeonatos/{campeonatoId}/suspensoes` (`atletaId`, `quantidadeJogos` inteira positiva e `motivo`),
registrando quem aplicou e quando. Suspensões simultâneas do mesmo atleta coexistem e são cumpridas em
paralelo. `GET` na mesma rota (filtro opcional `atletaId`) mostra a situação (`vigente`, `cumprida`,
`revogada` ou `saldo_encerrado`), jogos cumpridos e restantes; o saldo é derivado dos cumprimentos.
`POST .../suspensoes/{suspensaoId}/revogar` revoga a vigente, preservando aplicação e jogos cumpridos
(repetir devolve `alterado: false`; cumprida ou com saldo encerrado responde 409). Encerrar ou cancelar o
campeonato encerra o saldo restante, sem transportá-lo. O cumprimento é registrado no encerramento do jogo
(MAR-69): cada jogo finalizado do clube conta uma vez para
cada suspensão vigente, mesmo sem escalação, exceto o jogo em que o atleta já estava credenciado antes da
aplicação. A escalação sinaliza `suspensaoPendente` sem impedir a escolha; o credenciamento (MAR-67) barra.
Somente o presidente consulta suspensões nesta etapa.

#### Credenciamento e entrada em quadra (MAR-67)

Com o cookie temporário do jogo, a arbitragem consulta em `GET /api/arbitragem/jogos/{jogoId}/atletas`, por
clube, os atletas aprovados com vínculo atual e os já credenciados, com a escolha do técnico, o
credenciamento e o impedimento atual (`nao_aprovado`, `sem_vinculo_com_clubes_do_jogo`, `conta_desativada`,
`carteirinha_invalidada` ou `suspensao`). `POST .../leitura-qr` (`tokenQr` no corpo) identifica o atleta sem
credenciar. `POST .../credenciamentos` credencia por confirmação manual (`atletaId`) ou QR (`tokenQr`), sempre
com `numeroCamisa` (inteiro não negativo, único no clube e jogo): as duas formas aplicam as mesmas regras, e o
QR válido confirma automaticamente. Vale antes do início e durante a partida, para escalados ou não. Repetir com
a mesma camisa (QR repetido, reenvio) devolve `alterado: false`; com outra camisa, 409 (use a correção abaixo). QR
substituído responde 404, e o QR sozinho não autoriza nada. `POST .../credenciamentos/{atletaId}/entrada`
registra uma vez a entrada em quadra, somente com o jogo em andamento e a conta do atleta ativa. Suspensão,
invalidação ou transferência posteriores preservam o credenciamento e não impedem a entrada.

#### Correção de camisa e estorno do credenciamento (MAR-71)

Até o encerramento, a arbitragem corrige a camisa em `POST .../credenciamentos/{atletaId}/camisa`
(`{ numeroCamisaAtual, numeroCamisa }`), inclusive após a entrada em quadra, mantendo a camisa única no clube e jogo.
`POST .../credenciamentos/{atletaId}/estorno` (`{ numeroCamisa }`) desfaz o credenciamento somente sem entrada em
quadra e sem gols/penalidades registrados (inclusive anulados); a escolha do técnico permanece e o atleta pode ser
credenciado de novo. A camisa informada diferente da atual é 409 com a `participacao` atual; repetir a operação já
feita devolve `alterado: false`. Cada correção e estorno grava em `AlteracaoCredenciamento` a cópia do credenciamento
alterado. Depois do encerramento, somente o presidente corrige a camisa, em
`POST /api/jogos/{jogoId}/credenciamentos/{atletaId}/camisa`, sem reabrir a arbitragem. Estorno ou outra correção
de atleta que entrou ou tem lançamentos fica para o presidente quando a PEN-019 for detalhada.

#### Gols e penalidades (MAR-68)

Com o cookie temporário do jogo e o jogo em andamento, a arbitragem registra em `POST
/api/arbitragem/jogos/{jogoId}/lancamentos` uma ocorrência por vez: `operacaoId` (UUID gerado pelo cliente),
`tipo` (`temp_gol`, `temp_cartaoAmarelo`, `temp_exclusaoDoisMinutos` ou `temp_cartaoVermelho`) e `participacaoId`
do atleta credenciado no jogo. Não há clube nem valor no corpo: o clube vem da participação e cada ocorrência vale 1.
Reenviar a mesma operação devolve o registro existente com `alterado: false`; o mesmo `operacaoId` com outro
conteúdo é 409 e não sobrescreve o original. A resposta traz o placar atualizado. `GET .../lancamentos` devolve o
placar (`null` antes do início), o desempenho de cada credenciado e os lançamentos em ordem de registro. Placar e
desempenho são as views `EstatisticasDoJogo` e `DesempenhoDoAtleta`, calculadas dos lançamentos não anulados.

#### Correção e anulação de lançamentos (MAR-70)

Com o jogo em andamento, a arbitragem corrige em `POST .../lancamentos/{lancamentoId}/correcao` (corpo igual ao do
registro: novo `operacaoId`, `tipo` e `participacaoId` de atleta credenciado; é preciso mudar o tipo ou o atleta) e
anula em `POST .../lancamentos/{lancamentoId}/anulacao` (`{ operacaoId }`). A correção anula o original e cria o
substituto (`substituiLancamentoId`) na mesma transação; a anulação é lógica. Nada é apagado: a consulta continua
listando os anulados, com `anuladoEm` e `substituidoPorId`, fora do placar e do desempenho. O valor continua 1 por
ocorrência. Reenvio da mesma operação devolve `alterado: false`; a segunda correção ou anulação do mesmo lançamento
recebe 409 com `lancamento` (registro atualizado) e `substituto`. Após o encerramento, somente o presidente consulta
(`GET /api/jogos/{jogoId}/lancamentos`, em qualquer status), corrige e anula pelas rotas equivalentes em
`/api/jogos/{jogoId}/lancamentos/{lancamentoId}/...`, sem incluir lançamentos novos, sem reabrir a arbitragem e sem
refazer o cumprimento de suspensões.

#### Ciclo do jogo (MAR-69, MAR-72)

Com o cookie temporário, a arbitragem inicia o jogo agendado em `POST /api/arbitragem/jogos/{jogoId}/inicio`
(no dia do jogo, no fuso do local) e o encerra em `POST .../encerramento` (um árbitro basta), informando
`resultado` (`normal`, `interrompido` definitivamente, `abandono` ou `wo`) e `vencedorInscricaoId` (inscrição do
clube A ou B, ou `null` para nenhum vencedor), separados do placar. Jogo em andamento encerra como normal,
interrompido ou abandono; W.O. encerra o jogo agendado, sem início, no dia do jogo, com placar 0 a 0.
O encerramento finaliza o jogo, registra o cumprimento das suspensões e revoga a senha e todas as sessões
temporárias na mesma transação, devolvendo só o jogo (com resultado e vencedor) e o placar final. Repetir o início, ou reenviar o
encerramento pela sessão revogada por ele, devolve o estado com `alterado: false`, sem reabrir acesso.
Em `POST .../interrupcao` e `POST .../retomada`, a arbitragem pausa e retoma o mesmo jogo: o status continua em
andamento, com os mesmos registros e acessos, e a pausa não cumpre suspensões; novos lançamentos e entradas em
quadra aguardam a retomada (correções, anulações e credenciamentos continuam). Repetir não tem efeito. Após o
encerramento, somente o presidente consulta `GET /api/jogos/{jogoId}/resultado`, corrige resultado/vencedor em
`POST /api/jogos/{jogoId}/correcao-resultado` (`atual` visto e `novo`; divergência é conflito) e invalida o jogo,
definitivamente e com `motivo`, em `POST /api/jogos/{jogoId}/invalidacao`, com histórico e sem alterar placar,
estatísticas ou cumprimentos. O presidente
adia o jogo agendado em `POST /api/jogos/{jogoId}/adiamento` (`inicioPrevisto` local ou `null` para ficar sem data;
`fusoHorario` e `local` opcionais): gera nova senha, se já emitida, e revoga as sessões dos dois métodos. Cancela o
jogo agendado em `POST /api/jogos/{jogoId}/cancelamento`, revogando os acessos; jogo cancelado não conta para
suspensões, e repetir devolve `alterado: false`. Escalação, credenciamentos, contas e outros jogos são preservados.

#### Notificações em tempo real (MAR-73)

Os dispositivos da arbitragem conectam o Socket.IO em `/api/socket.io` (mesmo servidor da API), com
`auth: { jogoId }`, o cookie temporário daquele jogo e a origem `CLIENT_ORIGIN`; conta permanente, outro jogo ou
outra origem são recusados. O servidor envia `jogo:evento` (`id`, `jogoId`, `tipo`, `referenciaId`,
`ocorridoEm`) depois do commit de cada mudança do jogo: escalação, credenciamento, entrada em quadra, início,
pausa, retomada, encerramento, adiamento, cancelamento, lançamentos e visualização. O aviso não traz dados: o
dispositivo consulta a API REST ao recebê-lo e ao (re)conectar, e ignora `id` repetido. A conexão que deixa de estar
autorizada recebe `acesso:encerrado` com o motivo da própria sessão (`troca_senha`, `jogo_encerrado`, `jogo_adiado`,
`jogo_cancelado`, `saida`) ou `acesso_indisponivel`, e é desconectada. Contrato completo na extensão `x-socketio` de
`GET /api/openapi.json`; mecanismo de publicação na [arquitetura](docs/arquitetura.md#acesso-público-e-comunicação).

Para alterar o esquema: `npm run db:migrate -- --name descricao`, revisar o SQL produzido e
executar `npm run db:generate`. Restrições SQL complementares estão nas migrações seguintes.
Não altere migrações já aplicadas. Em teste/produção, aplique as mesmas com `db:deploy`.

Inicie as aplicações em terminais separados:

```sh
cd client
npm ci
npm run dev
```

```sh
cd server
npm ci
npm run start:dev
```

A interface responde em `http://localhost:3000`; a API oferece `GET http://localhost:3001/api/health`.
O endpoint de saúde confirma apenas que o processo HTTP está ativo; ainda não consulta o banco.

| Operação | Em `client/` | Em `server/` |
| --- | --- | --- |
| Lint | `npm run lint` | `npm run lint` |
| Tipos | `npm run typecheck` | `npm run typecheck` |
| Build | `npm run build` | `npm run build` |
| Executar build | `npm start` | `npm run start:prod` |

`typecheck` do backend também verifica seed, configuração Prisma e testes, usando as declarações
geradas pelo build. `build` gera o cliente Prisma antes de compilar. Um único `PrismaService`
é compartilhado por toda a aplicação Nest; seed e testes rodam em processos próprios.

### Fluxo de contas disponível

1. Abra `http://localhost:3000/cadastro`; informe nome completo, e-mail, senha de 8 a 128
   caracteres e perfil atleta ou técnico. Atleta deve selecionar clube; técnico começa sem clube.
2. O cadastro solicita verificação e fica pendente; não há confirmação de e-mail nem autoaprovação.
   O presidente consulta as solicitações (`GET /api/verificacoes`) e aprova ou rejeita
   (`POST /api/verificacoes/{usuarioId}/aprovacao` ou `/rejeicao`, corpo vazio). Aprovar atleta
   confirma o vínculo e emite a carteirinha na mesma transação; técnico não recebe carteirinha.
   Rejeitado solicita nova análise pela própria conta (`POST /api/verificacoes/solicitacao`).
   Não há retirada de aprovação; contas desativadas não recebem decisão (409).
   O atleta aprovado consulta a própria carteirinha e o QR vigente (`GET /api/carteirinhas/minha`).
   O presidente consulta a carteirinha e o histórico (`GET /api/carteirinhas/atleta/{atletaId}`),
   invalida ou reativa (`POST .../invalidacao` ou `.../reativacao`, corpo vazio) e substitui o QR
   (`POST .../substituicao-qr` com `versaoQr`, a versão a invalidar). `POST /api/carteirinhas/leitura`
   (`tokenQr` no corpo) devolve só carteirinha, código, status e nome; QR substituído responde 404.
3. Entre em `/login`. A página inicial consulta `/api/sessao` e permite verificar `/api/protegida`.
4. Recarregue para confirmar a sessão persistida. “Sair da conta” revoga somente a sessão atual
   no PostgreSQL e remove o cookie; outros dispositivos continuam autenticados.

O contrato está em `GET /api/openapi.json`. Cadastro usa `POST /api/cadastros`; login e logout
usam `POST /api/auth/sign-in/email` e `POST /api/auth/sign-out` (corpo `{}` no logout).
`GET /api/auth/get-session` consulta apenas a sessão técnica; use `/api/sessao` para o cadastro
ativo do domínio. Rotas nativas de cadastro, edição de conta e recuperação estão bloqueadas.
Campos extras são rejeitados; presidente não pode ser criado publicamente.

Identidade técnica, hash gerado pelo Better Auth, usuário, extensão e vínculo inicial são
gravados na mesma transação Prisma. E-mail é normalizado para minúsculas; duplicatas retornam
409, inclusive em concorrência. Em falha de vínculo ou de commit, nada é mantido; uma nova
tentativa pode concluir. Após resposta perdida, repetir retorna 409 se já houve commit: faça login.
O guard consulta sessão persistida e cadastro ativo a cada acesso protegido. Aprovação esportiva
não é exigida na rota de demonstração e não é concedida por autenticar.

Cookies são `HttpOnly; SameSite=Lax`, host-only e `Secure` em produção; HTTP local usa `Secure=false`.
Sessões expiram em sete dias, sem renovação automática nesta entrega, com `cookieCache` desligado.
POST exige `Origin` exatamente igual a `CLIENT_ORIGIN`, inclusive em clientes de linha de comando;
use JSON. CORS autoriza apenas essa origem e cookies. A biblioteca mantém sua proteção nativa de
origem/CSRF. Com `NODE_ENV=production`, API e cliente exigem URLs HTTPS na configuração.

As páginas são cascas estáticas; os dados autenticados são consultados no navegador com
`credentials: include` e `cache: no-store`. Não há SSR de sessão nesta entrega. Se for introduzido,
será necessário repassar cookies ao Nest e testar isolamento por requisição e cache. HTTPS,
encaminhamento do domínio público e cookies hospedados ainda precisam de prova online.

### Testes de integração

Com Docker ativo, crie uma vez o banco dedicado (ajuste o usuário se mudou o `.env`):

```sh
docker compose exec postgres psql -U handebol -d postgres -c "CREATE DATABASE handebol_test;"
```

Em `server/`, configure `TEST_DATABASE_URL` no `.env` e execute:

```sh
npm run test:integration
```

A suíte descobre todos os arquivos `test/**/*.integration.ts` e os executa em série, aplica as
migrações no banco de teste, inicia uma API em porta livre e limpa somente suas próprias fixtures.
Não precisa das aplicações abertas. O runner exige `DATABASE_URL` e `TEST_DATABASE_URL` com nomes
de banco diferentes; o banco de teste deve terminar em `_test`, sem parâmetros ou fragmento na URL.
Antes das migrações, obtém um advisory lock transacional no PostgreSQL: uma segunda execução no
mesmo banco falha imediatamente, inclusive em outra máquina. O lock é liberado ao finalizar ou
fechar a conexão. Use sempre `npm run test:integration`; não execute arquivos isoladamente.
Essa exclusão protege os testes que instalam temporariamente triggers de falha no commit.
O log de erro dessa falha e o aviso de senha incorreta são esperados nos testes.

### Checks de backend nos PRs (MAR-53)

O workflow [Backend](.github/workflows/backend.yml) executa em todos os PRs, pushes em `main`
e manualmente, sem modificar ou instalar o frontend. O check esperado pelo revisor é
`Backend checks`: `npm ci`, `npm run lint`, `npm run typecheck` (inclui build) e
`npm run test:integration`, em Ubuntu 24.04 com Node.js 26.8.2 e npm 12.2.0, aceitos pelos manifests.
Cada job recebe PostgreSQL 17.11 descartável, com banco `handebol_test` e credenciais fictícias
exclusivas de CI; não usa segredos de implantação nem depende de um arquivo `.env`.
O runner também pode carregar o `.env` local quando existir, preservando as variáveis do ambiente.

O revisor deve conferir esse check aprovado, a descoberta dos arquivos de integração e as provas
de rejeição de banco inadequado/execução simultânea. Alterações apenas no frontend também recebem
o check para evitar checks obrigatórios pendentes por filtro de caminhos. O workflow tem somente
permissão de leitura e não altera proteção de branch ou configura bypass. A primeira execução
hospedada deve ser conferida no PR; executar os comandos localmente não comprova o runner do GitHub.

Validação local da MAR-53 em 07/11/2026: `npm ci`, lint, tipos/build, leitura do YAML do workflow
e 17 testes de integração aprovados. A suíte passou no banco dedicado existente e em um
PostgreSQL 17.11 descartável, com as três migrações aplicadas desde zero e as variáveis fictícias
da CI. Nenhuma dependência foi adicionada. A execução hospedada no GitHub Actions permanece pendente.

Validação em 07/11/2026, Node.js 26.8.2/npm 12.2.0 e PostgreSQL 17.11:

- Três migrações aplicadas, seed repetível e leitura/escrita pelo Prisma comprovadas.
- Onze testes HTTP/banco: privilégios, restrições SQL, OpenAPI, origem/CORS, consistência em
  falhas e repetição, cadastros concorrentes, hash/login, expiração, conta inativa, identidade sem
  domínio, múltiplos dispositivos e replays paralelos do cookie antigo após conclusão do logout.
- Configuração HTTPS de produção testada no handler com emissão de cookie Secure/HttpOnly/Lax;
  isso não substitui a prova do proxy/TLS hospedado.
- Navegador Edge/Playwright: cadastro de atleta e técnico, login, acesso protegido, recarga autenticada e
  logout com nova recarga; inspeção de layout móvel e desktop.
- Lint, tipos e builds das duas aplicações aprovados; árvore de dependências do backend válida.
- Auditoria npm do backend: nenhum alerta de produção; sete alertas moderados na cadeia
  de desenvolvimento `typescript-eslint`/`minimatch`. ESLint 9 segue a limitação já documentada.

Não foram criados recursos online. PEN-030 continua parcialmente aberta: arbitragem temporária,
Socket.IO, concorrência com operações esportivas, implantação e futura recuperação/reset não
foram implementados nem validados. Os patches-alvo de Node/npm da matriz não foram executados.

Validação local da MAR-54 em 07/11/2026: lint, tipos/build e 22 testes de integração aprovados,
incluindo cinco novos de autorização por HTTP (atleta/técnico pendente, rejeitado e aprovado,
presidente, inativo, identidade sem domínio, cruzamento de clubes, parâmetros forjados e
transferência) e revalidação em transação concorrente com desativação. Nenhuma dependência nova.
Revisão da MAR-54: comparação de UUID de clube sem distinção entre maiúsculas e minúsculas;
regressão HTTP para atleta/técnico no próprio clube e em outro clube. Lint, tipos/build e 22 testes revalidados.

Validação local da MAR-55 em 07/11/2026: lint, tipos/build e 26 testes de integração aprovados,
incluindo quatro novos: procedimento do presidente inicial executado como processo (entrada inválida,
falha no commit, duas execuções simultâneas com exatamente uma concluída, login e repetição recusada),
criação autorizada com criador registrado, e-mail repetido/campos forjados, rollback no commit pela API
e escalada negada (sem sessão, atleta, técnico aprovado, presidente desativado e cadastro público).
A entrada oculta no terminal interativo não é coberta pelos testes automatizados.

Validação local da MAR-60 em 07/11/2026: lint, tipos/build e 30 testes de integração aprovados,
incluindo quatro novos: desativação de atleta/técnico com revogação das sessões abertas (vários
dispositivos), login recusado, histórico/vínculo/aprovação preservados, repetição sem efeito e
reativação com novo login; acesso indevido (sem sessão, atleta, técnico aprovado, própria conta,
origem, corpo forjado, conta inexistente); cinco rodadas dos dois últimos presidentes desativando um
ao outro simultaneamente, com exatamente um ativo; recusa do último presidente com credencial e
`contaAtiva` aguardando desativação concorrente. Após revisão: 31 testes aprovados, com regressão de
login concorrente (barreira entre a leitura da conta pelo hook e a gravação da sessão): desativação, ou
desativação e reativação, no intervalo não deixa sessão gravada; sessão em gravação faz a desativação
aguardar e é revogada; versão desatualizada ou ausente é recusada pelo banco. Migração
`sessao_conta_ativa`; nenhuma dependência nova.

Validação local da MAR-56 em 07/11/2026: lint, tipos/build e 31 testes de integração aprovados,
incluindo cinco novos: criação/consulta/edição de clubes com nome repetido, listagem pública mínima
e regressão do cadastro de atleta; atribuição, repetição, substituição explícita e desvinculação com
efeito imediato no acesso do técnico; recusa de técnico pendente, rejeitado, inativo ou inexistente e
restrições do banco acionadas diretamente; três rodadas de atribuições concorrentes à mesma vaga, de
substituições concorrentes e do mesmo técnico em dois clubes, com exatamente uma concluída; e acessos
indevidos (sem sessão, atleta, técnicos, pendente, sem origem e presidente desativado). Uma migração nova.
Após a revisão: 33 testes aprovados, com dois novos — visão geral/consulta para presidente (com `ativo`
do técnico), técnico e atleta, inclusive pendentes (sem `ativo`), clube sem técnico, 401 sem sessão e
para conta desativada, rota pública sem técnico; e técnico atribuído com conta desativada substituído
e desvinculado pelo presidente, com nova atribuição de técnico inativo recusada. Lint e tipos/build aprovados.
Após integrar a MAR-60 da `main`: lint, tipos/build e 38 testes de integração aprovados em banco
recém-criado; a migração `tecnico_clube_aprovado` foi renomeada para depois de `sessao_conta_ativa`.

Validação local da MAR-57 em 08/11/2026: lint, tipos/build e 44 testes de integração aprovados,
incluindo seis novos: consulta e aprovação de atleta com vínculo confirmado e carteirinha única
(código/token opacos, sem `tokenQr` ou e-mail na resposta) e repetição sem duplicar; aprovação de técnico
sem carteirinha; rejeição sem motivo, nova solicitação na mesma conta e aprovação posterior (atleta e
técnico); cinco rodadas de aprovações simultâneas (inclusive por dois presidentes) e de aprovação contra
rejeição, com uma única decisão/carteirinha; falha simulada no commit da emissão desfazendo aprovação,
vínculo e carteirinha, com nova tentativa concluída, e restrições do banco acionadas diretamente; acesso
indevido (sem sessão, atleta/técnico aprovados ou pendentes, autoaprovação, sem origem, corpo/filtros
forjados, inexistente, conta desativada e presidente desativado). Fixtures que aprovam atletas
diretamente no banco passaram a criar carteirinha. Uma migração nova; nenhuma dependência nova.

Validação local da MAR-58 em 08/11/2026: lint, tipos/build e 52 testes de integração aprovados,
incluindo seis novos: consulta própria do atleta e leitura do QR com identificação mínima (sem e-mail,
código manual não serve como token); invalidação e reativação com histórico e responsável, repetição
sem novo evento, login, sessão e aprovação preservados; substituição do QR na mesma carteirinha
(mesmo código e status, token anterior não reconhecido, novo token na consulta do atleta, reenvio da
mesma versão sem novo QR, versão futura 409); três rodadas de substituições e invalidações retidas no
commit contra concorrentes e de pedidos HTTP paralelos, com um único efeito; restrições do banco
(identificação, versão e histórico imutáveis); e acesso indevido (sem sessão, atleta, técnico,
pendente, QR como cookie/bearer, token na URL, sem origem, corpo forjado, sem carteirinha e presidente
desativado). O teste da MAR-57 que alterava código/atleta diretamente passou a esperar a recusa do
trigger. Participações ainda não existem: a preservação dos credenciamentos é estrutural (nenhuma
operação toca outras tabelas) e deve ser provada na MAR-67. Uma migração nova; nenhuma dependência nova.

Validação local da MAR-59 em 08/11/2026: lint, tipos/build e 58 testes de integração aprovados,
incluindo seis novos: edição do próprio nome por atleta aprovado, técnico rejeitado, atleta pendente
e presidente, com domínio e identidade iguais e aprovação, verificação, vínculo, carteirinha e e-mail
preservados (o rejeitado depois solicita nova análise); recusa de nome inválido e de campos
administrativos, e-mail e senha sem alterar nada; acesso indevido (sem sessão, sem origem, outra conta,
conta desativada e rotas nativas `update-user`, `change-email`, `change-password`); rollback por falha
na transação e por identidade ausente; edições simultâneas; e contrato OpenAPI. Sem migração nem
dependência nova.

Validação local da MAR-61 em 08/11/2026: lint, tipos/build e 65 testes de integração aprovados,
incluindo sete novos: criação, listagem e consulta com campos mínimos, datas opcionais que não mudam
o status e recusa de corpo forjado/período invertido; inscrição única, clube/campeonato inexistentes,
retirada com e sem jogos e inscrição de outro campeonato; ciclo com pré-condições, repetição com
`alterado: false` e estados finais; cancelamento dos agendados preservando finalizados; restrições SQL
diretas (clubes distintos e do próprio campeonato, horários por status, inscrição duplicada/imutável,
transições e inscrições fora de planejado, campeonato terminado sem jogos ativos); concorrência de
inscrições, inícios, encerrar × cancelar, iniciar × retirar e criar jogo × encerrar; acesso indevido
e contrato OpenAPI. Jogos entram por fixtures diretas no banco até a MAR-62. Uma migração nova;
nenhuma dependência nova.

Validação local da MAR-62 em 08/11/2026: lint, tipos/build e 72 testes de integração aprovados,
incluindo sete novos: agendamento com hora local e fuso IANA (dia local diferente do UTC), sem iniciar
o jogo; recusa de corpo forjado, clubes iguais, offset/fuso desconhecido, data inexistente e horário
pulado/repetido no horário de verão; clube de outro campeonato ou não inscrito e campeonato cancelado;
designação de externos e de atleta/técnico, com recusa de conta duplicada, de clube do jogo, presidente,
pendente, desativada ou inexistente; retirada e jogo finalizado/cancelado; restrições SQL diretas
(fuso, clubes/autoria imutáveis, identificação e designação); concorrência de designações iguais,
agendar × cancelar campeonato e designar × cancelar; acesso indevido e contrato OpenAPI. Os testes
do ciclo do campeonato passaram a agendar jogos pela API; início/encerramento seguem por fixture até a
MAR-69. Uma migração nova; nenhuma dependência nova.

Validação local da MAR-63 em 08/11/2026: lint, tipos/build e 81 testes de integração aprovados,
incluindo oito novos: transferência sem sobreposição nem lacuna, com vínculo original preservado,
sessão do atleta no novo clube, repetição sem efeito, origem desatualizada e retorno ao primeiro clube;
recusa de pendente/rejeitado e transferência de conta desativada; bloqueio por campeonato em andamento
do clube atual (planejado e destino em andamento não bloqueiam; encerrado/cancelado liberam); restrições
SQL diretas (vínculo encerrado e identificação imutáveis, lacuna, falta de presidente, mesmo clube,
pendente e campeonato em andamento); rollback após encerrar o vínculo; concorrência de transferências
do mesmo atleta e de transferência × início do campeonato, em ambas as ordens; acesso indevido e
contrato OpenAPI. O teste de autorização que simulava transferência passou a usar vínculo sem lacuna.
Uma migração nova; nenhuma dependência nova.

Validação local da MAR-64 em 08/11/2026: lint, tipos/build e 90 testes de integração aprovados,
incluindo nove novos: recusa de atleta com conta desativada ou carteirinha invalidada (inclusive pelo
banco e com desativação/invalidação concorrentes), escolha anterior preservada e retirável, e escolha
liberada após reativação; escalação pelo técnico do próprio clube sem credenciamento, camisa nem entrada,
repetição sem efeito, retirada com histórico e recusa de atleta de outro clube, pendente, rejeitado ou
inexistente; técnico substituído sem acesso imediato, novo técnico vendo e alterando a lista com a autoria
anterior preservada, técnico desativado ou desvinculado e presidente sem escalação; início do jogo
concorrente com a alteração, nas duas ordens, e jogo iniciado/cancelado; transferência com a escolha
antiga marcada como vínculo encerrado, recusada no credenciamento pelo banco e aceita pelo vínculo atual,
retirada pelo clube anterior e credenciamento preservado quando só a escolha sai; transferência concorrente
com a escolha, nas duas ordens; inclusões e retiradas simultâneas sem duplicar participação ou histórico;
restrições SQL diretas (clube fora do jogo, vínculo/atleta/técnico divergentes, etapas, camisa única por
clube, credenciamento único por atleta, identificação e histórico imutáveis); acesso indevido e contrato
OpenAPI. Uma migração nova; nenhuma dependência nova.

Validação local da MAR-65 em 08/11/2026: lint, tipos/build e 100 testes de integração aprovados,
incluindo dez novos: entrada por designação com cookie próprio por jogo (atributos, sem sobrescrever o da
conta, token só como hash), vários dispositivos, linha/banco e saída; recusa sem conta, sem designação, de
presidente, sem origem e com vínculo impeditivo surgido depois; dia no fuso do local (Kiritimati × Pago
Pago), dia vencido sem início, continuação após a virada com jogo iniciado, jogo sem data e futuro; senha
gerada na primeira consulta, consultada por presidente e designado, recusada a outra conta e à sessão por
senha, armazenada só como hash e cópia AES-GCM ligada ao jogo (adulteração e outro jogo falham), entrada
com nome sem conferir vínculo e normalização; troca revogando só as sessões por senha; retirada da
designação, logout e desativação invalidando a entrada designada (senha independe da conta); limite de
tentativas e origem; encerramento e cancelamento do campeonato revogando tudo, reenvio do encerramento
reconhecido sem devolver permissão, revogação definitiva no banco; troca, desativação e retirada aguardando
a autorização em curso; emissões e trocas simultâneas. Uma migração nova; nenhuma dependência nova.
Não validado: Socket.IO (MAR-73), início/encerramento/adiamento reais (MAR-69) e cookies `__Host-` atrás
do proxy hospedado.

Validação local da MAR-66 em 08/11/2026: lint, tipos/build e 107 testes de integração aprovados,
incluindo sete novos: aplicação com responsável, data e motivo, validações (quantidade, motivo, campos
extras), atleta pendente, inexistente ou técnico, conta desativada e clube não inscrito aceitos, acesso
indevido; aplicações simultâneas coexistindo e cumpridas em paralelo, encerramento repetido e simultâneo
sem duplicar e saldo nunca negativo (inclusive inserção direta recusada pelo banco); jogo credenciado antes
da aplicação preservado, jogo em andamento sem credenciamento contando e jogo encerrado antes não contando;
outro campeonato e outro clube sem efeito; revogação simultânea, definitiva e preservando cumprimentos,
recusada para cumprida; encerrar e cancelar o campeonato encerrando só o saldo das vigentes, sem
transportar; escalação sinalizando a suspensão sem impedir a escolha; dados da aplicação, exclusão e
cumprimentos imutáveis no banco. Uma migração nova; nenhuma dependência nova. Não validado: chamada real
no encerramento do jogo (MAR-69) e bloqueio no credenciamento (MAR-67), que usarão as funções exportadas.

Após revisão da MAR-66: lint, tipos/build e **109 testes de integração aprovados**. Dois testes novos
reproduziram as falhas antes da correção e passaram depois: revogação aguardando o último cumprimento
retorna 409 e mantém a suspensão cumprida; aplicação de 101 jogos é aceita pela API e pelo banco.
Revogação consulta o saldo depois de obter o bloqueio. A migração adicional remove o teto de 100 jogos
sem modificar a migração já aplicada; permanece o intervalo técnico do `INTEGER` do PostgreSQL.

Validação local da MAR-67 em 08/11/2026: lint, tipos/build e **115 testes de integração aprovados**,
incluindo seis novos: credenciamento manual de escalado e não escalado, camisa única no clube (repetida em
outro clube aceita), repetição sem efeito e outra camisa recusada; mesmas regras no manual e no QR (pendente,
clube fora do jogo, conta desativada, carteirinha invalidada, suspensão) e recusa direta no banco; QR
repetido, substituído e sem sessão (QR não autoriza); atrasado credenciado com o jogo em andamento, entrada
única só depois do início, suspensão e invalidação posteriores preservando o credenciamento; concorrência
(camisa disputada, mesmo QR em paralelo, suspensão, invalidação, transferência, desativação e substituição de
QR em curso); acessos cruzados (cookie de outro jogo, saída, designado que vira técnico de um clube, jogo de
amanhã, sem origem). Uma migração nova; nenhuma dependência nova. Não validado: início real do jogo (MAR-69,
os testes alteram o status no banco), correção/estorno (MAR-71) e notificação Socket.IO (MAR-73).

Validação local da MAR-68 em 08/11/2026: lint, tipos/build e **121 testes de integração aprovados**,
incluindo seis novos: gol do atleta credenciado somado ao clube da participação, penalidades só no desempenho,
placar ausente antes do início e 0 a 0 ao iniciar; recusa de atleta escalado sem credenciamento, participação de
outro jogo, tipo fora da lista `temp_`, valor ou clube no corpo; recusa direta no banco (alteração, exclusão,
valor zero, sem participação, jogo agendado); clube derivado mantido após transferência; reenvio da mesma operação
sem duplicar, mesma operação em paralelo gravada uma vez e `operacaoId` com outro conteúdo recusado sem sobrescrever;
24 lançamentos paralelos de dois dispositivos preservados, com placar igual à soma do desempenho; rollback sem
totais parciais; acesso sem sessão ou com sessão de outro jogo negado e encerramento concorrente impedindo a
gravação. Uma migração nova; nenhuma dependência nova. Não validado: início/encerramento reais (MAR-69, os testes
alteram o status no banco), correção/anulação (MAR-70) e notificação Socket.IO (MAR-73).

Validação local da MAR-69 em 08/11/2026: lint, tipos/build e **130 testes de integração aprovados**, incluindo oito
novos: início único com pedidos simultâneos e reenvio (`alterado: false`); encerramento por dois árbitros ao mesmo
tempo com placar, cumprimento único da suspensão e revogação de todas as sessões, reenvio reconhecido sem liberar
lançamento, credenciamento, sessão ou nova entrada; lançamento e credenciamento aguardando o encerramento recusados;
rollback do encerramento sem efeitos; adiamento com nova senha, revogação dos dois métodos, nova data, jogo sem data,
jogo sem senha emitida e credenciamentos preservados; credenciamento concorrente com o adiamento recusado;
cancelamento idempotente sem cumprimento; campeonato cancelado com sessões abertas e início concorrente recusado;
transições recusadas no banco. Uma migração nova; nenhuma dependência nova. Não validado: W.O./interrupção (MAR-72)
e notificação Socket.IO (MAR-73).

Validação local da MAR-70 em 09/11/2026: lint, tipos/build, schema Prisma sem diferença para o banco migrado e
**136 testes de integração aprovados**, incluindo seis novos: correção de atleta e de tipo, cadeia de correções e
anulação com histórico preservado e projeções sem os anulados; regras repetidas no banco (anulação única, sem
alteração de dados, sem exclusão, substituto só de lançamento anulado pela mesma operação); cinco correções e
anulações simultâneas do mesmo lançamento com uma vencedora e conflitos com o registro atualizado; a mesma correção
e a mesma anulação em paralelo gravadas uma vez; reenvio e reuso de `operacaoId`; rollback da correção e da anulação;
correção e anulação pelo presidente somente após o encerramento, sem reabrir sessões nem repetir o cumprimento.
Uma migração nova; nenhuma dependência nova. Não validado: notificação Socket.IO (MAR-73) e vencedor (MAR-72).

Validação local da MAR-71 em 09/11/2026: lint, tipos/build, schema Prisma sem diferença para o banco migrado e
**144 testes de integração aprovados**, incluindo sete novos: correção de camisa antes e durante o jogo e após a
entrada, com camisa única no clube (aceita em outro clube), reenvio sem efeito, camisa atual divergente recusada com o
registro atual e histórico; estorno com e sem escolha do técnico, reenvio, novo credenciamento e camisa liberada;
estorno recusado após entrada e após lançamento, inclusive anulado; regras repetidas no banco (alteração sem
histórico, cópia divergente, data retroativa, histórico imutável, estorno com lançamento); camisa disputada, correção
contra estorno e a mesma correção em paralelo; lançamento e entrada contra estorno nos dois sentidos e entrada após
correção, com espera real no bloqueio; encerramento aguardando a correção e, depois, correção somente pelo presidente.
Uma migração nova; nenhuma dependência nova. Não validado: notificação Socket.IO (MAR-73) e correções complexas do
presidente (PEN-019 residual).

Validação local da MAR-72 em 09/11/2026: lint, tipos/build, schema Prisma sem diferença para o banco migrado e
**149 testes de integração aprovados**, incluindo cinco novos: interrupção e retomada do mesmo jogo com repetição sem
efeito, lançamento e entrada recusados durante a pausa (também no banco), credenciamento permitido e encerramento
definitivo durante a interrupção cumprindo a suspensão uma vez; interrupção concorrente com lançamento, que aguarda e
é recusado; W.O. sem início com 0 a 0, vencedor, reenvio e cumprimento único, W.O. recusado em jogo iniciado e
restrições do banco; abandono sem vencedor preservando placar e desempenho; correção do resultado e invalidação
somente pelo presidente após o encerramento, com conflito pelo `atual` divergente, repetição sem efeito, histórico,
invalidação definitiva, placar e cumprimentos preservados e W.O. mudando só o vencedor. Testes existentes passaram a
informar resultado e vencedor no encerramento. Uma migração nova; nenhuma dependência nova. Não validado: notificação
Socket.IO (MAR-73) e retomada em outro dia com sessão expirada (coberta pela regra de acesso de jogo iniciado).

Validação local da MAR-73 em 09/11/2026: lint, tipos/build, schema Prisma sem diferença para o banco migrado,
`npm audit --omit=dev` sem alertas e **157 testes de integração aprovados**, incluindo sete novos com dois clientes
Socket.IO automatizados (sem frontend): handshake recusado sem cookie, com cookie de conta ou de outro jogo, `jogoId`
inválido e outra origem; aviso mínimo com o mesmo `id` nos dois dispositivos após o commit, rollback e operação
recusada sem evento, repetição sem evento novo e eventos marcados como publicados; troca de senha retirando só as
sessões por senha; doze lançamentos concorrentes com a troca, sem evento após o aviso e sem perda para quem continua;
retirada da designação, logout e desativação da conta de origem; adiamento, cancelamento e encerramento com o motivo
da sessão; reconexão com estado recuperado por REST, reprocessamento de evento pendente sem NOTIFY (mesmo `id`) e
revogação sem NOTIFY (transferência para clube do jogo) retirada pela varredura. Uma migração nova; dependências
novas `socket.io` e `pg` (e `socket.io-client`/`@types/pg` de desenvolvimento). Não validado: Socket.IO pelo
encaminhamento Vercel/Render e cookies `__Host-` hospedados (MAR-76) e mais de uma instância (fora do escopo).

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
4. **Chegada e credenciamento:** no dia marcado, antes da partida, os árbitros acessam a página temporária,
   sem liberação manual adicional; se o jogo começou, o acesso continua após meia-noite até encerrar.
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
   naquele campeonato. Os critérios automáticos foram aprovados na MAR-78
   ([requisitos, seção 12](docs/requisitos.md#12-critérios-de-suspensão-automática--mar-78--09112026));
   implementação e validação seguem na MAR-79.

As decisões posteriores sobre exceções, fotos, fuso local, consulta da senha e ciclo de contas/
competições estão em [requisitos, seção 11](docs/requisitos.md#11-esclarecimentos-para-o-planejamento-do-backend--07112026).
São decisões para desenvolvimento, ainda sem implementação dos respectivos fluxos.

As métricas ainda provisórias usam o prefixo `temp_`. As exceções e decisões em aberto
estão detalhadas nas [pendências](docs/pendencias.md).

## Fora do escopo inicial

- Equipes como entidade separada, carteirinha de técnico e múltiplas categorias por campeonato.
- Validação específica de categoria por idade/sexo, controle de substituições e tempo jogado.
- Auditoria completa, cujo detalhamento ficou para uma próxima etapa.
- Doações, patrocínios, divulgação pública de resultados e exportações, sem escopo confirmado.

## Fluxo de desenvolvimento por tarefa

Marcus seleciona uma tarefa do Linear com dependências concluídas e critérios de aceite definidos.
O agente implementador cria branch separada `feat/<identificador>-<descricao>`, implementa,
valida, atualiza a documentação afetada, commita nessa branch e abre PR vinculada à tarefa.
A seleção da tarefa autoriza commits e abertura de PR dentro desse escopo.

Outro agente revisa o diff contra os critérios e as regras do repositório, corrige na mesma
branch, executa as validações afetadas e faz merge após os checks passarem e os impedimentos
serem resolvidos. Não marcar a tarefa como concluída antes do merge.
Fluxo no Linear: Backlog → Todo (selecionada) → In Progress → In Review → Done (merge).

Pendência de produto não pode ser decidida pelo agente: registrar o bloqueio e esclarecer
com Marcus. Tarefas de backend priorizam testes no backend; frontend exige escopo confirmado.
