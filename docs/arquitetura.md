# Arquitetura da aplicação

Decisões acordadas com Marcus em 06/11/2026 e atualizadas em 07/11/2026 pela mediação da
PEN-030 e pelas definições posteriores de desenvolvimento, infraestrutura e arbitragem.
Este documento descreve a direção aprovada. A estrutura mínima local foi criada;
as funcionalidades de domínio e a infraestrutura online ainda não foram implementadas.

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
      participacoes/
      arbitragem/
      resultados/
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
O acesso ocorre somente no dia marcado, sem liberação manual adicional. Encerramento,
cancelamento ou adiamento invalidam todos os acessos temporários abertos para o jogo,
inclusive conexões já abertas. Somente o presidente adia ou cancela. A senha inicial é automática;
adiar gera uma nova. Troca manual exige presidente ou conta autenticada e designada para o jogo;
entrar apenas por nome e senha não concede essa permissão. Trocar a senha invalida todas as
sessões por senha, preservando as por designação; não há retirada individual de acesso por senha.
Revalidar autorização junto da transação de escrita, com controle de concorrência com o
encerramento; somente um guard anterior à transação não basta. As notificações Socket.IO
também exigem destinatários ainda autorizados; validar só o handshake é insuficiente.
As exceções de vínculo para acesso por senha seguem os requisitos existentes (RN-025).

As [tabelas técnicas](modelo-banco-dados.md#complemento-técnico-de-autenticação--pen-030)
complementam o domínio. `Usuario.authId` permanece único e sem FK; não exige provedor externo.
O cadastro deve impedir identidades parcialmente criadas de obter permissões e tratar falhas e
repetições. Um hook após criação não comprova atomicidade entre biblioteca e domínio.

Direção para a prova de integração: handler oficial Node/Express no NestJS e guard de domínio,
sem exigir a ponte comunitária `@thallesp/nestjs-better-auth`. A montagem precede o parser do
corpo nas rotas da biblioteca; as demais rotas mantêm validação normal. Confirmar esse desenho,
ESM, rotas, OpenAPI, cookies `HttpOnly; Secure; SameSite=Lax`, origem/CSRF e SSR antes de implementar
o módulo definitivo. O Next.js apenas consome a API e repassa cookies no SSR.

A biblioteca foi escolhida; a integração ainda não foi testada. Gerar/revisar o esquema da versão
fixada e migrá-lo pelo Prisma. A prova inicial valida cadastro sem elevação de privilégio,
consistência em falhas e revogação concorrente em HTTP/Socket.IO. Transações e uso único
concorrente do reset serão validados quando a recuperação for retomada. Não adicionar Redis nesta etapa.

## Interface, conectividade e arquivos

- Interface responsiva, planejada primeiro para navegador no celular e utilizável no computador.
- Câmera para leitura de QR code, mantendo o credenciamento manual já aprovado.
- Internet necessária para credenciamento e registro do jogo; não há modo offline.
- Únicos arquivos enviados nesta versão: fotos dos atletas.
- Não haverá envio de documentos para verificação de atleta, em nenhum momento.
- Fotos ficam no Supabase Storage, usando a franquia gratuita nesta etapa; o banco mantém
  a referência. Conferir limites vigentes antes de provisionar; não contratar plano pago automaticamente.

Limites de tamanho/formato das fotos e permissões de consulta e edição ainda precisam ser definidos.

## Desenvolvimento e banco

- npm como gerenciador de pacotes, com lockfile versionado e `npm ci` em instalações automatizadas.
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
| Node.js | 26.13.0 LTS | Alvo local em `.node-version`; conferir o runtime efetivo ao executar. |
| npm | 12.2.2 | Alvo declarado em `packageManager`; lockfiles independentes por aplicação. |
| Next.js / eslint-config-next | 16.4.5 | Frontend com App Router. |
| React / React DOM | 19.3.1 | Mesma versão nos dois pacotes. |
| NestJS | 12.4.0 | `common`, `core` e `platform-express`; CLI 12.0.12. |
| TypeScript | 6.0.3 | Compatível com a linha selecionada do CLI Nest e do typescript-eslint. |
| ESLint | 9.39.5 | Configurações próprias; plugins transitivos do Next ainda não aceitam ESLint 10. |
| PostgreSQL | 17.11 (`postgres:17.11-bookworm`) | Base local provisória; confirmar alinhamento ao projeto Supabase quando provisionado. |

TypeScript 7 e ESLint 10 não foram selecionados por incompatibilidade com as ferramentas
consultadas. O registro npm sinaliza ESLint 9 como descontinuado; ele foi mantido apenas por
compatibilidade dos plugins do Next. Reavaliar quando esses plugins aceitarem a linha suportada,
sem forçar resolução de dependências. Essa limitação é das verificações de desenvolvimento.
Better Auth/adaptador 1.7.18 e Prisma/client/adapter-pg 7.10.1 são **candidatos
para a próxima prova**, ainda não instalados nem validados juntos. Não confundir essa matriz
documental com prova de integração de autenticação ou execução de PostgreSQL.

Fontes: metadados oficiais dos pacotes no registro npm, [releases Node.js](https://nodejs.org/en/about/previous-releases),
[adaptador Better Auth](https://better-auth.com/docs/adapters/prisma),
[Node na Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) e
[Node no Render](https://render.com/docs/node-version). A Vercel seleciona a versão principal
e atualiza patches automaticamente; o patch exato local não é garantia do runtime hospedado.

Validação local desta estrutura: builds, lint, tipos e árvore de dependências passaram nas duas
aplicações com **Node.js 26.8.2 e npm 12.2.0**, já disponíveis na máquina. Os patches-alvo
26.13.0/12.2.2 ainda não foram executados; os manifests aceitam os patches locais testados.
Os builds responderam HTTP 200 na página inicial e em `/api/health`. Docker Compose validou a
configuração, iniciou PostgreSQL saudável e uma consulta confirmou versão 17.11 e banco `handebol`.
Isso valida o bootstrap; não valida integração Prisma/Better Auth, autenticação ou implantação online.

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

1. Executar PostgreSQL local e a prova inicial de cadastro e revogação com Better Auth,
   NestJS/Express, Prisma e arbitragem temporária. Estrutura e scripts estão no repositório;
   os comandos locais constam no [README](../README.md#desenvolvimento-local).
2. Detalhar e validar implantação de teste, encaminhamento, cookies, segredos e verificações;
   definir limites e permissões das fotos.
3. Definir em código o contrato da API (documentado em OpenAPI), eventos, conflitos, publicação
   após transação e reconexão. A equipe conduz as decisões técnicas; comportamentos de produto
   ainda indefinidos exigem esclarecimento com Marcus.
4. Retomar serviço de e-mail, recuperação de senha e sua validação em etapa posterior.
5. Detalhar produção, logs e backup/restauração posteriormente, sem bloquear o início local.

Métricas e critérios disciplinares pendentes do cliente continuam registrados em
[pendencias.md](pendencias.md).
