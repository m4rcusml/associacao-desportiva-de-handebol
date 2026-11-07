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
