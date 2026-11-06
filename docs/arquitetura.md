# Arquitetura da aplicação

Decisões acordadas com Marcus em 06/11/2026. Este documento descreve o planejamento;
a estrutura de código e a infraestrutura ainda não foram criadas.

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

- Utilizar biblioteca pronta integrada ao NestJS; a biblioteca específica ainda será escolhida.
- Login inicial por e-mail e senha.
- Não exigir confirmação de e-mail, inclusive antes da solicitação de aprovação esportiva.
- Oferecer recuperação de senha por link enviado ao e-mail, com validade e uso único.
- Sessões revogáveis no servidor, identificadas por cookies seguros.
- Permitir múltiplos dispositivos por conta ou acesso de arbitragem.
- Manter aprovação esportiva e permissões dos perfis sob responsabilidade da aplicação.

A arbitragem usa sessões limitadas ao jogo, incluindo quem entra por senha compartilhada.
Encerrar o jogo bloqueia novas operações em todos os dispositivos, inclusive conexões já abertas.
As exceções de vínculo para acesso por senha seguem os requisitos existentes.

Tabelas de autenticação, sessões e recuperação serão definidas após selecionar a biblioteca.
O `authId` da modelagem representa a ligação com essa identidade; não implica um provedor externo
obrigatório. O esquema atual não contém ainda todas as tabelas técnicas da autenticação.

## Interface, conectividade e arquivos

- Interface responsiva, planejada primeiro para navegador no celular e utilizável no computador.
- Câmera para leitura de QR code, mantendo o credenciamento manual já aprovado.
- Internet necessária para credenciamento e registro do jogo; não há modo offline.
- Únicos arquivos enviados nesta versão: fotos dos atletas.
- Não haverá envio de documentos para verificação de atleta, em nenhum momento.
- Fotos ficam em armazenamento de arquivos; o banco mantém a referência.

Limites de tamanho/formato das fotos, permissões de consulta e edição e o fornecedor
de armazenamento ainda precisam ser definidos.

## Ambientes e implantação

Existem dois ambientes: **teste** e **produção**, com bancos, arquivos e credenciais separados.

O desenvolvimento local é uma forma de executar a aplicação para desenvolver e testar;
não será tratado como um terceiro ambiente formal. O ambiente de teste terá uma implantação
online para apresentar ao cliente, com dados fictícios.

Testes devem poder começar com recursos gratuitos. Produção deve usar recursos adequados à
operação, sem depender da permanência de planos gratuitos. Fornecedores e custos ainda não
foram definidos.

Para produção, selecionar execução compatível com conexões persistentes do Socket.IO.
A estimativa de porte é de dezenas a poucas centenas, sem dimensionamento confirmado de
atletas, jogos simultâneos ou conexões. Não é uma meta de capacidade ou disponibilidade.

## Decisões ainda necessárias

1. Escolher biblioteca de autenticação e validar sua integração com NestJS/Express,
   cookies, Prisma, recuperação de senha e arbitragem temporária.
2. Escolher hospedagem, banco gerenciado, envio de e-mails e armazenamento de fotos;
   conferir limites de teste, custos de produção e suporte às conexões em tempo real.
3. Definir versões compatíveis, gerenciamento do repositório e comandos de build/teste.
4. Definir contrato inicial da API, eventos, tratamento de conflitos, publicação de notificações
   e mecanismo de atualização/reconexão.
5. Detalhar implantação, segredos, logs, backups e verificações automatizadas, conforme RNFs aprovados.

Métricas e critérios disciplinares pendentes do cliente continuam registrados em
[pendencias.md](pendencias.md).
