import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, TipoLancamento } from "../../generated/prisma/client.js";
import { revalidarArbitragem } from "../arbitragem/acesso.js";

type Tx = Prisma.TransactionClient;

const uuid = () => z.uuid().transform(id => id.toLowerCase());

/**
 * Lançamento da arbitragem (RF-031/032/037): `operacaoId` é gerado pelo cliente para cada ocorrência e reenviado
 * igual em caso de falha de rede; `participacaoId` identifica o atleta credenciado (o clube vem dela, RN-033).
 * Não há `valor` nem clube no corpo: cada ocorrência vale 1.
 */
export const lancamentoSchema = z.strictObject({
  operacaoId: uuid(),
  tipo: z.enum(TipoLancamento),
  participacaoId: uuid(),
});

const selecaoLancamento = {
  id: true, operacaoId: true, jogoId: true, tipo: true, valor: true, registradoEm: true, participacaoId: true,
  participacao: { select: { inscricaoClubeId: true, numeroCamisa: true, atleta: { select: { usuario: { select: { id: true, nomeCompleto: true } } } } } },
} satisfies Prisma.LancamentoJogoSelect;
type LinhaLancamento = Prisma.LancamentoJogoGetPayload<{ select: typeof selecaoLancamento }>;

function apresentar(l: LinhaLancamento) {
  return {
    id: l.id, operacaoId: l.operacaoId, tipo: l.tipo, valor: l.valor, registradoEm: l.registradoEm,
    participacaoId: l.participacaoId, inscricaoId: l.participacao?.inscricaoClubeId ?? null,
    atleta: l.participacao?.atleta.usuario ?? null, numeroCamisa: l.participacao?.numeroCamisa ?? null,
  };
}

/** Placar do jogo pela projeção `EstatisticasDoJogo`; null antes do início (RN-033). */
async function placar(tx: Tx, jogoId: string) {
  const jogo = await tx.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: {
    inscricaoClubeA: { select: { id: true, clube: { select: { id: true, nome: true } } } },
    inscricaoClubeB: { select: { id: true, clube: { select: { id: true, nome: true } } } },
  } });
  const [estatisticas] = await tx.$queryRaw<{ temp_placarClubeA: number; temp_placarClubeB: number }[]>`
    SELECT "temp_placarClubeA", "temp_placarClubeB" FROM "EstatisticasDoJogo" WHERE "jogoId" = ${jogoId}::uuid`;
  if (!estatisticas) return null;
  return {
    clubeA: { inscricaoId: jogo.inscricaoClubeA.id, clube: jogo.inscricaoClubeA.clube }, temp_placarClubeA: estatisticas.temp_placarClubeA,
    clubeB: { inscricaoId: jogo.inscricaoClubeB.id, clube: jogo.inscricaoClubeB.clube }, temp_placarClubeB: estatisticas.temp_placarClubeB,
  };
}

const lerPorOperacao = (tx: Tx, operacaoId: string) => tx.lancamentoJogo.findUnique({ where: { operacaoId }, select: selecaoLancamento });

/**
 * Reenvio da mesma operação: o registro existente é devolvido com `alterado: false`. Conteúdo diferente com o
 * mesmo identificador (outro jogo, tipo ou participação) é conflito e nunca sobrescreve o original.
 */
async function repeticao(tx: Tx, jogoId: string, dados: z.infer<typeof lancamentoSchema>) {
  const existente = await lerPorOperacao(tx, dados.operacaoId);
  if (!existente) return null;
  if (existente.jogoId !== jogoId || existente.tipo !== dados.tipo || existente.participacaoId !== dados.participacaoId) {
    throw new ConflictException("operacaoId já usado em outro lançamento. Gere um novo identificador para uma nova ocorrência.");
  }
  return { lancamento: apresentar(existente), alterado: false, placar: await placar(tx, jogoId) };
}

/**
 * Arbitragem autorizada registra gol ou penalidade do atleta credenciado com o jogo em andamento (RF-031/032,
 * RN-032/033). Ordem dos bloqueios: jogo → arbitragem → sessão (revalidação) → participação (FOR SHARE) →
 * inserção, cujo trigger repete as regras com os mesmos bloqueios. Lançamentos simultâneos de operações
 * diferentes são todos preservados; a mesma operação enviada em paralelo grava uma vez (`ON CONFLICT`).
 * Placar e desempenho são lidos das projeções na mesma transação, já com o lançamento.
 */
export async function registrarLancamento(tx: Tx, jogoId: string, token: string | undefined, dados: z.infer<typeof lancamentoSchema>) {
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  const anterior = await repeticao(tx, jogoId, dados);
  if (anterior) return anterior;
  if (status !== "em_andamento") throw new ConflictException("Gols e penalidades são registrados somente com o jogo em andamento.");

  const [participacao] = await tx.$queryRaw<{ credenciado: boolean }[]>`
    SELECT "credenciadoEm" IS NOT NULL AS credenciado FROM "Participacao"
    WHERE id = ${dados.participacaoId}::uuid AND "jogoId" = ${jogoId}::uuid FOR SHARE`;
  if (!participacao) throw new NotFoundException("Participação não encontrada neste jogo.");
  if (!participacao.credenciado) throw new ConflictException("Somente atleta credenciado neste jogo recebe gols ou penalidades.");

  const inseridos = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "LancamentoJogo" (id, "operacaoId", "jogoId", "participacaoId", tipo, valor, "registradoEm")
    VALUES (gen_random_uuid(), ${dados.operacaoId}::uuid, ${jogoId}::uuid, ${dados.participacaoId}::uuid, ${dados.tipo}::"TipoLancamento", 1, now())
    ON CONFLICT ("operacaoId") DO NOTHING
    RETURNING id`;
  if (inseridos.length === 0) {
    // A mesma operação gravada por outra requisição simultânea, já confirmada.
    const concorrente = await repeticao(tx, jogoId, dados);
    if (concorrente) return concorrente;
    throw new ConflictException("O lançamento mudou durante a operação. Consulte os registros e tente novamente.");
  }
  const lancamento = await lerPorOperacao(tx, dados.operacaoId);
  return { lancamento: apresentar(lancamento!), alterado: true, placar: await placar(tx, jogoId) };
}

/**
 * Registros do jogo para a arbitragem autorizada: placar (null antes do início), desempenho de cada atleta
 * credenciado (projeção `DesempenhoDoAtleta`, zeros sem lançamentos) e os lançamentos em ordem de registro.
 */
export async function consultarLancamentos(tx: Tx, jogoId: string, token: string | undefined) {
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  // Uma instrução compartilha o snapshot entre lista e projeções, sem mudar o isolamento da autorização.
  const [registros] = await tx.$queryRaw<{
    placar: Awaited<ReturnType<typeof placar>>;
    desempenho: {
      participacaoId: string; inscricaoId: string; atleta: { id: string; nomeCompleto: string }; numeroCamisa: number;
      temp_gols: number; temp_cartoesAmarelos: number; temp_exclusoesDoisMinutos: number; temp_cartoesVermelhos: number;
    }[];
    lancamentos: (Omit<ReturnType<typeof apresentar>, "registradoEm"> & { registradoEm: string })[];
  }[]>`
    SELECT
      (SELECT jsonb_build_object(
        'clubeA', jsonb_build_object('inscricaoId', a.id, 'clube', jsonb_build_object('id', ca.id, 'nome', ca.nome)),
        'temp_placarClubeA', e."temp_placarClubeA",
        'clubeB', jsonb_build_object('inscricaoId', b.id, 'clube', jsonb_build_object('id', cb.id, 'nome', cb.nome)),
        'temp_placarClubeB', e."temp_placarClubeB")
       FROM "EstatisticasDoJogo" e
       JOIN "Jogo" j ON j.id = e."jogoId"
       JOIN "InscricaoClube" a ON a.id = j."inscricaoClubeAId" JOIN "Clube" ca ON ca.id = a."clubeId"
       JOIN "InscricaoClube" b ON b.id = j."inscricaoClubeBId" JOIN "Clube" cb ON cb.id = b."clubeId"
       WHERE e."jogoId" = ${jogoId}::uuid) AS placar,
      (SELECT COALESCE(jsonb_agg(d ORDER BY d."inscricaoId", d."numeroCamisa"), '[]'::jsonb) FROM (
        SELECT d.*, p."inscricaoClubeId" AS "inscricaoId", p."numeroCamisa",
          jsonb_build_object('id', u.id, 'nomeCompleto', u."nomeCompleto") AS atleta
        FROM "DesempenhoDoAtleta" d
        JOIN "Participacao" p ON p.id = d."participacaoId" JOIN "Usuario" u ON u.id = p."atletaId"
        WHERE p."jogoId" = ${jogoId}::uuid
      ) d) AS desempenho,
      (SELECT COALESCE(jsonb_agg(l ORDER BY l."registradoEm", l.id), '[]'::jsonb) FROM (
        SELECT l.id, l."operacaoId", l.tipo, l.valor, l."registradoEm", l."participacaoId",
          p."inscricaoClubeId" AS "inscricaoId", p."numeroCamisa",
          CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('id', u.id, 'nomeCompleto', u."nomeCompleto") END AS atleta
        FROM "LancamentoJogo" l
        LEFT JOIN "Participacao" p ON p.id = l."participacaoId" LEFT JOIN "Usuario" u ON u.id = p."atletaId"
        WHERE l."jogoId" = ${jogoId}::uuid
      ) l) AS lancamentos`;
  return {
    jogo: { id: jogoId, status },
    placar: registros.placar,
    desempenho: registros.desempenho,
    lancamentos: registros.lancamentos.map(l => ({ ...l, registradoEm: new Date(l.registradoEm) })),
  };
}

/** Restrições do banco (estado alterado durante a operação) e deadlocks chegam como 409. */
export function traduzirErroLancamento(error: unknown): unknown {
  const conflito = new ConflictException("Lançamento recusado por conflito com o estado atual do jogo ou do credenciamento. Consulte os registros e tente novamente.");
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2025"].includes(error.code)) return conflito;
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo && ["23505", "23503", "23514", "40P01"].includes(codigo)) return conflito;
  return error;
}
