import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, TipoLancamento } from "../../generated/prisma/client.js";
import { revalidarArbitragem } from "../arbitragem/acesso.js";
import { exigirJogoSemInterrupcao } from "../jogos/jogos.js";
import { registrarEvento } from "../notificacoes/eventos.js";
import { reconciliarSuspensoesAutomaticas } from "../suspensoes/suspensoes.js";

type Tx = Prisma.TransactionClient;

const uuid = () => z.uuid().transform(id => id.toLowerCase());

/**
 * Lançamento da arbitragem (RF-031/032/037): `operacaoId` é gerado pelo cliente para cada ocorrência e reenviado
 * igual em caso de falha de rede; `participacaoId` identifica o atleta credenciado (o clube vem dela, RN-033).
 * Não há `valor` nem clube no corpo: cada ocorrência vale 1. `relatorioDisciplinar` (MAR-79, seção 12) só existe no
 * vermelho: `true` é a desqualificação com relatório, sinalizada pelo azul; ausente vale `false`. Nos demais tipos é
 * recusado e fica `null`.
 */
export const lancamentoSchema = z.strictObject({
  operacaoId: uuid(),
  tipo: z.enum(TipoLancamento),
  participacaoId: uuid(),
  relatorioDisciplinar: z.boolean().optional(),
}).refine(l => l.tipo === "temp_cartaoVermelho" || l.relatorioDisciplinar === undefined, {
  message: "relatorioDisciplinar só é informado no temp_cartaoVermelho", path: ["relatorioDisciplinar"],
}).transform(l => ({ ...l, relatorioDisciplinar: l.tipo === "temp_cartaoVermelho" ? l.relatorioDisciplinar ?? false : null }));

type Lancamento = z.infer<typeof lancamentoSchema>;
/** Dados de lançamento ou correção; sem `relatorioDisciplinar`, o vermelho fica sem relatório (como no corpo HTTP). */
export type DadosLancamento = Omit<Lancamento, "relatorioDisciplinar"> & { relatorioDisciplinar?: boolean | null };
const normalizar = (dados: DadosLancamento): Lancamento =>
  ({ ...dados, relatorioDisciplinar: dados.tipo === "temp_cartaoVermelho" ? dados.relatorioDisciplinar ?? false : null });

/** Correção (MAR-70): o mesmo corpo do lançamento; `operacaoId` identifica a correção e o substituto criado. */
export const correcaoSchema = lancamentoSchema;
/** Anulação (MAR-70): `operacaoId` gerado pelo cliente torna o reenvio reconhecível. */
export const anulacaoSchema = z.strictObject({ operacaoId: uuid() });

const selecaoLancamento = {
  id: true, operacaoId: true, jogoId: true, tipo: true, relatorioDisciplinar: true, valor: true, registradoEm: true, participacaoId: true,
  substituiLancamentoId: true, anuladoEm: true, substituidoPor: { select: { id: true } },
  participacao: { select: { inscricaoClubeId: true, numeroCamisa: true, atleta: { select: { usuario: { select: { id: true, nomeCompleto: true } } } } } },
} satisfies Prisma.LancamentoJogoSelect;
type LinhaLancamento = Prisma.LancamentoJogoGetPayload<{ select: typeof selecaoLancamento }>;

/** Lançamento com o histórico da correção: anulados continuam listados, indicando quando e por qual substituto. */
function apresentar(l: LinhaLancamento) {
  return {
    id: l.id, operacaoId: l.operacaoId, tipo: l.tipo, relatorioDisciplinar: l.relatorioDisciplinar, valor: l.valor, registradoEm: l.registradoEm,
    participacaoId: l.participacaoId, inscricaoId: l.participacao?.inscricaoClubeId ?? null,
    atleta: l.participacao?.atleta.usuario ?? null, numeroCamisa: l.participacao?.numeroCamisa ?? null,
    substituiLancamentoId: l.substituiLancamentoId, anuladoEm: l.anuladoEm, substituidoPorId: l.substituidoPor?.id ?? null,
  };
}

/** Placar do jogo pela projeção `EstatisticasDoJogo`; null antes do início (RN-033). Também usado no encerramento (MAR-69). */
export async function placar(tx: Tx, jogoId: string) {
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
const lerPorAnulacao = (tx: Tx, anulacaoOperacaoId: string) => tx.lancamentoJogo.findUnique({ where: { anulacaoOperacaoId }, select: selecaoLancamento });
const lerPorId = (tx: Tx, id: string) => tx.lancamentoJogo.findUniqueOrThrow({ where: { id }, select: selecaoLancamento });
const operacaoUsada = () => new ConflictException("operacaoId já usado em outro lançamento. Gere um novo identificador para uma nova ocorrência.");

/** Serializa o mesmo identificador entre registro, correção e anulação, que usam colunas UNIQUE distintas. */
async function bloquearOperacao(tx: Tx, operacaoId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${operacaoId}::text, 70070))::text`;
}

/**
 * Reenvio da mesma operação: o registro existente é devolvido com `alterado: false`. Conteúdo diferente com o
 * mesmo identificador (outro jogo, tipo ou participação) é conflito e nunca sobrescreve o original.
 */
async function repeticao(tx: Tx, jogoId: string, dados: z.infer<typeof lancamentoSchema>) {
  const existente = await lerPorOperacao(tx, dados.operacaoId);
  if (!existente) return null;
  if (existente.jogoId !== jogoId || existente.tipo !== dados.tipo || existente.participacaoId !== dados.participacaoId
    || existente.relatorioDisciplinar !== dados.relatorioDisciplinar || existente.substituiLancamentoId) {
    throw operacaoUsada();
  }
  return { lancamento: apresentar(existente), alterado: false, placar: await placar(tx, jogoId) };
}

/**
 * Arbitragem autorizada registra gol ou penalidade do atleta credenciado com o jogo em andamento (RF-031/032,
 * RN-032/033). Ordem dos bloqueios: jogo → arbitragem → sessão (revalidação) → operação → participação (FOR SHARE) →
 * inserção, cujo trigger repete as regras com os mesmos bloqueios. Lançamentos simultâneos de operações
 * diferentes são todos preservados; a mesma operação enviada em paralelo grava uma vez (`ON CONFLICT`).
 * Placar e desempenho são lidos das projeções na mesma transação, já com o lançamento.
 */
export async function registrarLancamento(tx: Tx, jogoId: string, token: string | undefined, entrada: DadosLancamento) {
  const dados = normalizar(entrada);
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  await bloquearOperacao(tx, dados.operacaoId);
  const anterior = await repeticao(tx, jogoId, dados);
  if (anterior) return anterior;
  if (await lerPorAnulacao(tx, dados.operacaoId)) throw operacaoUsada();
  if (status !== "em_andamento") throw new ConflictException("Gols e penalidades são registrados somente com o jogo em andamento.");
  await exigirJogoSemInterrupcao(tx, jogoId, "registrar gols ou penalidades");
  await exigirCredenciada(tx, jogoId, dados.participacaoId);

  const inseridos = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "LancamentoJogo" (id, "operacaoId", "jogoId", "participacaoId", tipo, "relatorioDisciplinar", valor, "registradoEm")
    VALUES (gen_random_uuid(), ${dados.operacaoId}::uuid, ${jogoId}::uuid, ${dados.participacaoId}::uuid, ${dados.tipo}::"TipoLancamento",
      ${dados.relatorioDisciplinar}::boolean, 1, now())
    ON CONFLICT ("operacaoId") DO NOTHING
    RETURNING id`;
  if (inseridos.length === 0) {
    // A mesma operação gravada por outra requisição simultânea, já confirmada.
    const concorrente = await repeticao(tx, jogoId, dados);
    if (concorrente) return concorrente;
    throw new ConflictException("O lançamento mudou durante a operação. Consulte os registros e tente novamente.");
  }
  const lancamento = await lerPorOperacao(tx, dados.operacaoId);
  await registrarEvento(tx, jogoId, "lancamento_registrado", lancamento!.id);
  return { lancamento: apresentar(lancamento!), alterado: true, placar: await placar(tx, jogoId) };
}

/** Participação credenciada do jogo, com bloqueio compartilhado contra o estorno do credenciamento (MAR-71). */
async function exigirCredenciada(tx: Tx, jogoId: string, participacaoId: string) {
  const [participacao] = await tx.$queryRaw<{ credenciado: boolean }[]>`
    SELECT "credenciadoEm" IS NOT NULL AS credenciado FROM "Participacao"
    WHERE id = ${participacaoId}::uuid AND "jogoId" = ${jogoId}::uuid FOR SHARE`;
  if (!participacao) throw new NotFoundException("Participação não encontrada neste jogo.");
  if (!participacao.credenciado) throw new ConflictException("Somente atleta credenciado neste jogo recebe gols ou penalidades.");
}

/** Quem corrige: a arbitragem autorizada com o jogo em andamento ou o presidente com o jogo finalizado (RF-034/036, RN-031). */
type Corretor = "arbitragem" | "presidente";

/** Status exigido de cada corretor; o banco aceita os dois e a API separa as permissões. */
function exigirStatus(corretor: Corretor, status: string) {
  if (corretor === "arbitragem" && status !== "em_andamento") {
    throw new ConflictException("A arbitragem corrige lançamentos somente com o jogo em andamento.");
  }
  if (corretor === "presidente" && status !== "finalizado") {
    throw new ConflictException("O presidente corrige lançamentos somente após o encerramento do jogo; durante a partida, quem corrige é a arbitragem.");
  }
}

/** Status do jogo para o presidente, com o mesmo bloqueio compartilhado do jogo usado pela arbitragem. */
async function statusParaPresidente(tx: Tx, jogoId: string) {
  const [jogo] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "Jogo" WHERE id = ${jogoId}::uuid FOR SHARE`;
  if (!jogo) throw new NotFoundException("Jogo não encontrado.");
  return jogo.status;
}

/**
 * Bloqueia o lançamento a corrigir ou anular (FOR UPDATE): de duas operações simultâneas sobre o mesmo
 * lançamento, a segunda aguarda e o encontra já anulado. Lançamento de outro jogo é tratado como inexistente.
 */
async function bloquearLancamento(tx: Tx, jogoId: string, lancamentoId: string) {
  const [linha] = await tx.$queryRaw<{ anulacaoOperacaoId: string | null }[]>`
    SELECT "anulacaoOperacaoId" FROM "LancamentoJogo" WHERE id = ${lancamentoId}::uuid AND "jogoId" = ${jogoId}::uuid FOR UPDATE`;
  if (!linha) throw new NotFoundException("Lançamento não encontrado neste jogo.");
  return linha;
}

/**
 * Segunda correção ou anulação do mesmo lançamento (seção 11, PEN-023): recusada sem sobrescrever, com o registro
 * atualizado (já anulado e, se corrigido, o substituto) para uma nova decisão.
 */
async function conflitoAnulado(tx: Tx, lancamentoId: string) {
  const lancamento = await lerPorId(tx, lancamentoId);
  const substituto = lancamento.substituidoPor ? await lerPorId(tx, lancamento.substituidoPor.id) : null;
  return new ConflictException({
    statusCode: 409, error: "Conflict",
    message: "Este lançamento já foi corrigido ou anulado. Consulte o registro atualizado e, se necessário, corrija o lançamento vigente.",
    lancamento: apresentar(lancamento), substituto: substituto && apresentar(substituto),
  });
}

/** Reenvio da mesma correção: devolve o substituto já gravado. Mesmo identificador com outro conteúdo é conflito. */
async function repeticaoCorrecao(tx: Tx, jogoId: string, lancamentoId: string, dados: z.infer<typeof correcaoSchema>) {
  const existente = await lerPorOperacao(tx, dados.operacaoId);
  if (!existente) {
    if (await lerPorAnulacao(tx, dados.operacaoId)) throw operacaoUsada();
    return null;
  }
  if (existente.jogoId !== jogoId || existente.substituiLancamentoId !== lancamentoId || existente.tipo !== dados.tipo
    || existente.participacaoId !== dados.participacaoId || existente.relatorioDisciplinar !== dados.relatorioDisciplinar) {
    throw operacaoUsada();
  }
  return { lancamento: apresentar(existente), anulado: apresentar(await lerPorId(tx, lancamentoId)), alterado: false, placar: await placar(tx, jogoId) };
}

/**
 * Correção (RF-034/036, RN-034, MAR-70): na mesma transação anula o lançamento e cria o substituto, com outro tipo,
 * atleta credenciado do mesmo jogo e/ou relatório disciplinar do vermelho (MAR-79); `valor` continua 1 (MAR-68). O original não muda nem é
 * apagado. Bloqueios: jogo (na autorização) → operação → lançamento (FOR UPDATE) → participação (FOR SHARE).
 */
async function corrigir(tx: Tx, corretor: Corretor, status: string, jogoId: string, lancamentoId: string, dados: z.infer<typeof correcaoSchema>) {
  await bloquearOperacao(tx, dados.operacaoId);
  const anterior = await repeticaoCorrecao(tx, jogoId, lancamentoId, dados);
  if (anterior) return anterior;
  exigirStatus(corretor, status);
  const bloqueado = await bloquearLancamento(tx, jogoId, lancamentoId);
  if (bloqueado.anulacaoOperacaoId) {
    // A mesma correção confirmada por outra requisição simultânea é reenvio; qualquer outra é conflito.
    if (bloqueado.anulacaoOperacaoId === dados.operacaoId) {
      const concorrente = await repeticaoCorrecao(tx, jogoId, lancamentoId, dados);
      if (concorrente) return concorrente;
    }
    throw await conflitoAnulado(tx, lancamentoId);
  }
  const original = await lerPorId(tx, lancamentoId);
  if (original.tipo === dados.tipo && original.participacaoId === dados.participacaoId && original.relatorioDisciplinar === dados.relatorioDisciplinar) {
    throw new BadRequestException("A correção deve alterar o tipo, o atleta ou o relatório disciplinar. Para retirar o lançamento, use a anulação.");
  }
  await exigirCredenciada(tx, jogoId, dados.participacaoId);

  await tx.$executeRaw`
    UPDATE "LancamentoJogo" SET "anuladoEm" = now(), "anulacaoOperacaoId" = ${dados.operacaoId}::uuid
    WHERE id = ${lancamentoId}::uuid AND "anuladoEm" IS NULL`;
  await tx.$executeRaw`
    INSERT INTO "LancamentoJogo" (id, "operacaoId", "jogoId", "participacaoId", tipo, "relatorioDisciplinar", valor, "registradoEm", "substituiLancamentoId")
    VALUES (gen_random_uuid(), ${dados.operacaoId}::uuid, ${jogoId}::uuid, ${dados.participacaoId}::uuid, ${dados.tipo}::"TipoLancamento",
      ${dados.relatorioDisciplinar}::boolean, 1, now(), ${lancamentoId}::uuid)`;
  const substituto = await lerPorOperacao(tx, dados.operacaoId);
  await registrarEvento(tx, jogoId, "lancamento_corrigido", substituto!.id);
  return { lancamento: apresentar(substituto!), anulado: apresentar(await lerPorId(tx, lancamentoId)), alterado: true, placar: await placar(tx, jogoId) };
}

/** Reenvio da mesma anulação: devolve o lançamento já anulado por ela. Identificador de outra operação é conflito. */
async function repeticaoAnulacao(tx: Tx, jogoId: string, lancamentoId: string, operacaoId: string) {
  const existente = await lerPorAnulacao(tx, operacaoId);
  if (!existente) {
    if (await lerPorOperacao(tx, operacaoId)) throw operacaoUsada();
    return null;
  }
  if (existente.jogoId !== jogoId || existente.id !== lancamentoId || existente.substituidoPor) throw operacaoUsada();
  return { lancamento: apresentar(existente), alterado: false, placar: await placar(tx, jogoId) };
}

/** Anulação (exclusão lógica, RN-034, MAR-70): o lançamento continua gravado e deixa de contar nas projeções. */
async function anular(tx: Tx, corretor: Corretor, status: string, jogoId: string, lancamentoId: string, { operacaoId }: z.infer<typeof anulacaoSchema>) {
  await bloquearOperacao(tx, operacaoId);
  const anterior = await repeticaoAnulacao(tx, jogoId, lancamentoId, operacaoId);
  if (anterior) return anterior;
  exigirStatus(corretor, status);
  const bloqueado = await bloquearLancamento(tx, jogoId, lancamentoId);
  if (bloqueado.anulacaoOperacaoId) {
    if (bloqueado.anulacaoOperacaoId === operacaoId) {
      const concorrente = await repeticaoAnulacao(tx, jogoId, lancamentoId, operacaoId);
      if (concorrente) return concorrente;
    }
    throw await conflitoAnulado(tx, lancamentoId);
  }
  await tx.$executeRaw`
    UPDATE "LancamentoJogo" SET "anuladoEm" = now(), "anulacaoOperacaoId" = ${operacaoId}::uuid
    WHERE id = ${lancamentoId}::uuid AND "anuladoEm" IS NULL`;
  await registrarEvento(tx, jogoId, "lancamento_anulado", lancamentoId);
  return { lancamento: apresentar(await lerPorId(tx, lancamentoId)), alterado: true, placar: await placar(tx, jogoId) };
}

/** Arbitragem autorizada corrige ou anula durante o jogo (RF-034); a sessão é revalidada na transação. */
export async function corrigirPelaArbitragem(tx: Tx, jogoId: string, token: string | undefined, lancamentoId: string, dados: DadosLancamento) {
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  return corrigir(tx, "arbitragem", status, jogoId, lancamentoId, normalizar(dados));
}

export async function anularPelaArbitragem(tx: Tx, jogoId: string, token: string | undefined, lancamentoId: string, dados: z.infer<typeof anulacaoSchema>) {
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  return anular(tx, "arbitragem", status, jogoId, lancamentoId, dados);
}

/**
 * Presidente corrige ou anula após o encerramento, diretamente, sem devolver acesso à arbitragem (RF-036, RN-031).
 * Não inclui lançamentos novos (decisão de Marcus, MAR-70) nem refaz o cumprimento de suspensões do encerramento.
 * Na mesma transação, reconcilia as suspensões automáticas do jogo (MAR-79): a desqualificação com relatório
 * retirada anula a automática, liberando só o saldo restante; a acrescentada gera uma nova, para os próximos jogos.
 */
export async function corrigirPeloPresidente(tx: Tx, jogoId: string, lancamentoId: string, dados: DadosLancamento) {
  const resultado = await corrigir(tx, "presidente", await statusParaPresidente(tx, jogoId), jogoId, lancamentoId, normalizar(dados));
  return { ...resultado, suspensoesAutomaticas: await reconciliarSuspensoesAutomaticas(tx, jogoId) };
}

export async function anularPeloPresidente(tx: Tx, jogoId: string, lancamentoId: string, dados: z.infer<typeof anulacaoSchema>) {
  const resultado = await anular(tx, "presidente", await statusParaPresidente(tx, jogoId), jogoId, lancamentoId, dados);
  return { ...resultado, suspensoesAutomaticas: await reconciliarSuspensoesAutomaticas(tx, jogoId) };
}

/**
 * Registros do jogo para a arbitragem autorizada: placar (null antes do início), desempenho de cada atleta
 * credenciado (projeção `DesempenhoDoAtleta`, zeros sem lançamentos) e os lançamentos em ordem de registro.
 */
export async function consultarLancamentos(tx: Tx, jogoId: string, token: string | undefined) {
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  return registrosDoJogo(tx, jogoId, status);
}

/** Os mesmos registros para o presidente, em qualquer status do jogo, inclusive após o encerramento (MAR-70). */
export async function consultarLancamentosPeloPresidente(tx: Tx, jogoId: string) {
  return registrosDoJogo(tx, jogoId, await statusParaPresidente(tx, jogoId));
}

/** Anulados continuam na lista, com `anuladoEm` e o substituto, mas ficam fora do placar e do desempenho. */
async function registrosDoJogo(tx: Tx, jogoId: string, status: string) {
  // Uma instrução compartilha o snapshot entre lista e projeções, sem mudar o isolamento da autorização.
  const [registros] = await tx.$queryRaw<{
    placar: Awaited<ReturnType<typeof placar>>;
    desempenho: {
      participacaoId: string; inscricaoId: string; atleta: { id: string; nomeCompleto: string }; numeroCamisa: number;
      temp_gols: number; temp_cartoesAmarelos: number; temp_exclusoesDoisMinutos: number; temp_cartoesVermelhos: number;
    }[];
    lancamentos: (Omit<ReturnType<typeof apresentar>, "registradoEm" | "anuladoEm"> & { registradoEm: string; anuladoEm: string | null })[];
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
        SELECT l.id, l."operacaoId", l.tipo, l."relatorioDisciplinar", l.valor, l."registradoEm", l."participacaoId",
          p."inscricaoClubeId" AS "inscricaoId", p."numeroCamisa",
          CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('id', u.id, 'nomeCompleto', u."nomeCompleto") END AS atleta,
          l."substituiLancamentoId", l."anuladoEm", s.id AS "substituidoPorId"
        FROM "LancamentoJogo" l
        LEFT JOIN "Participacao" p ON p.id = l."participacaoId" LEFT JOIN "Usuario" u ON u.id = p."atletaId"
        LEFT JOIN "LancamentoJogo" s ON s."substituiLancamentoId" = l.id
        WHERE l."jogoId" = ${jogoId}::uuid
      ) l) AS lancamentos`;
  return {
    jogo: { id: jogoId, status },
    placar: registros.placar,
    desempenho: registros.desempenho,
    lancamentos: registros.lancamentos.map(l => ({ ...l, registradoEm: new Date(l.registradoEm), anuladoEm: l.anuladoEm === null ? null : new Date(l.anuladoEm) })),
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
