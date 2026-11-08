import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type StatusJogo } from "../../generated/prisma/client.js";
import { bloquearCampeonato } from "../campeonatos/campeonatos.js";
import { fusoValido, horaLocal, instanteLocal } from "./fuso.js";

const uuid = z.uuid().transform(id => id.toLowerCase());

/**
 * Agendamento (RF-015, PEN-021): hora local do início no fuso IANA do local da partida. O backend
 * calcula o instante; o fuso do navegador não participa. `local` é texto opcional.
 */
export const novoJogoSchema = z.strictObject({
  clubeAId: uuid,
  clubeBId: uuid,
  inicioPrevisto: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use AAAA-MM-DDTHH:mm, hora local do fuso informado"),
  fusoHorario: z.string().trim().min(1).max(64),
  local: z.string().trim().min(1).max(160).optional(),
}).refine(({ clubeAId, clubeBId }) => clubeAId !== clubeBId, { message: "Os clubes do jogo devem ser distintos", path: ["clubeBId"] });

/** Designação por conta de atleta/técnico (`usuarioId`) ou de pessoa sem cadastro (`nomeCompleto`). */
export const designacaoSchema = z.union([
  z.strictObject({ usuarioId: uuid }),
  z.strictObject({ nomeCompleto: z.string().trim().min(2).max(120) }),
]);

type Tx = Prisma.TransactionClient;
type Leitura = Pick<Tx, "jogo">;

const clube = { select: { id: true, clube: { select: { id: true, nome: true, cidade: true } } } } as const;
const selecaoJogo = {
  id: true, campeonatoId: true, status: true, local: true, fusoHorario: true, inicioPrevistoEm: true, iniciadoEm: true, encerradoEm: true,
  criadoPorPresidenteId: true, inscricaoClubeA: clube, inscricaoClubeB: clube,
} satisfies Prisma.JogoSelect;
type JogoLido = Prisma.JogoGetPayload<{ select: typeof selecaoJogo }>;

const equipe = ({ id, clube }: JogoLido["inscricaoClubeA"]) => ({ inscricaoId: id, clube });

/** Resumo do jogo: instante UTC e a hora local do fuso da partida (dia do jogo para o acesso). */
function resumirJogo({ inscricaoClubeA, inscricaoClubeB, inicioPrevistoEm, ...jogo }: JogoLido) {
  return {
    ...jogo, clubeA: equipe(inscricaoClubeA), clubeB: equipe(inscricaoClubeB), inicioPrevistoEm,
    inicioPrevistoLocal: inicioPrevistoEm ? horaLocal(inicioPrevistoEm, jogo.fusoHorario) : null,
  };
}

export async function listarJogos(db: Pick<Tx, "jogo" | "campeonato">, campeonatoId: string) {
  if (!await db.campeonato.findUnique({ where: { id: campeonatoId }, select: { id: true } })) throw new NotFoundException("Campeonato não encontrado");
  const jogos = await db.jogo.findMany({ where: { campeonatoId }, select: selecaoJogo, orderBy: [{ inicioPrevistoEm: { sort: "asc", nulls: "last" } }, { id: "asc" }] });
  return jogos.map(resumirJogo);
}

/** Jogo com a arbitragem designada; o nome de conta cadastrada vem de `Usuario`, sempre atual. */
export async function detalharJogo(db: Leitura, jogoId: string) {
  const jogo = await db.jogo.findUnique({ where: { id: jogoId }, select: {
    ...selecaoJogo,
    arbitragens: {
      select: { id: true, nomeCompleto: true, designadoPorPresidenteId: true, designadoEm: true, usuario: { select: { id: true, nomeCompleto: true, perfil: true } } },
      orderBy: [{ designadoEm: "asc" }, { id: "asc" }],
    },
  } });
  if (!jogo) throw new NotFoundException("Jogo não encontrado");
  const { arbitragens, ...dados } = jogo;
  return {
    ...resumirJogo(dados),
    arbitragens: arbitragens.map(({ usuario, nomeCompleto, ...a }) => ({
      ...a, tipo: usuario ? "cadastrado" as const : "externo" as const,
      nomeCompleto: usuario?.nomeCompleto ?? nomeCompleto, usuario,
    })),
  };
}

async function fusoConhecidoPeloBanco(tx: Tx, fuso: string) {
  const [linha] = await tx.$queryRaw<{ existe: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name = ${fuso}) AS existe`;
  return linha.existe;
}

/**
 * Agenda jogo entre dois clubes inscritos no campeonato planejado ou em andamento. Bloqueia a linha
 * do campeonato, serializando com suas transições (MAR-61). Agendar não inicia o jogo nem abre acesso.
 */
export async function agendarJogo(tx: Tx, campeonatoId: string, presidenteId: string, dados: z.infer<typeof novoJogoSchema>) {
  if (!fusoValido(dados.fusoHorario) || !await fusoConhecidoPeloBanco(tx, dados.fusoHorario)) {
    throw new BadRequestException("fusoHorario deve ser um nome IANA válido, como America/Recife.");
  }
  const conversao = instanteLocal(dados.inicioPrevisto, dados.fusoHorario);
  if ("erro" in conversao) {
    throw new BadRequestException({
      invalida: "inicioPrevisto não é uma data/hora válida.",
      inexistente: "inicioPrevisto não existe nesse fuso (mudança de horário de verão).",
      ambigua: "inicioPrevisto é ambíguo nesse fuso (horário repetido na mudança de horário de verão).",
    }[conversao.erro]);
  }

  const status = await bloquearCampeonato(tx, campeonatoId);
  if (status !== "planejado" && status !== "em_andamento") throw new ConflictException(`Campeonato ${status} não recebe novos jogos.`);
  const inscricoes = await tx.inscricaoClube.findMany({ where: { campeonatoId, clubeId: { in: [dados.clubeAId, dados.clubeBId] } }, select: { id: true, clubeId: true } });
  const inscricao = (clubeId: string) => inscricoes.find(i => i.clubeId === clubeId)?.id;
  const [a, b] = [inscricao(dados.clubeAId), inscricao(dados.clubeBId)];
  if (!a || !b) throw new ConflictException("Os dois clubes devem estar inscritos neste campeonato.");

  const { id } = await tx.jogo.create({ data: {
    campeonatoId, inscricaoClubeAId: a, inscricaoClubeBId: b, fusoHorario: dados.fusoHorario, local: dados.local ?? null,
    inicioPrevistoEm: conversao.instante, criadoPorPresidenteId: presidenteId,
  }, select: { id: true } });
  return detalharJogo(tx, id);
}

const statusComArbitragem: StatusJogo[] = ["agendado", "em_andamento"];

/** Bloqueia o jogo (FOR SHARE), serializando com mudanças de status, e devolve status e clubes. */
async function lerJogoParaArbitragem(tx: Tx, jogoId: string) {
  const [jogo] = await tx.$queryRaw<{ status: StatusJogo; clubeA: string; clubeB: string }[]>`
    SELECT j.status, a."clubeId" AS "clubeA", b."clubeId" AS "clubeB"
    FROM "Jogo" j
    JOIN "InscricaoClube" a ON a.id = j."inscricaoClubeAId"
    JOIN "InscricaoClube" b ON b.id = j."inscricaoClubeBId"
    WHERE j.id = ${jogoId}::uuid
    FOR SHARE OF j`;
  if (!jogo) throw new NotFoundException("Jogo não encontrado");
  if (!statusComArbitragem.includes(jogo.status)) throw new ConflictException(`Arbitragem só muda com o jogo agendado ou em andamento (jogo ${jogo.status.replace("_", " ")}).`);
  return jogo;
}

/**
 * Impedimento de clube (RN-025): atleta com vínculo aberto ou técnico atribuído a um dos clubes do jogo.
 * Exportado para a revalidação no acesso por designação (MAR-65).
 */
export async function clubeImpeditivo(db: Pick<Tx, "vinculoClube" | "tecnico">, usuarioId: string, clubes: string[]) {
  const [vinculo, tecnico] = await Promise.all([
    db.vinculoClube.count({ where: { atletaId: usuarioId, fim: null, clubeId: { in: clubes } } }),
    db.tecnico.count({ where: { usuarioId, clubeId: { in: clubes } } }),
  ]);
  return vinculo + tecnico > 0;
}

/**
 * Designa a arbitragem (RF-024). Conta: atleta/técnico aprovado, ativo e sem vínculo com os clubes do
 * jogo, única por jogo. A linha `Usuario` fica bloqueada (FOR SHARE): aprovação, desativação, atribuição
 * de técnico e transferência (FOR UPDATE) aguardam ou já estão visíveis. Externo: somente o nome (RN-026),
 * sem presumir identidade; nomes repetidos são permitidos.
 */
export async function designarArbitragem(tx: Tx, jogoId: string, presidenteId: string, dados: z.infer<typeof designacaoSchema>) {
  const jogo = await lerJogoParaArbitragem(tx, jogoId);
  const designacao = { jogoId, designadoPorPresidenteId: presidenteId, designadoEm: new Date() };

  if ("nomeCompleto" in dados) {
    await tx.arbitragem.create({ data: { ...designacao, nomeCompleto: dados.nomeCompleto } });
    return detalharJogo(tx, jogoId);
  }

  const { usuarioId } = dados;
  const [conta] = await tx.$queryRaw<{ perfil: string; ativo: boolean }[]>`SELECT perfil::text AS perfil, ativo FROM "Usuario" WHERE id = ${usuarioId}::uuid FOR SHARE`;
  if (!conta) throw new NotFoundException("Conta não encontrada");
  if (conta.perfil !== "atleta" && conta.perfil !== "tecnico") throw new ConflictException("Somente atleta ou técnico é designado pelo cadastro; presidente não é designado como árbitro.");
  if (!conta.ativo) throw new ConflictException("A conta está desativada e não pode ser designada.");
  const extensao = conta.perfil === "atleta"
    ? await tx.atleta.findUnique({ where: { usuarioId }, select: { statusVerificacao: true } })
    : await tx.tecnico.findUnique({ where: { usuarioId }, select: { statusVerificacao: true } });
  if (extensao?.statusVerificacao !== "aprovado") throw new ConflictException("Somente conta com cadastro aprovado pode ser designada.");
  if (await clubeImpeditivo(tx, usuarioId, [jogo.clubeA, jogo.clubeB])) {
    throw new ConflictException("Atleta ou técnico de um dos clubes do jogo não pode ser designado para arbitrá-lo.");
  }
  if (await tx.arbitragem.findUnique({ where: { jogoId_usuarioId: { jogoId, usuarioId } }, select: { id: true } })) {
    throw new ConflictException("A conta já está designada para este jogo.");
  }
  await tx.arbitragem.create({ data: { ...designacao, usuarioId } });
  return detalharJogo(tx, jogoId);
}

/** Retira a designação com o jogo agendado ou em andamento. Sessões de arbitragem chegam na MAR-65. */
export async function retirarArbitragem(tx: Tx, jogoId: string, arbitragemId: string) {
  await lerJogoParaArbitragem(tx, jogoId);
  const arbitragem = await tx.arbitragem.findFirst({ where: { id: arbitragemId, jogoId }, select: { id: true } });
  if (!arbitragem) throw new NotFoundException("Arbitragem não encontrada neste jogo");
  // Integração futura (MAR-65), na mesma transação: revogar as sessões dessa designação.
  await tx.arbitragem.delete({ where: { id: arbitragemId } });
  return detalharJogo(tx, jogoId);
}

/** Restrições do banco chegam como 409: designação duplicada simultânea, jogo/campeonato já em outro estado. */
export function traduzirErroJogo(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictException("A conta já está designada para este jogo.");
  }
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo === "23505") return new ConflictException("A conta já está designada para este jogo.");
  if (codigo === "23503" || codigo === "23514") return new ConflictException("Operação recusada por conflito com o estado atual do jogo ou do campeonato. Consulte-o e tente novamente.");
  return error;
}
