import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type StatusCampeonato, type StatusJogo } from "../../generated/prisma/client.js";

const texto = (max: number) => z.string().trim().min(1).max(max);
const data = z.iso.date().nullable();
const uuid = z.uuid().transform(id => id.toLowerCase());

/**
 * Campos mínimos (PEN-008): nome, edição e uma categoria textual, sem validação de idade/sexo.
 * Datas (AAAA-MM-DD) são opcionais e informativas: não mudam o status.
 */
export const novoCampeonatoSchema = z.strictObject({
  nome: z.string().trim().min(2).max(120),
  edicao: texto(60),
  categoria: texto(60),
  inicio: data.optional(),
  fim: data.optional(),
}).refine(({ inicio, fim }) => !inicio || !fim || fim >= inicio, { message: "fim não pode anteceder inicio", path: ["fim"] });

export const inscricaoSchema = z.strictObject({ clubeId: uuid });

type Tx = Prisma.TransactionClient;
type Leitura = Pick<Tx, "campeonato" | "jogo">;

const paraData = (valor: string | null | undefined) => valor ? new Date(`${valor}T00:00:00Z`) : valor;
const formatarData = (valor: Date | null) => valor ? valor.toISOString().slice(0, 10) : null;

const selecaoCampeonato = {
  id: true, nome: true, edicao: true, categoria: true, inicio: true, fim: true, status: true, criadoPorPresidenteId: true,
  inscricoes: {
    select: { id: true, incluidaPorPresidenteId: true, incluidaEm: true, clube: { select: { id: true, nome: true, cidade: true } } },
    orderBy: [{ incluidaEm: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.CampeonatoSelect;

const statusJogo: StatusJogo[] = ["agendado", "em_andamento", "finalizado", "cancelado"];

/** Campeonato com as inscrições e a contagem de jogos por status. */
export async function detalharCampeonato(db: Leitura, campeonatoId: string) {
  const campeonato = await db.campeonato.findUnique({ where: { id: campeonatoId }, select: selecaoCampeonato });
  if (!campeonato) throw new NotFoundException("Campeonato não encontrado");
  const contagem = await db.jogo.groupBy({ by: ["status"], where: { campeonatoId }, _count: { _all: true } });
  const jogos = Object.fromEntries(statusJogo.map(status => [status, contagem.find(c => c.status === status)?._count._all ?? 0]));
  return { ...campeonato, inicio: formatarData(campeonato.inicio), fim: formatarData(campeonato.fim), jogos };
}

export async function listarCampeonatos(db: Pick<Tx, "campeonato">) {
  const campeonatos = await db.campeonato.findMany({
    select: { id: true, nome: true, edicao: true, categoria: true, inicio: true, fim: true, status: true, _count: { select: { inscricoes: true } } },
    orderBy: [{ inicio: { sort: "desc", nulls: "first" } }, { nome: "asc" }, { id: "asc" }],
  });
  return campeonatos.map(({ _count, inicio, fim, ...dados }) => ({ ...dados, inicio: formatarData(inicio), fim: formatarData(fim), inscricoes: _count.inscricoes }));
}

export async function criarCampeonato(tx: Tx, presidenteId: string, { inicio, fim, ...dados }: z.infer<typeof novoCampeonatoSchema>) {
  const { id } = await tx.campeonato.create({ data: { ...dados, inicio: paraData(inicio), fim: paraData(fim), criadoPorPresidenteId: presidenteId }, select: { id: true } });
  return detalharCampeonato(tx, id);
}

/**
 * Serializa as operações administrativas do mesmo campeonato (lock da linha), inclusive o agendamento
 * de jogos (MAR-62). Inscrições e jogos
 * também bloqueiam essa linha nos triggers da migração `campeonatos`.
 */
export async function bloquearCampeonato(tx: Tx, campeonatoId: string): Promise<StatusCampeonato> {
  const [linha] = await tx.$queryRaw<{ status: StatusCampeonato }[]>`SELECT status FROM "Campeonato" WHERE id = ${campeonatoId}::uuid FOR UPDATE`;
  if (!linha) throw new NotFoundException("Campeonato não encontrado");
  return linha.status;
}

function exigirPlanejado(status: StatusCampeonato) {
  if (status !== "planejado") throw new ConflictException("Inscrições só podem ser incluídas ou retiradas com o campeonato planejado.");
}

export async function inscreverClube(tx: Tx, campeonatoId: string, presidenteId: string, { clubeId }: z.infer<typeof inscricaoSchema>) {
  exigirPlanejado(await bloquearCampeonato(tx, campeonatoId));
  if (!await tx.clube.findUnique({ where: { id: clubeId }, select: { id: true } })) throw new NotFoundException("Clube não encontrado");
  if (await tx.inscricaoClube.findUnique({ where: { campeonatoId_clubeId: { campeonatoId, clubeId } }, select: { id: true } })) {
    throw new ConflictException("O clube já está inscrito neste campeonato.");
  }
  await tx.inscricaoClube.create({ data: { campeonatoId, clubeId, incluidaPorPresidenteId: presidenteId } });
  return detalharCampeonato(tx, campeonatoId);
}

/** Retirada somente com o campeonato planejado e sem jogos da inscrição; o clube não é alterado. */
export async function retirarInscricao(tx: Tx, campeonatoId: string, inscricaoId: string) {
  exigirPlanejado(await bloquearCampeonato(tx, campeonatoId));
  const inscricao = await tx.inscricaoClube.findFirst({ where: { id: inscricaoId, campeonatoId }, select: { id: true } });
  if (!inscricao) throw new NotFoundException("Inscrição não encontrada neste campeonato");
  if (await tx.jogo.count({ where: { OR: [{ inscricaoClubeAId: inscricaoId }, { inscricaoClubeBId: inscricaoId }] } }) > 0) {
    throw new ConflictException("A inscrição possui jogos e não pode ser retirada.");
  }
  await tx.inscricaoClube.delete({ where: { id: inscricaoId } });
  return detalharCampeonato(tx, campeonatoId);
}

export type Transicao = "iniciar" | "encerrar" | "cancelar";
const destino: Record<Transicao, StatusCampeonato> = { iniciar: "em_andamento", encerrar: "encerrado", cancelar: "cancelado" };
const origens: Record<Transicao, StatusCampeonato[]> = { iniciar: ["planejado"], encerrar: ["em_andamento"], cancelar: ["planejado", "em_andamento"] };

/**
 * Ciclo manual (requisitos, seção 11). Repetir a transição já aplicada, inclusive em pedido
 * simultâneo, não repete efeitos: devolve o estado atual com `alterado: false`.
 */
export async function transicionarCampeonato(tx: Tx, campeonatoId: string, transicao: Transicao) {
  const atual = await bloquearCampeonato(tx, campeonatoId);
  if (atual === destino[transicao]) return { campeonato: await detalharCampeonato(tx, campeonatoId), alterado: false };
  if (!origens[transicao].includes(atual)) throw new ConflictException(`Campeonato ${atual.replace("_", " ")} não pode ser ${{ iniciar: "iniciado", encerrar: "encerrado", cancelar: "cancelado" }[transicao]}.`);

  if (transicao === "iniciar" && await tx.inscricaoClube.count({ where: { campeonatoId } }) < 2) {
    throw new ConflictException("Iniciar o campeonato exige ao menos dois clubes inscritos.");
  }
  if (transicao === "encerrar" && await tx.jogo.count({ where: { campeonatoId, status: { in: ["agendado", "em_andamento"] } } }) > 0) {
    throw new ConflictException("Encerrar o campeonato exige todos os jogos finalizados ou cancelados.");
  }
  if (transicao === "cancelar") {
    if (await tx.jogo.count({ where: { campeonatoId, status: "em_andamento" } }) > 0) {
      throw new ConflictException("O campeonato possui jogo em andamento e não pode ser cancelado.");
    }
    await tx.jogo.updateMany({ where: { campeonatoId, status: "agendado" }, data: { status: "cancelado" } });
  }
  // Integrações futuras, na mesma transação, antes de declarar o fluxo integrado: encerrar/cancelar
  // encerra saldos de suspensão do campeonato (MAR-66/MAR-79) e o cancelamento dos jogos agendados
  // revoga seus acessos de arbitragem (MAR-65); notificações após a persistência ficam na MAR-73.
  await tx.campeonato.update({ where: { id: campeonatoId }, data: { status: destino[transicao] } });
  return { campeonato: await detalharCampeonato(tx, campeonatoId), alterado: true };
}

/** Restrições do banco (inscrição duplicada, inscrição com jogos, transição recusada pelo trigger) chegam como 409. */
export function traduzirErroCampeonato(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictException("O clube já está inscrito neste campeonato.");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    return new ConflictException("Operação recusada: há registros vinculados. Consulte o campeonato e tente novamente.");
  }
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo === "23505") return new ConflictException("O clube já está inscrito neste campeonato.");
  if (codigo === "23503" || codigo === "23514") return new ConflictException("Operação recusada por conflito com o estado atual do campeonato. Consulte-o e tente novamente.");
  return error;
}
