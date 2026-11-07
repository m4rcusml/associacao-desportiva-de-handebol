# Associação Desportiva de Handebol

Projeto de uma aplicação para organizar clubes, atletas, campeonatos e jogos de handebol. A proposta
reúne aprovação de cadastros, carteirinhas, credenciamento, arbitragem e histórico esportivo,
apoiando o trabalho cotidiano da associação. O repositório inicia a preparação técnica;
os fluxos descritos abaixo são o comportamento planejado e ainda não estão implementados.

## Documentação

- [Requisitos funcionais, não funcionais e regras de negócio](docs/requisitos.md)
- [Arquitetura e tecnologias aprovadas](docs/arquitetura.md)
- [Modelagem do banco e suas regras](docs/modelo-banco-dados.md)
- [Diagrama com atributos e relações](docs/modelo-banco-dados.mmd)
- [Pendências e confirmações com o cliente](docs/pendencias.md)
- [Glossário](docs/GLOSSARY.md)
- [Diagrama no Miro](https://miro.com/app/board/uXjVEU3V9rY=/?moveToWidget=3458764688860471326)

## Desenvolvimento local

Frontend e backend têm instalações, lockfiles e builds independentes. A matriz de versões
está em [arquitetura](docs/arquitetura.md#matriz-inicial--07112026); `.node-version` indica
o Node.js alvo. Instale Docker com Compose para executar o PostgreSQL local.
Copie `.env.example` da raiz para `.env` e `server/.env.example` para `server/.env`.
As credenciais de exemplo são exclusivamente locais. O frontend ainda não exige variáveis de ambiente.

Na raiz do repositório, inicie o banco:

```sh
docker compose config --quiet
docker compose up -d --wait
```

O volume nomeado preserva os dados entre reinicializações. `docker compose down` para o banco
sem remover o volume; não use `down -v` para uma parada normal.

Em cada aplicação, execute `npm ci` na primeira instalação ou após atualização do lockfile.
Inicie em terminais separados:

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

A estrutura contém uma página inicial e um endpoint de saúde. Autenticação, conexão Prisma,
migrações, seed e funcionalidades esportivas serão implementados nas próximas etapas.
Não há suíte de testes de negócio ainda; a primeira prova deve cobrir cadastro e revogação
concorrente, sem recuperação de senha nesta etapa. Não foram criados recursos online.

Verificação inicial em 07/11/2026: build, lint, tipos e árvore de dependências passaram nas duas
aplicações com Node.js 26.8.2/npm 12.2.0. Os builds responderam HTTP 200 e o PostgreSQL 17.11
foi iniciado e consultado. Os patches-alvo da matriz ainda não foram executados. ESLint 9 está
descontinuado no registro npm, mas é a última linha aceita pelos plugins atuais do Next;
a limitação e a atualização futura estão registradas na arquitetura.

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
   sem liberação manual adicional.
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
