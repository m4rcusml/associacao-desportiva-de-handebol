import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type StatusCampeonato, type StatusJogo } from "../../generated/prisma/client.js";

const uuid = z.uuid().transform(id => id.toLowerCase());

/** Suspensão manual (RF-038): quantidade positiva de jogos e motivo. Sem redução parcial (PEN-009). */
export const novaSuspensaoSchema = z.strictObject({
  atletaId: uuid,
  quantidadeJogos: z.int32().positive(),
  motivo: z.string().trim().min(1).max(500),
});

export const filtroSuspensoesSchema = z.strictObject({ atletaId: uuid.optional() });

type Tx = Prisma.TransactionClient;

/**
 * Situação derivada, nunca armazenada: `vigente` impede o atleta no campeonato (RF-040); `cumprida` atingiu a
 * quantidade de jogos; `revogada` pelo presidente; `saldo_encerrado` com o término/cancelamento do campeonato.
 */
export type SituacaoSuspensao = "vigente" | "cumprida" | "revogada" | "saldo_encerrado";

const pessoa = { select: { usuario: { select: { id: true, nomeCompleto: true } } } } as const;
const selecaoSuspensao = {
  id: true, campeonatoId: true, quantidadeJogos: true, motivo: true, aplicadaEm: true, revogadaEm: true, saldoEncerradoEm: true,
  atleta: pessoa, aplicadaPor: pessoa, revogadaPor: pessoa,
  cumprimentos: { select: { jogoId: true, registradoEm: true }, orderBy: [{ registradoEm: "asc" }, { jogoId: "asc" }] },
} satisfies Prisma.SuspensaoSelect;
type LinhaSuspensao = Prisma.SuspensaoGetPayload<{ select: typeof selecaoSuspensao }>;

function apresentar({ atleta, aplicadaPor, revogadaPor, cumprimentos, ...dados }: LinhaSuspensao) {
  const jogosCumpridos = cumprimentos.length;
  const saldo = Math.max(0, dados.quantidadeJogos - jogosCumpridos);
  const situacao: SituacaoSuspensao = dados.revogadaEm ? "revogada" : dados.saldoEncerradoEm ? "saldo_encerrado" : saldo === 0 ? "cumprida" : "vigente";
  return {
    ...dados, atleta: atleta.usuario, aplicadaPor: aplicadaPor.usuario, revogadaPor: revogadaPor?.usuario ?? null,
    situacao, jogosCumpridos, jogosRestantes: situacao === "vigente" ? saldo : 0, cumprimentos,
  };
}

async function detalharSuspensao(db: Pick<Tx, "suspensao">, campeonatoId: string, suspensaoId: string) {
  const suspensao = await db.suspensao.findFirst({ where: { id: suspensaoId, campeonatoId }, select: selecaoSuspensao });
  if (!suspensao) throw new NotFoundException("Suspensão não encontrada neste campeonato");
  return apresentar(suspensao);
}

/** Suspensões do campeonato, opcionalmente de um atleta, com saldo e jogos cumpridos (RF-041). */
export async function listarSuspensoes(db: Pick<Tx, "campeonato" | "suspensao">, campeonatoId: string, atletaId?: string) {
  if (!await db.campeonato.findUnique({ where: { id: campeonatoId }, select: { id: true } })) throw new NotFoundException("Campeonato não encontrado");
  const suspensoes = await db.suspensao.findMany({
    where: { campeonatoId, ...(atletaId ? { atletaId } : {}) },
    select: selecaoSuspensao,
    orderBy: [{ aplicadaEm: "desc" }, { id: "asc" }],
  });
  return suspensoes.map(apresentar);
}

/**
 * Atletas, entre os informados, com suspensão vigente no campeonato: não revogada, sem saldo encerrado e com
 * jogos a cumprir. É o impedimento disciplinar do credenciamento (RF-040, RN-016); a escalação apenas sinaliza.
 * Para decidir um credenciamento, o chamador bloqueia antes a linha `Usuario` do atleta (FOR SHARE), de modo
 * que uma aplicação concorrente (FOR UPDATE) aguarde ou já seja vista.
 */
export async function atletasComSuspensaoVigente(db: Pick<Tx, "$queryRaw">, campeonatoId: string, atletaIds: string[]): Promise<Set<string>> {
  if (atletaIds.length === 0) return new Set();
  const linhas = await db.$queryRaw<{ atletaId: string }[]>`
    SELECT DISTINCT s."atletaId" FROM "Suspensao" s
    WHERE s."campeonatoId" = ${campeonatoId}::uuid AND s."atletaId" = ANY(${atletaIds}::uuid[])
      AND s."revogadaEm" IS NULL AND s."saldoEncerradoEm" IS NULL
      AND (SELECT count(*) FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id) < s."quantidadeJogos"`;
  return new Set(linhas.map(l => l.atletaId));
}

/**
 * Presidente aplica suspensão manual a atleta aprovado (conta ativa ou desativada) em campeonato planejado ou em
 * andamento; o clube atual não precisa estar inscrito (decisão de Marcus, MAR-66). Suspensões simultâneas
 * coexistem e são cumpridas em paralelo (RN-043). Ordem dos bloqueios: campeonato (FOR SHARE: encerramento
 * concorrente aguarda) → conta do atleta (FOR UPDATE: credenciamento e cumprimento concorrentes aguardam ou já
 * veem a suspensão). `aplicadaEm` é lido depois dos bloqueios: jogo encerrado antes não a cumpre, e o jogo em que
 * o atleta já estava credenciado é preservado (PEN-011).
 */
export async function aplicarSuspensao(tx: Tx, campeonatoId: string, presidenteId: string, dados: z.infer<typeof novaSuspensaoSchema>) {
  const [campeonato] = await tx.$queryRaw<{ status: StatusCampeonato }[]>`SELECT status FROM "Campeonato" WHERE id = ${campeonatoId}::uuid FOR SHARE`;
  if (!campeonato) throw new NotFoundException("Campeonato não encontrado");
  if (!["planejado", "em_andamento"].includes(campeonato.status)) {
    throw new ConflictException(`Suspensão só é aplicada em campeonato planejado ou em andamento (campeonato ${campeonato.status.replace("_", " ")}).`);
  }
  const [conta] = await tx.$queryRaw<{ perfil: string }[]>`SELECT perfil::text AS perfil FROM "Usuario" WHERE id = ${dados.atletaId}::uuid FOR UPDATE`;
  if (conta?.perfil !== "atleta") throw new NotFoundException("Atleta não encontrado");
  const atleta = await tx.atleta.findUnique({ where: { usuarioId: dados.atletaId }, select: { statusVerificacao: true } });
  if (atleta?.statusVerificacao !== "aprovado") throw new ConflictException("Somente atleta aprovado pode ser suspenso.");

  const { id } = await tx.suspensao.create({
    data: { ...dados, campeonatoId, aplicadaPorPresidenteId: presidenteId, aplicadaEm: new Date() },
    select: { id: true },
  });
  return detalharSuspensao(tx, campeonatoId, id);
}

/**
 * Presidente revoga suspensão vigente, preservando aplicação e cumprimentos (PEN-009 parcial: sem redução
 * parcial nem justificativa obrigatória). Repetir devolve `alterado: false`; suspensão cumprida ou com saldo
 * encerrado não é revogada.
 */
export async function revogarSuspensao(tx: Tx, campeonatoId: string, suspensaoId: string, presidenteId: string) {
  await tx.$queryRaw`
    SELECT id FROM "Suspensao" WHERE id = ${suspensaoId}::uuid AND "campeonatoId" = ${campeonatoId}::uuid FOR UPDATE`;
  // Uma instrução nova enxerga o último cumprimento confirmado enquanto o bloqueio era aguardado.
  const [linha] = await tx.$queryRaw<{ revogada: boolean; encerrada: boolean; cumprida: boolean }[]>`
    SELECT s."revogadaEm" IS NOT NULL AS revogada, s."saldoEncerradoEm" IS NOT NULL AS encerrada,
      (SELECT count(*) FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id) >= s."quantidadeJogos" AS cumprida
    FROM "Suspensao" s WHERE s.id = ${suspensaoId}::uuid AND s."campeonatoId" = ${campeonatoId}::uuid`;
  if (!linha) throw new NotFoundException("Suspensão não encontrada neste campeonato");
  if (linha.revogada) return { suspensao: await detalharSuspensao(tx, campeonatoId, suspensaoId), alterado: false };
  if (linha.encerrada) throw new ConflictException("O saldo desta suspensão já foi encerrado com o campeonato.");
  if (linha.cumprida) throw new ConflictException("A suspensão já foi cumprida e não pode ser revogada.");
  await tx.suspensao.update({ where: { id: suspensaoId }, data: { revogadaEm: new Date(), revogadaPorPresidenteId: presidenteId } });
  return { suspensao: await detalharSuspensao(tx, campeonatoId, suspensaoId), alterado: true };
}

/**
 * Encerra o saldo das suspensões vigentes quando o campeonato é encerrado ou cancelado (PEN-010), na mesma
 * transação da transição e depois de gravar o novo status. Não transporta saldo para outro campeonato; o
 * registro é distinto de cumprimento e de revogação. Devolve quantas suspensões tiveram o saldo encerrado.
 */
export async function encerrarSaldosDoCampeonato(tx: Tx, campeonatoId: string) {
  const agora = new Date();
  return tx.$executeRaw`
    UPDATE "Suspensao" s SET "saldoEncerradoEm" = ${agora}
    WHERE s."campeonatoId" = ${campeonatoId}::uuid AND s."revogadaEm" IS NULL AND s."saldoEncerradoEm" IS NULL
      AND (SELECT count(*) FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id) < s."quantidadeJogos"`;
}

/**
 * Registra os cumprimentos do jogo finalizado (RF-041, RN-039/040/043) para o encerramento do jogo (MAR-69/MAR-72),
 * na mesma transação. Cada suspensão vigente do campeonato, de atleta com vínculo no encerramento com um dos
 * clubes do jogo e aplicada antes do encerramento, recebe este jogo uma vez — mesmo sem escalação ou
 * credenciamento —, exceto se o atleta já estava credenciado nele antes da aplicação (jogo preservado, PEN-011).
 * Idempotente: repetir, inclusive em paralelo, não duplica nem ultrapassa a quantidade. Ordem dos bloqueios: jogo
 * (FOR SHARE) → contas dos atletas do clube (FOR SHARE, ordem por id) → suspensões (FOR UPDATE, ordem por id).
 * Devolve os ids das suspensões que receberam o jogo nesta chamada.
 */
export async function registrarCumprimentos(tx: Tx, jogoId: string): Promise<string[]> {
  const [jogo] = await tx.$queryRaw<{ status: StatusJogo; campeonatoId: string; encerradoEm: Date | null }[]>`
    SELECT status, "campeonatoId", "encerradoEm" FROM "Jogo" WHERE id = ${jogoId}::uuid FOR SHARE`;
  if (!jogo) throw new NotFoundException("Jogo não encontrado");
  if (jogo.status !== "finalizado" || !jogo.encerradoEm) throw new ConflictException("Somente jogo finalizado cumpre suspensões.");

  // Todos os atletas com vínculo, no encerramento, com um dos clubes do jogo: uma aplicação concorrente, mesmo
  // a primeira do atleta, aguarda ou já é vista.
  await tx.$queryRaw`
    SELECT u.id FROM "Usuario" u
    WHERE u.id IN (
      SELECT v."atletaId" FROM "VinculoClube" v
        JOIN "InscricaoClube" i ON i."clubeId" = v."clubeId"
        JOIN "Jogo" j ON i.id IN (j."inscricaoClubeAId", j."inscricaoClubeBId")
      WHERE j.id = ${jogoId}::uuid AND v.inicio <= j."encerradoEm" AND (v.fim IS NULL OR v.fim > j."encerradoEm"))
    ORDER BY u.id FOR SHARE`;
  await tx.$queryRaw`
    SELECT s.id FROM "Suspensao" s
    WHERE s."campeonatoId" = ${jogo.campeonatoId}::uuid AND s."revogadaEm" IS NULL AND s."saldoEncerradoEm" IS NULL
    ORDER BY s.id FOR UPDATE`;

  const registradas = await tx.$queryRaw<{ suspensaoId: string }[]>`
    INSERT INTO "CumprimentoSuspensao" ("suspensaoId", "jogoId", "registradoEm")
    SELECT s.id, j.id, ${new Date()} FROM "Suspensao" s
      JOIN "Jogo" j ON j.id = ${jogoId}::uuid AND j."campeonatoId" = s."campeonatoId"
    WHERE s."revogadaEm" IS NULL AND s."saldoEncerradoEm" IS NULL AND s."aplicadaEm" < j."encerradoEm"
      AND (SELECT count(*) FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id) < s."quantidadeJogos"
      AND NOT EXISTS (SELECT 1 FROM "CumprimentoSuspensao" c WHERE c."suspensaoId" = s.id AND c."jogoId" = j.id)
      AND EXISTS (
        SELECT 1 FROM "VinculoClube" v JOIN "InscricaoClube" i ON i."clubeId" = v."clubeId"
        WHERE v."atletaId" = s."atletaId" AND i.id IN (j."inscricaoClubeAId", j."inscricaoClubeBId")
          AND v.inicio <= j."encerradoEm" AND (v.fim IS NULL OR v.fim > j."encerradoEm"))
      AND NOT EXISTS (
        SELECT 1 FROM "Participacao" p WHERE p."jogoId" = j.id AND p."atletaId" = s."atletaId" AND p."credenciadoEm" <= s."aplicadaEm")
    ON CONFLICT ("suspensaoId", "jogoId") DO NOTHING
    RETURNING "suspensaoId"`;
  return registradas.map(r => r.suspensaoId).sort();
}

/** Restrições do banco (campeonato encerrado concorrente, dados alterados) chegam como 409. */
export function traduzirErroSuspensao(error: unknown): unknown {
  const conflito = new ConflictException("Operação recusada por conflito com o estado atual do campeonato, do atleta ou da suspensão. Consulte-os e tente novamente.");
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2025"].includes(error.code)) return conflito;
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo && ["23505", "23503", "23514", "40P01"].includes(codigo)) return conflito;
  return error;
}
