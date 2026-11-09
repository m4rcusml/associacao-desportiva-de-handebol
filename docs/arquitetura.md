# Arquitetura da aplicação

Decisões acordadas com Marcus em 06/11/2026 e atualizadas em 07/11/2026 pela resolução da
PEN-030 e pelas definições posteriores de desenvolvimento, infraestrutura e arbitragem.
Este documento descreve a direção aprovada. Persistência e cadastro/autenticação mínimos estão
implementados e validados localmente; os demais fluxos de domínio e a infraestrutura online não.

Referências: [requisitos](requisitos.md), [modelagem](modelo-banco-dados.md) e
[pendências](pendencias.md).

## Estrutura e tecnologias aprovadas

- Mesmo repositório, com frontend em `client/` e backend em `server/`.
- Código em `client/src/` e `server/src/`; configurações ficam na raiz de cada projeto.
- Aplicações com builds e implantações independentes.
- TypeScript nas duas aplicações; não utilizar outras linguagens para implementar a aplicação.
- Frontend: Next.js.
- Backend: NestJS com Express, organizado como monólito modular.
- Banco relacional: PostgreSQL, com Prisma para acesso e migrações.
- SQL complementar quando necessário para restrições que o esquema do ORM não represente.
- REST para consultas e operações; OpenAPI documenta o contrato.
- Socket.IO para notificar mudanças imediatamente aos dispositivos autorizados do jogo.

As telas não decidem permissões nem acessam o banco. A lógica de negócio fica no backend.
Renderização no servidor pelo Next.js, quando utilizada, consome a API do NestJS;
não cria uma segunda implementação das regras no frontend.

## Organização planejada

```text
client/
  src/
    app/                 # Rotas e layouts do Next.js
    features/            # Funcionalidades da interface
    components/          # Elementos visuais compartilhados
    lib/                 # Integração HTTP e tempo real
  public/
server/
  src/
    modules/
      autenticacao/
      usuarios/
      clubes/
      competicoes/
      participacoes/     # Escalação (MAR-64) e credenciamento/entrada em quadra (MAR-67)
      arbitragem/        # Acesso temporário e senha do jogo (MAR-65)
      suspensoes/        # Suspensões manuais e cumprimento (MAR-66)
      resultados/        # Lançamentos de gols e penalidades (MAR-68)
      disciplina/
    infrastructure/      # Banco, e-mail e armazenamento
  prisma/                # Esquema e migrações
  test/
docs/
```

Os nomes internos de pastas são uma proposta de organização.
As regras de cada módulo são acessadas por operações de negócio como aprovar atleta,
credenciar atleta e registrar gol; entradas HTTP e tempo real não duplicam essas regras.
A organização interna deve ser detalhada ao iniciar cada módulo.

## Acesso público e comunicação

Um domínio público atende a interface em `/`, encaminha `/api` ao backend e reserva
um caminho próprio para Socket.IO, ainda a definir. O encaminhamento é feito pela infraestrutura;
não torna as duas aplicações uma implantação única.

O cliente envia operações pela API REST. O backend autoriza, valida e persiste em transação;
somente depois da confirmação notifica os dispositivos autorizados do jogo.
O frontend consulta o estado oficial ao reconectar para recuperar mudanças não recebidas.
Identificadores de operação impedem que reenvios produzam lançamentos duplicados.

O banco é a fonte dos registros. Receber uma notificação não substitui a confirmação de gravação.
O mecanismo de publicação confiável após a transação e de tratamento de conflitos ainda será
detalhado antes de implementar resultados em tempo real.

## Autenticação e sessões

- Better Auth para contas permanentes, com adaptador Prisma e persistência no PostgreSQL.
- Login inicial por e-mail e senha.
- Não exigir confirmação de e-mail, inclusive antes da solicitação de aprovação esportiva.
- Recuperação de senha por link, com validade e uso único, permanece prevista, mas sua
  implementação, prova e escolha do serviço de e-mail estão adiadas nesta etapa.
- Sessões revogáveis no servidor, identificadas por cookies seguros.
- Permitir múltiplos dispositivos por conta ou acesso de arbitragem.
- Manter aprovação esportiva e permissões dos perfis sob responsabilidade da aplicação.
- Manter `session.cookieCache` desligado e consultar a sessão persistida nas operações protegidas.
- Revogar as sessões da conta após recuperação de senha (`revokeSessionsOnPasswordReset`).

A arbitragem usa `SessaoArbitragem`, própria da aplicação e limitada ao jogo, incluindo quem
entra por senha compartilhada sem criar conta permanente. O cookie temporário é separado do
cookie da conta. Entrada por designação depende também da sessão de conta que a originou.
O acesso usa o dia marcado no fuso do local do jogo, sem liberação manual adicional;
se o jogo já começou, continua após meia-noite até encerramento. Sem início até meia-noite,
exige reagendamento. Conversão no frontend não interfere na autorização. Encerramento,
cancelamento ou adiamento invalidam todos os acessos temporários abertos para o jogo,
inclusive conexões já abertas. Somente o presidente adia ou cancela. A senha inicial é automática;
adiar gera uma nova. Troca manual exige presidente ou conta autenticada e designada para o jogo;
entrar apenas por nome e senha não concede essa permissão. Presidente e contas autenticadas
e designadas também podem consultar a senha posteriormente. Manter hash apropriado para
validação e cópia cifrada com criptografia autenticada no backend, usando chave em segredo
externo ao banco/repositório; nunca expor em logs, URLs ou eventos Socket.IO. Consulta é
autorizada em cada requisição e não pode ser armazenada em cache.
Trocar a senha invalida todas as sessões por senha, preservando as por designação;
não há retirada individual de acesso por senha.
Revalidar autorização junto da transação de escrita, com controle de concorrência com o
encerramento; somente um guard anterior à transação não basta. As notificações Socket.IO
também exigem destinatários ainda autorizados; validar só o handshake é insuficiente.
As exceções de vínculo para acesso por senha seguem os requisitos existentes (RN-025).

As [tabelas técnicas](modelo-banco-dados.md#complemento-técnico-de-autenticação--pen-030)
complementam o domínio. `Usuario.authId` permanece único e sem FK; não exige provedor externo.
O cadastro deve impedir identidades parcialmente criadas de obter permissões e tratar falhas e
repetições. Um hook após criação não comprova atomicidade entre biblioteca e domínio.

Integração implementada: handler oficial Node/Express no NestJS e guard de domínio,
sem a ponte comunitária `@thallesp/nestjs-better-auth`. A montagem precede o parser do
corpo nas rotas da biblioteca; as demais rotas mantêm validação normal. ESM, rotas, OpenAPI,
cookies e origem/CSRF foram testados localmente. O Next.js apenas consome a API; repasse
de cookies no SSR será validado se essa renderização for introduzida para dados autenticados.

A integração local de contas permanentes foi validada em 07/11/2026. O esquema técnico foi
revisado contra o esquema oficial e o código de cadastro da versão fixada; migrações Prisma
criadas e aplicadas. O cadastro da aplicação grava `AuthUser`, `AuthAccount` (provider `credential`,
accountId igual ao userId, hash da função pública `better-auth/crypto`), `Usuario`, extensão e
vínculo inicial em uma única transação Prisma. O login/sessão/logout ficam com Better Auth.
Cadastro nativo está desabilitado e só três rotas técnicas estão expostas: login, consulta e logout.
Edição técnica independente do domínio, recuperação e criação pública de presidente estão bloqueadas.
Presidentes (MAR-55): o inicial é criado pelo procedimento restrito `npm run presidente:inicial`
(transação única, advisory lock, recusado se já houver presidente ativo com credencial); os demais,
por presidente ativo em `POST /api/presidentes`, com revalidação do criador na transação. Ambos
usam a mesma criação de identidade/credencial do cadastro público (`autenticacao/identidade.ts`).

`PrismaService` é singleton do contêiner Nest; o mesmo cliente é usado pelo adaptador e pelo cadastro.
Hooks posteriores não são usados para garantir atomicidade. Falha de FK e falha no commit foram
injetadas em teste; a identidade e o domínio não persistem. E-mail único normalizado resolve
repetições concorrentes com 201/409; uma resposta perdida após commit é recuperável pelo login.
Campos mínimos provisórios: nome completo, e-mail, senha e perfil; atleta escolhe clube existente,
técnico começa sem clube. A solicitação é registrada e o status inicial é pendente.

O handler oficial precede os parsers, com allowlist de rotas/métodos. POST exige origem exata
do cliente, CORS permite credenciais somente dessa origem e a proteção nativa não foi desativada.
Cookies host-only, HttpOnly/Lax; Secure e prefixo seguro em produção com URLs HTTPS obrigatórias.
Sessões têm duração absoluta de sete dias, sem refresh automático; `cookieCache` está desligado.
Guard e `/api/sessao` compartilham a consulta de sessão persistida e cadastro ativo. A rota de
demonstração exige autenticação, sem conceder aprovação ou permissões esportivas.
Login de cadastro inativo ou sem `Usuario` é recusado com 401, sem gravar sessão (hook de criação
de sessão do Better Auth). Violações de CHECK, EXCLUDE e triggers diferidos no cadastro respondem 409.

Limite de tentativas: `/api/cadastros` usa `@nestjs/throttler`, com 5 requisições por IP a cada
15 minutos, contadores em memória e resposta 429; a guarda vale só nessa rota. O sign-in usa o
limite do Better Auth (3 a cada 10 s por IP, em memória), habilitado explicitamente em todos os
ambientes. Memória atende uma instância e zera a cada reinício; várias réplicas exigirão
armazenamento compartilhado. O 409 de e-mail repetido permanece e revela contas existentes;
reavaliar junto com a UX final e a confirmação por e-mail. **Pendente na implantação:** atrás do
encaminhamento Vercel/Render, o throttler vê o IP do proxy enquanto `trust proxy` não for
configurado no Express (um único contador para todos), e o Better Auth lê `X-Forwarded-For`, que o
cliente pode forjar sem proxy confiável e que, ausente em produção, gera um contador compartilhado.
Configurar `trust proxy` e `advanced.ipAddress` conforme os proxies reais antes da implantação de teste.

Client usa fetch com cookies e sem cache; as páginas são cascas estáticas, sem SSR de sessão.
Ao introduzir SSR autenticado, repassar cookies e provar isolamento/cache antes de utilizá-lo.
O contrato mínimo é servido em `/api/openapi.json`, com schema de cadastro derivado da validação.

Autorização de domínio (MAR-54): `SessionGuard` resolve o ator (`carregarAtor`) a partir da sessão
persistida — conta ativa, perfil, status de verificação e clube atual (vínculo aberto do atleta ou
clube do técnico) — e o anexa à requisição (`@AtorAtual()`). Requisitos são declarados por
`@Requer({ perfis, aprovado })`/`@RequerAprovado()`, sem regras nos controllers. Presidente é
considerado aprovado; atleta/técnico pendente ou rejeitado autentica (401 só sem sessão, inativo
ou sem domínio), mas recebe 403 em operações esportivas. Acesso a clube (`exigirAcessoClube`):
presidente acessa qualquer clube; atleta/técnico aprovado, somente o próprio, obtido do cadastro e
nunca da entrada. Escritas sensíveis chamam `AutorizacaoService.revalidar`/`revalidarClube` dentro
da transação, que relê o ator com `FOR SHARE` na linha `Usuario`. Convenção: operações que alterem
ativação, aprovação ou clube de uma conta bloqueiam essa linha com `FOR UPDATE`. As rotas
`/api/protegida/{aprovado,presidente,clubes/:clubeId}` só demonstram e testam essas regras.

Ativação de contas (MAR-60): `POST /api/contas/:usuarioId/desativacao` e `/reativacao`, somente
presidente ativo e somente para outras contas. A transação obtém um advisory lock próprio
(serializa ativações e evita deadlock quando dois presidentes desativam um ao outro), revalida o
presidente, bloqueia a conta alvo com `FOR UPDATE`, altera `Usuario.ativo`, incrementa
`Usuario.versaoAtivacao` e apaga as `AuthSession` da conta alvo. O hook de sessão do Better Auth grava
a versão lida em `AuthSession.versaoAtivacao`; o trigger da migração `sessao_conta_ativa` recusa a
inserção se a conta estiver inativa ou a versão tiver mudado (login concorrente). Nesse caso raro o
login responde erro interno (500) sem emitir sessão. Desativar o último presidente ativo com credencial responde 409; presidente sem
credencial (fictício do seed) não conta. Reativar também apaga sessões: a pessoa entra novamente.
Repetição responde 200 com `alterado: false`. Nada é excluído. `contaAtiva(tx, usuarioId)`
(`modules/contas/contas.ts`) é a checagem que a arbitragem por designação deve reutilizar dentro
da transação (`FOR SHARE`); a entrada por senha compartilhada não a utiliza (RN-025).
Clubes (MAR-56): `modules/clubes` expõe as escritas do presidente, revalidado na transação, e
leituras (`visao-geral` e consulta por clube) para qualquer conta autenticada e ativa; o campo
`ativo` do técnico só é incluído para o presidente.
Atribuição e desvinculação bloqueiam a linha `Clube` (`FOR UPDATE`) e depois as linhas `Usuario`
dos técnicos envolvidos, em ordem fixa, seguindo a convenção acima. Substituir exige informar o
técnico atual, de modo que operações simultâneas na mesma vaga não se sobrescrevem: a segunda recebe 409.
A unicidade de `Tecnico.clubeId` e o CHECK de técnico aprovado garantem as regras também no banco.
Carteirinhas (MAR-58): `modules/carteirinhas` expõe a consulta própria do atleta e as operações do
presidente, revalidado na transação. O token do QR só trafega no corpo (`POST /carteirinhas/leitura`),
nunca na URL, e não é aceito como sessão. Substituir exige informar `versaoQr`, a versão que deve
deixar de valer: reenvio ou pedido simultâneo da mesma versão devolve o QR já substituído (`alterado: false`).
Campeonatos (MAR-61): `modules/campeonatos` expõe criação, consulta, inscrições e ciclo somente ao
presidente, revalidado na transação. Cada operação bloqueia a linha `Campeonato` (`FOR UPDATE`);
os triggers de inscrição e jogo bloqueiam a mesma linha com `FOR SHARE`, de modo que transições,
inscrições e jogos concorrentes se serializam e o trigger do campeonato confere as pré-condições
com as alterações confirmadas. Repetir uma transição devolve `alterado: false`. Na mesma transação,
cancelar revoga a arbitragem dos jogos cancelados (MAR-65) e encerrar/cancelar encerra o saldo das
suspensões vigentes depois de gravar o status (MAR-66); notificações (MAR-73) continuam pendentes.
Jogos (MAR-62): `modules/jogos` agenda jogos e designa a arbitragem, somente ao presidente. A hora
local é convertida em instante por `Intl` no fuso IANA do jogo (`fuso.ts`), conferido também em
`pg_timezone_names`; o fuso do navegador não participa. Agendar bloqueia a linha `Campeonato`
(`FOR UPDATE`), serializando com as transições. Designar bloqueia o jogo (`FOR SHARE`) e a linha
`Usuario` da conta (`FOR SHARE`), de modo que aprovação, desativação, atribuição de técnico e futura
transferência (`FOR UPDATE`) são vistas de forma consistente. `clubeImpeditivo` fica exportado para a
revalidação no acesso por designação (MAR-65).
Transferências (MAR-63): `modules/atletas` expõe ao presidente o histórico de vínculos e a
transferência. A transação revalida o presidente, lê o clube atual, bloqueia com `FOR SHARE` os
campeonatos planejados/em andamento desse clube e depois a linha `Usuario` do atleta (`FOR UPDATE`),
na mesma ordem campeonato → conta dos fluxos de jogos. Relido o vínculo, recusa atleta não aprovado,
`clubeAtualId` divergente e campeonato em andamento; então encerra o vínculo e abre o seguinte com o
mesmo `now()` da transação. O trigger do banco repete a verificação do campeonato. Repetir a mesma
transferência devolve `alterado: false`; transferências simultâneas para destinos diferentes resultam
em uma concluída e outra com 409.
Escalação (MAR-64): `modules/participacoes` expõe a consulta (técnico do clube do jogo e presidente) e a
inclusão/retirada pelo técnico aprovado atual. A transação revalida o técnico (`FOR SHARE` da conta:
substituição, desvinculação e desativação aguardam ou são vistas), bloqueia o jogo (`FOR SHARE`: o início,
que altera a linha, aguarda ou é visto), a conta do atleta (`FOR SHARE`: transferência, aprovação e
desativação aguardam ou são vistas) e a carteirinha (`FOR SHARE`: invalidação aguarda ou é vista), na ordem
técnico → jogo → atleta → carteirinha, sem ciclo com campeonato → atleta das transferências. A inclusão usa `INSERT ... ON CONFLICT DO NOTHING` e a retirada escritas condicionais:
pedidos repetidos em paralelo terminam com `alterado: false`, sem 409 nem histórico duplicado. O trigger
repete as regras no banco.
Arbitragem (MAR-65): `modules/arbitragem` implementa a entrada por designação (rota com `SessionGuard`, que
passa a anexar também o id da `AuthSession`) e por nome/senha (`ThrottlerGuard`, limite `arbitragem` de 10 por
IP a cada 10 minutos, em memória como o do cadastro). O token opaco de 32 bytes vai no cookie
`handebol.arbitragem.{jogoId}` (`__Host-` e Secure em produção; HttpOnly, Lax, `Path=/`), um por jogo, sem
tocar no cookie da conta; o banco guarda o SHA-256. A senha é gerada no servidor (10 caracteres sem ambíguos),
verificada por scrypt (`better-auth/crypto`) e guardada também cifrada com AES-256-GCM, chave
`ARBITRAGEM_SENHA_CHAVE` (32 bytes hex, obrigatória na inicialização) e o `jogoId` como dado autenticado.
A senha só aparece na resposta da consulta/troca; `Cache-Control: no-store` vale para toda a API.
O dia do jogo é comparado no banco: `now()` e `inicioPrevistoEm` convertidos ao `fusoHorario` do jogo.
`revalidarArbitragem(tx, jogoId, token)` é a autorização para as escritas esportivas: bloqueia, nesta
ordem, jogo (`FOR SHARE`) → arbitragem (`FOR KEY SHARE`) → sessão temporária → conta designada → sessão de
conta de origem (as três últimas em `FOR SHARE`), e confere
revogação, expiração, status/dia, conta ativa e aprovada, impedimento de clube e sessão de origem. Troca de
senha (acesso `FOR UPDATE`, depois sessões), retirada da designação (exclusão em cascata), desativação
(conta `FOR UPDATE`) e logout aguardam a transação autorizada ou são vistos por ela, sem ciclo de bloqueios.
`revalidarArbitragemOuEncerramento` reconhece o reenvio de quem teve a sessão revogada pelo próprio
encerramento (`jogo_encerrado`) sem autorizar outra operação. `encerrarAcessoArbitragem` (encerramento e
cancelamento) e `renovarSenha` (troca e adiamento) ficam prontos para a MAR-69; o cancelamento do campeonato
já revoga, na mesma transação, os acessos dos jogos que cancela.
Conta própria (MAR-59): `PATCH /api/conta` altera somente o nome da conta da sessão. A transação
bloqueia a linha `Usuario` com `FOR UPDATE`, recusa conta já desativada (401) e grava
`Usuario.nomeCompleto` e `AuthUser.name` juntos; falha em qualquer gravação desfaz as duas. As rotas
nativas do Better Auth (`update-user`, `change-email`, `change-password`) seguem fora da lista
permitida em `app.ts`; e-mail e senha só mudarão com contrato aprovado.
Suspensões (MAR-66): `modules/suspensoes` expõe ao presidente aplicação, consulta e revogação. O saldo não
é armazenado: é `quantidadeJogos` menos os registros de `CumprimentoSuspensao`. Aplicar bloqueia o
campeonato (`FOR SHARE`: encerramento concorrente aguarda) e a conta do atleta (`FOR UPDATE`), e só então
lê `aplicadaEm`; revogar bloqueia a suspensão (`FOR UPDATE`) e consulta o saldo em uma instrução posterior,
para enxergar cumprimentos confirmados durante a espera pelo bloqueio. `registrarCumprimentos(tx, jogoId)` é o ponto
de integração do encerramento do jogo (MAR-69/MAR-72): na mesma transação, bloqueia o jogo (`FOR SHARE`),
as contas de todos os atletas com vínculo nos dois clubes (`FOR SHARE`, por id) e as suspensões vigentes do
campeonato (`FOR UPDATE`, por id), e insere com `ON CONFLICT DO NOTHING`, o que o torna idempotente mesmo em
paralelo. `atletasComSuspensaoVigente` é a consulta de impedimento: o credenciamento (MAR-67) deve chamá-la
depois de bloquear a conta do atleta (`FOR SHARE`), para ver aplicações concorrentes. Ordem geral:
campeonato → jogo → conta → suspensão, sem ciclo com escalação e transferências. Triggers repetem no banco
as regras de aplicação, término do saldo e cumprimento.
Credenciamento (MAR-67): `participacoes/credenciamento.ts` expõe à sessão temporária da arbitragem a lista de
atletas do jogo, a leitura do QR, o credenciamento (manual ou QR) e a entrada em quadra. Cada operação chama
`revalidarArbitragem` na própria transação e depois bloqueia a conta do atleta (`FOR SHARE`: desativação,
transferência e aplicação de suspensão aguardam ou são vistas) e a carteirinha (`FOR SHARE`: invalidação e
substituição do QR aguardam ou são vistas; o QR é conferido de novo com o bloqueio), na ordem jogo →
arbitragem → sessão → conta → carteirinha → vínculo, a mesma da escalação. A elegibilidade usa
`atletasComSuspensaoVigente`. A gravação é condicional (`UPDATE ... WHERE credenciadoEm IS NULL` ou
`INSERT ... ON CONFLICT DO NOTHING`): o mesmo atleta em paralelo termina com `alterado: false`, e a camisa
disputada fica com o primeiro, o segundo recebendo 409. O trigger repete as regras no banco.
Lançamentos (MAR-68): `resultados/lancamentos.ts` registra gols e penalidades pela sessão temporária, na ordem
jogo → arbitragem → sessão (`revalidarArbitragem`) → participação (`FOR SHARE`, para o estorno da MAR-71 aguardar)
→ inserção. O identificador de operação é `LancamentoJogo.operacaoId` (UNIQUE): `INSERT ... ON CONFLICT DO NOTHING`
grava a operação uma vez, e o reenvio compara jogo, tipo e participação antes de devolver o registro existente.
Operações diferentes não disputam bloqueio exclusivo, então lançamentos simultâneos são todos preservados.
Placar e desempenho são views SQL, sem totais armazenados (RNF-006). A consulta reúne as duas projeções e a
lista de lançamentos em uma única instrução SQL, compartilhando o mesmo snapshot mesmo com gols concorrentes;
a revalidação mantém seus bloqueios e o isolamento READ COMMITTED. O trigger
repete no banco jogo em andamento e participação credenciada do mesmo jogo, e torna o lançamento somente de
inclusão até a MAR-70. O encerramento (MAR-69) altera a linha do jogo e por isso aguarda lançamentos em curso.

Onze testes de integração passaram: privilégios, restrições SQL, falhas/repetições, cookies
locais e Secure na configuração de produção, origem/CORS, expiração, múltiplos dispositivos,
conta inativa/sem domínio e replays paralelos após logout. Cadastro de atleta, login, recarga,
rota protegida e logout passaram no navegador local. Isso **não** comprova arbitragem temporária,
revogação HTTP/Socket.IO concorrente com escritas esportivas nem TLS/proxy hospedado. PEN-030
permanece parcialmente aberta. Reset e uso único concorrente serão validados quando retomados.
Não há Redis nem serviço de e-mail nesta entrega.

## Interface, conectividade e arquivos

- Interface responsiva, planejada primeiro para navegador no celular e utilizável no computador.
- Câmera para leitura de QR code, mantendo o credenciamento manual já aprovado.
- Internet necessária para credenciamento e registro do jogo; não há modo offline.
- Únicos arquivos enviados nesta versão: fotos dos atletas.
- Não haverá envio de documentos para verificação de atleta, em nenhum momento.
- Fotos ficam no Supabase Storage, usando a franquia gratuita nesta etapa; o banco mantém
  a referência. Conferir limites vigentes antes de provisionar; não contratar plano pago automaticamente.

Fotos opcionais JPEG/PNG/WebP de até 5 MB; validar conteúdo e tamanho no backend.
Armazenamento privado, com consulta autorizada pelo backend ou URL assinada de curta duração.
Permissões em [requisitos, seção 11](requisitos.md#11-esclarecimentos-para-o-planejamento-do-backend--07112026);
QR não dá acesso público. Integração com Storage e políticas ainda não implementadas.

## Desenvolvimento e banco

- npm como gerenciador de pacotes, com lockfile versionado e `npm ci` em instalações automatizadas.
- CI de backend em GitHub Actions, com lint, tipos/build e todos os arquivos de integração em
  PostgreSQL descartável por job. O runner local/CI valida o banco dedicado e usa advisory lock
  transacional para recusar suítes simultâneas no mesmo banco; arquivos executam em série.
  Runtimes e check esperado pelo revisor estão no [README](../README.md#checks-de-backend-nos-prs-mar-53).
- Versões diretas fixadas nos manifests e lockfiles separados de `client/` e `server/`;
  não há workspace nem orquestrador adicional nesta etapa. Matriz inicial abaixo.
- Preservar scripts convencionais dos frameworks e ferramentas para execução, build e testes,
  sem dependência de comandos exclusivos de PowerShell ou Bash.
- PostgreSQL local em Docker Compose, com volume persistente; conferir alinhamento da versão
  principal ao provisionar o projeto Supabase.
- NestJS acessa o banco pelo Prisma, reutilizando uma instância do cliente por processo.
- No Supabase, conexão direta quando suportada pela rede da hospedagem; Session Pooler como
  alternativa para IPv4. Ajustar o conjunto de conexões ao serviço escolhido, sem novo pooler externo.
- Gerar e revisar migrações localmente, versioná-las no Git e aplicar as mesmas em teste e produção
  na publicação. Para Prisma 7, o fluxo padrão é `migrate dev` local e `migrate deploy` nos ambientes;
  confirmar os comandos na versão fixada. Não alterar o esquema manualmente pelo painel.
- Seed reproduzível com dados fictícios baseados na modelagem para desenvolvimento e demonstração.
- Usar campos cadastrais mínimos para os fluxos aprovados, provisórios até confirmação do cliente
  (PEN-008), sem acrescentar dados pessoais sem necessidade.

### Matriz inicial — 07/11/2026

| Ferramenta | Versão selecionada | Observação |
| --- | --- | --- |
| Node.js | 26.13.0 LTS | Alvo documental; conferir o runtime efetivo e os engines dos manifests. |
| npm | 12.2.2 | Alvo declarado em `packageManager`; lockfiles independentes por aplicação. |
| Next.js / eslint-config-next | 16.4.5 | Frontend com App Router. |
| React / React DOM | 19.3.1 | Mesma versão nos dois pacotes. |
| NestJS | 12.4.0 | `common`, `core` e `platform-express`; CLI 12.0.12. |
| TypeScript | 6.0.3 | Compatível com a linha selecionada do CLI Nest e do typescript-eslint. |
| ESLint | 9.39.5 | Configurações próprias; plugins transitivos do Next ainda não aceitam ESLint 10. |
| PostgreSQL | 17.11 (`postgres:17.11-bookworm`) | Base local provisória; confirmar alinhamento ao projeto Supabase quando provisionado. |
| Better Auth / adaptador Prisma | 1.7.18 | Fixados e validados localmente com handler oficial Express em ESM. |
| Prisma / client / adapter-pg | 7.10.1 | Fixados; driver adapter PostgreSQL, configuração `prisma7.config.ts` e cliente gerado. |
| Express / tipos Express | 5.2.1 / 5.0.6 | Dependências diretas para montagem do handler e parsers, compatíveis com Nest instalado. |
| Zod | 4.6.7 | Mesmo validador de e-mail do Better Auth fixado; schema estrito do cadastro. |
| @nestjs/throttler | 6.7.1 | Pacote oficial Nest; peers aceitam Nest 12; limite de `/api/cadastros`. |

TypeScript 7 e ESLint 10 não foram selecionados por incompatibilidade com as ferramentas
consultadas. O registro npm sinaliza ESLint 9 como descontinuado; ele foi mantido apenas por
compatibilidade dos plugins do Next. Reavaliar quando esses plugins aceitarem a linha suportada,
sem forçar resolução de dependências. Essa limitação é das verificações de desenvolvimento.
Prisma 7 exige Node compatível e driver adapter; os engines aceitam o Node 26.8.2 executado.
Better Auth 1.7.18 declara Prisma/client 7 nos peers e sua documentação usa Prisma 7;
Prisma 8 RC não foi selecionado. A árvore instalada não apresenta peers inválidos.
Auditoria npm: zero alertas de produção do backend; sete moderados na cadeia de lint
`typescript-eslint`/`minimatch`, sem atualização forçada incompatível nesta entrega.

Fontes: metadados oficiais dos pacotes no registro npm, [releases Node.js](https://nodejs.org/en/about/previous-releases),
[adaptador Better Auth](https://better-auth.com/docs/adapters/prisma),
[integração Express](https://better-auth.com/docs/integrations/express),
[esquema técnico Better Auth](https://better-auth.com/docs/concepts/database),
[Prisma 7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7),
[Node na Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) e
[Node no Render](https://render.com/docs/node-version). A Vercel seleciona a versão principal
e atualiza patches automaticamente; o patch exato local não é garantia do runtime hospedado.

Validação local desta estrutura: builds, lint, tipos e árvore de dependências passaram nas duas
aplicações com **Node.js 26.8.2 e npm 12.2.0**, já disponíveis na máquina. Os patches-alvo
26.13.0/12.2.2 ainda não foram executados; os manifests aceitam os patches locais testados.
Os builds responderam HTTP 200 na página inicial e em `/api/health`. Docker Compose validou a
configuração, iniciou PostgreSQL saudável e uma consulta confirmou versão 17.11 e banco `handebol`.
Validação posterior desta entrega: migrações, seed, Prisma/Better Auth, onze testes de integração
e fluxo de atleta no navegador aprovados, além de lint/tipos/build das duas aplicações.
Não valida implantação online nem os fluxos fora do cadastro/autenticação mínimos.
Revisão posterior: login de inativo, 409 de restrições e limites de tentativa cobertos por quinze
testes de integração aprovados, com lint/tipos das duas aplicações; não revalidado no navegador.

## Ambientes e implantação

Existem dois ambientes planejados: **teste** e **produção**, com bancos, arquivos e credenciais
separados. Criar somente teste nesta etapa; produção será provisionada ao concluir a aplicação.

O desenvolvimento local é uma forma de executar a aplicação para desenvolver e testar;
não será tratado como um terceiro ambiente formal. O ambiente de teste terá uma implantação
online para apresentar ao cliente, com dados fictícios.

Hospedagem escolhida: **Vercel** para Next.js, **Render** para NestJS/Socket.IO e **Supabase** para
PostgreSQL e fotos. Começar o backend de teste com uma instância, sem coordenação entre réplicas.
Testes devem poder começar com recursos gratuitos; os limites desses planos devem ser conferidos
na implantação. Produção deve usar recursos adequados à operação, sem depender da permanência
de planos gratuitos; plano e custos serão avaliados posteriormente.

Validar o encaminhamento do domínio público entre Vercel e Render, cookies, SSR e Socket.IO
na implantação de teste; a escolha dos fornecedores não comprova essa integração.
A estimativa de porte é de dezenas a poucas centenas, sem dimensionamento confirmado de
atletas, jogos simultâneos ou conexões. Não é uma meta de capacidade ou disponibilidade.

## Decisões ainda necessárias

1. Completar a prova da PEN-030 com as escritas esportivas da arbitragem (MAR-67 a 69) e a revogação
   Socket.IO (MAR-73); a sessão temporária e a revogação HTTP concorrente foram validadas na MAR-65. Contas permanentes, migrações, seed e prova local de
   cadastro/logout já foram validados; comandos no [README](../README.md#desenvolvimento-local).
2. Detalhar e validar implantação de teste, encaminhamento, cookies, segredos, IP real do cliente
   para os limites de tentativa (`trust proxy` e `advanced.ipAddress`) e verificações;
   implementar limites e permissões das fotos definidos nos requisitos.
3. Definir em código o contrato da API (documentado em OpenAPI), eventos, conflitos, publicação
   após transação e reconexão. A equipe conduz as decisões técnicas; comportamentos de produto
   ainda indefinidos exigem esclarecimento com Marcus.
4. Retomar serviço de e-mail, recuperação de senha e sua validação em etapa posterior.
5. Detalhar produção, logs e backup/restauração posteriormente, sem bloquear o início local.

Métricas e critérios disciplinares pendentes do cliente continuam registrados em
[pendencias.md](pendencias.md).
