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
`BETTER_AUTH_SECRET` (mínimo 32 caracteres):

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
| `PORT` | Porta da API, padrão 3001. |
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
Designar não abre acesso: senha e sessões vêm na MAR-65; adiamento, início e cancelamento do jogo, na MAR-69.

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
   naquele campeonato; punições automáticas dependem de critérios a confirmar com o cliente.

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
