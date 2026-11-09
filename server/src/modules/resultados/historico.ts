import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import type { Ator } from "../autorizacao/ator.js";

type Tx = Prisma.TransactionClient;

/** Métricas da participação credenciada pela projeção `DesempenhoDoAtleta` (somente lançamentos válidos, RNF-009). */
export interface Metricas {
  temp_gols: number;
  temp_cartoesAmarelos: number;
  temp_exclusoesDoisMinutos: number;
  temp_cartoesVermelhos: number;
}
const METRICAS = ["temp_gols", "temp_cartoesAmarelos", "temp_exclusoesDoisMinutos", "temp_cartoesVermelhos"] as const;

export interface ClubeNoJogo { inscricaoId: string; clube: { id: string; nome: string } }

/**
 * Situação de uma participação (RF-033, MAR-74): escalação, credenciamento e entrada em quadra são etapas distintas.
 * As métricas existem somente com o credenciamento; antes dele, ou só escalado, ficam `null`.
 */
export interface Situacao {
  participacaoId: string;
  numeroCamisa: number | null;
  escalado: boolean;
  credenciado: boolean;
  entrouEmQuadra: boolean;
  metricas: Metricas | null;
}

/**
 * Resumo do jogo compartilhado pelas consultas. Os campos de data vêm do PostgreSQL (jsonb) como texto ISO 8601.
 * `vencedorInscricaoId` é separado do placar (MAR-72); `invalidadoEm` sinaliza a invalidação, que preserva estatísticas.
 */
const resumoJogo = (j: string, c: string) => Prisma.raw(`jsonb_build_object(
  'id', ${j}.id, 'status', ${j}.status,
  'campeonato', jsonb_build_object('id', ${c}.id, 'nome', ${c}.nome, 'edicao', ${c}.edicao, 'categoria', ${c}.categoria),
  'local', ${j}.local, 'fusoHorario', ${j}."fusoHorario", 'inicioPrevistoEm', ${j}."inicioPrevistoEm",
  'iniciadoEm', ${j}."iniciadoEm", 'encerradoEm', ${j}."encerradoEm", 'resultado', ${j}.resultado,
  'vencedorInscricaoId', ${j}."inscricaoClubeVencedorId", 'invalidadoEm', ${j}."invalidadoEm",
  'interrompido', ${j}.status = 'em_andamento' AND EXISTS (
    SELECT 1 FROM "InterrupcaoJogo" i WHERE i."jogoId" = ${j}.id AND i."retomadoEm" IS NULL))`);

/** Métricas em jsonb a partir da linha `d` da projeção; null sem credenciamento (a projeção só tem credenciados). */
const metricasSql = `CASE WHEN d."participacaoId" IS NOT NULL THEN jsonb_build_object(
  'temp_gols', d."temp_gols", 'temp_cartoesAmarelos', d."temp_cartoesAmarelos",
  'temp_exclusoesDoisMinutos', d."temp_exclusoesDoisMinutos", 'temp_cartoesVermelhos', d."temp_cartoesVermelhos") END`;

const situacaoSql = Prisma.raw(`'participacaoId', p.id, 'numeroCamisa', p."numeroCamisa",
  'escalado', p."escolhidaEm" IS NOT NULL, 'credenciado', p."credenciadoEm" IS NOT NULL,
  'entrouEmQuadra', p."entrouEmQuadraEm" IS NOT NULL, 'metricas', ${metricasSql}`);

/** Participações que existem como escalação ou credenciamento (a retirada sem credenciamento remove a linha). */
const participacaoVisivel = Prisma.raw(`(p."escolhidaEm" IS NOT NULL OR p."credenciadoEm" IS NOT NULL)`);

export type DesempenhoDoJogo = {
  jogo: Record<string, unknown> & { id: string };
  placar: { clubeA: ClubeNoJogo; temp_placarClubeA: number; clubeB: ClubeNoJogo; temp_placarClubeB: number } | null;
  participacoes: (Situacao & { inscricaoId: string; atleta: { id: string; nomeCompleto: string } })[];
};

/**
 * Métricas de um jogo (RF-033, RF-037, MAR-74): resumo, placar (soma dos gols válidos; null antes do início, salvo W.O.)
 * e cada participação com escalação, credenciamento, entrada em quadra e métricas. Presidente consulta qualquer jogo;
 * técnico aprovado, somente os jogos do clube que treina atualmente, com os atletas dos dois clubes (decisão de Marcus
 * na MAR-74, 09/11/2026). Sem lançamentos anulados nem dados pessoais além de nome e camisa.
 */
export async function consultarDesempenhoDoJogo(tx: Tx, ator: Ator, jogoId: string): Promise<DesempenhoDoJogo> {
  const [clubes] = await tx.$queryRaw<{ clubeAId: string; clubeBId: string }[]>`
    SELECT a."clubeId" AS "clubeAId", b."clubeId" AS "clubeBId" FROM "Jogo" j
    JOIN "InscricaoClube" a ON a.id = j."inscricaoClubeAId" JOIN "InscricaoClube" b ON b.id = j."inscricaoClubeBId"
    WHERE j.id = ${jogoId}::uuid`;
  if (ator.perfil !== "presidente") {
    const doClube = ator.perfil === "tecnico" && ator.aprovado && ator.clubeId !== null && clubes !== undefined
      && [clubes.clubeAId, clubes.clubeBId].includes(ator.clubeId);
    if (!doClube) throw new ForbiddenException("Consulta permitida somente ao presidente e ao técnico atual de um dos clubes do jogo.");
  }
  if (!clubes) throw new NotFoundException("Jogo não encontrado.");

  // Uma instrução: resumo, placar e participações compartilham o mesmo snapshot, mesmo com correções concorrentes.
  const [linha] = await tx.$queryRaw<DesempenhoDoJogo[]>`
    SELECT ${resumoJogo("j", "c")} AS jogo,
      (SELECT jsonb_build_object(
        'clubeA', jsonb_build_object('inscricaoId', a.id, 'clube', jsonb_build_object('id', ca.id, 'nome', ca.nome)),
        'temp_placarClubeA', e."temp_placarClubeA",
        'clubeB', jsonb_build_object('inscricaoId', b.id, 'clube', jsonb_build_object('id', cb.id, 'nome', cb.nome)),
        'temp_placarClubeB', e."temp_placarClubeB")
       FROM "EstatisticasDoJogo" e
       JOIN "InscricaoClube" a ON a.id = j."inscricaoClubeAId" JOIN "Clube" ca ON ca.id = a."clubeId"
       JOIN "InscricaoClube" b ON b.id = j."inscricaoClubeBId" JOIN "Clube" cb ON cb.id = b."clubeId"
       WHERE e."jogoId" = j.id) AS placar,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'inscricaoId', p."inscricaoClubeId", 'atleta', jsonb_build_object('id', u.id, 'nomeCompleto', u."nomeCompleto"), ${situacaoSql})
        ORDER BY p."inscricaoClubeId" = j."inscricaoClubeBId", p."numeroCamisa" NULLS LAST, u."nomeCompleto", p.id), '[]'::jsonb)
       FROM "Participacao" p JOIN "Usuario" u ON u.id = p."atletaId"
       LEFT JOIN "DesempenhoDoAtleta" d ON d."participacaoId" = p.id
       WHERE p."jogoId" = j.id AND ${participacaoVisivel}) AS participacoes
    FROM "Jogo" j JOIN "Campeonato" c ON c.id = j."campeonatoId"
    WHERE j.id = ${jogoId}::uuid`;
  if (!linha) throw new NotFoundException("Jogo não encontrado.");
  return linha;
}

export type JogoDoHistorico = Situacao & {
  jogo: Record<string, unknown> & { id: string; invalidadoEm: string | null };
  /** Clube representado naquele jogo (RN-008): vem da participação, não do vínculo atual. */
  clube: ClubeNoJogo;
  adversario: ClubeNoJogo;
  /** Gols válidos de cada lado, do ponto de vista do clube representado; null antes do início (salvo W.O.). */
  placar: { clube: number; adversario: number } | null;
};

/**
 * Histórico esportivo do atleta (RF-012, RF-033, RN-008, RN-036, MAR-74), do jogo mais recente ao mais antigo, com o
 * clube representado em cada jogo (preservado após transferências) e as etapas da participação. Totais somam as
 * métricas de todas as participações credenciadas, inclusive jogos excepcionais e invalidados (sinalizados por
 * `jogo.invalidadoEm`), sem lançamentos anulados (RNF-009). Permitido ao próprio atleta, aos presidentes e ao técnico
 * aprovado do clube atual do atleta, incluindo os jogos por clubes anteriores (decisão de Marcus na MAR-74).
 */
export async function consultarHistoricoDoAtleta(tx: Tx, ator: Ator, atletaId: string) {
  // Só bloqueia conta de atleta: protege contra transferências sem disputar a substituição de técnicos.
  await tx.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${atletaId}::uuid AND perfil = 'atleta' FOR SHARE`;
  const atleta = await tx.atleta.findUnique({ where: { usuarioId: atletaId }, select: {
    usuario: { select: { id: true, nomeCompleto: true } },
    vinculos: { where: { fim: null }, select: { clube: { select: { id: true, nome: true } } }, take: 1 },
  } });
  const clubeAtual = atleta?.vinculos[0]?.clube ?? null;
  const permitido = ator.perfil === "presidente"
    || (ator.perfil === "atleta" && ator.usuarioId === atletaId)
    || (ator.perfil === "tecnico" && ator.aprovado && ator.clubeId !== null && clubeAtual?.id === ator.clubeId);
  if (!permitido) throw new ForbiddenException("Histórico disponível somente ao próprio atleta, aos presidentes e ao técnico atual do clube do atleta.");
  if (!atleta) throw new NotFoundException("Atleta não encontrado.");

  // Uma instrução para todas as participações, placares e métricas: totais e jogos refletem o mesmo snapshot.
  const jogos = await tx.$queryRaw<{ item: JogoDoHistorico }[]>`
    SELECT jsonb_build_object(
      'jogo', ${resumoJogo("j", "c")},
      'clube', jsonb_build_object('inscricaoId', ip.id, 'clube', jsonb_build_object('id', cp.id, 'nome', cp.nome)),
      'adversario', jsonb_build_object('inscricaoId', io.id, 'clube', jsonb_build_object('id', co.id, 'nome', co.nome)),
      'placar', CASE WHEN e."jogoId" IS NOT NULL THEN jsonb_build_object(
        'clube', CASE WHEN ip.id = j."inscricaoClubeAId" THEN e."temp_placarClubeA" ELSE e."temp_placarClubeB" END,
        'adversario', CASE WHEN ip.id = j."inscricaoClubeAId" THEN e."temp_placarClubeB" ELSE e."temp_placarClubeA" END) END,
      ${situacaoSql}) AS item
    FROM "Participacao" p
    JOIN "Jogo" j ON j.id = p."jogoId" JOIN "Campeonato" c ON c.id = j."campeonatoId"
    JOIN "InscricaoClube" ip ON ip.id = p."inscricaoClubeId" JOIN "Clube" cp ON cp.id = ip."clubeId"
    JOIN "InscricaoClube" io ON io.id = CASE WHEN ip.id = j."inscricaoClubeAId" THEN j."inscricaoClubeBId" ELSE j."inscricaoClubeAId" END
    JOIN "Clube" co ON co.id = io."clubeId"
    LEFT JOIN "EstatisticasDoJogo" e ON e."jogoId" = j.id
    LEFT JOIN "DesempenhoDoAtleta" d ON d."participacaoId" = p.id
    WHERE p."atletaId" = ${atletaId}::uuid AND ${participacaoVisivel}
    ORDER BY COALESCE(j."iniciadoEm", j."inicioPrevistoEm") DESC NULLS FIRST, j.id`;

  const lista = jogos.map(j => j.item);
  const totais = {
    participacoes: {
      escaladas: lista.filter(j => j.escalado).length,
      credenciadas: lista.filter(j => j.credenciado).length,
      comEntradaEmQuadra: lista.filter(j => j.entrouEmQuadra).length,
    },
    ...Object.fromEntries(METRICAS.map(m => [m, lista.reduce((soma, j) => soma + (j.metricas?.[m] ?? 0), 0)])) as unknown as Metricas,
  };
  return { atleta: { ...atleta.usuario, clubeAtual }, totais, jogos: lista };
}
