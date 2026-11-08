import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";

const uuid = z.uuid().transform(id => id.toLowerCase());

/**
 * Transferência (RF-011). `clubeAtualId` confirma o clube de origem visto por quem pede: duas
 * transferências simultâneas do mesmo atleta não se encadeiam silenciosamente (a segunda recebe 409).
 */
export const transferenciaSchema = z.strictObject({ clubeAtualId: uuid, clubeDestinoId: uuid })
  .refine(({ clubeAtualId, clubeDestinoId }) => clubeAtualId !== clubeDestinoId, { message: "O clube de destino deve ser diferente do atual", path: ["clubeDestinoId"] });

type Tx = Prisma.TransactionClient;

/** Atleta com o histórico de vínculos (RF-012), do mais antigo ao atual (`fim: null`). */
export async function historicoVinculos(db: Pick<Tx, "atleta">, atletaId: string) {
  const atleta = await db.atleta.findUnique({ where: { usuarioId: atletaId }, select: {
    usuarioId: true, statusVerificacao: true, usuario: { select: { nomeCompleto: true, ativo: true } },
    vinculos: {
      select: { id: true, inicio: true, fim: true, definidoPorPresidenteId: true, clube: { select: { id: true, nome: true, cidade: true } } },
      orderBy: [{ inicio: "asc" }, { id: "asc" }],
    },
  } });
  if (!atleta) throw new NotFoundException("Atleta não encontrado");
  const { usuarioId, statusVerificacao, usuario, vinculos } = atleta;
  return {
    atleta: { id: usuarioId, nomeCompleto: usuario.nomeCompleto, ativo: usuario.ativo, statusVerificacao },
    clubeAtual: vinculos.find(v => v.fim === null)?.clube ?? null,
    vinculos,
  };
}

const vinculoAberto = (tx: Tx, atletaId: string) =>
  tx.vinculoClube.findFirst({ where: { atletaId, fim: null }, select: { id: true, clubeId: true } });

/**
 * Transfere o atleta aprovado (com conta ativa ou desativada) do clube atual para outro (RF-011, RN-003/005
 * a 009). Bloqueado enquanto o clube atual participar de campeonato em andamento, inclusive eliminado ou
 * desistente (RN-006, PEN-017). Encerra o vínculo aberto e abre o seguinte no mesmo instante (`now()` da
 * transação): sem sobreposição nem lacuna. Vínculos anteriores não são alterados, então registros que
 * os referenciam continuam apontando para o clube representado na época (RN-008).
 *
 * Ordem dos bloqueios: campeonatos ativos do clube de origem (FOR SHARE) e depois a linha `Usuario` do
 * atleta (FOR UPDATE, convenção da autorização). É a mesma ordem campeonato → conta usada pelos fluxos de
 * jogos, o que evita ciclos de espera; o início concorrente do campeonato (FOR UPDATE) aguarda ou já é
 * visto. O trigger `VinculoClube_alteracao` repete a verificação no banco.
 *
 * Repetir a transferência já aplicada (o atleta já está no destino e veio do clube informado) devolve o
 * histórico com `alterado: false`.
 */
export async function transferirAtleta(tx: Tx, atletaId: string, presidenteId: string, { clubeAtualId, clubeDestinoId }: z.infer<typeof transferenciaSchema>) {
  const visto = await vinculoAberto(tx, atletaId);
  if (!visto) throw new NotFoundException("Atleta não encontrado");
  await bloquearCampeonatosAtivos(tx, visto.clubeId);
  const [conta] = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Usuario" WHERE id = ${atletaId}::uuid FOR UPDATE`;
  if (!conta) throw new NotFoundException("Atleta não encontrado");

  const atleta = await tx.atleta.findUnique({ where: { usuarioId: atletaId }, select: { statusVerificacao: true } });
  if (!atleta) throw new NotFoundException("Atleta não encontrado");
  if (atleta.statusVerificacao !== "aprovado") {
    throw new ConflictException("Somente atleta aprovado pode ser transferido. O clube do cadastro inicial é confirmado na aprovação e não é transferência.");
  }
  const atual = await vinculoAberto(tx, atletaId);
  if (!atual) throw new ConflictException("Atleta sem vínculo atual com clube.");
  if (atual.clubeId === clubeDestinoId) {
    const anterior = await tx.vinculoClube.findFirst({ where: { atletaId, fim: { not: null } }, orderBy: { fim: "desc" }, select: { clubeId: true } });
    if (anterior?.clubeId === clubeAtualId) return { ...await historicoVinculos(tx, atletaId), alterado: false };
  }
  if (atual.clubeId !== clubeAtualId) {
    throw new ConflictException("O clube atual do atleta não corresponde a clubeAtualId. Consulte os vínculos e tente novamente.");
  }
  // Bloqueios feitos para outro clube (o vínculo mudou entre a leitura e o lock da conta) não valem.
  if (atual.clubeId !== visto.clubeId) throw new ConflictException("O vínculo do atleta mudou durante a operação. Consulte os vínculos e tente novamente.");
  if (!await tx.clube.findUnique({ where: { id: clubeDestinoId }, select: { id: true } })) throw new NotFoundException("Clube de destino não encontrado");

  const impeditivos = await tx.campeonato.findMany({
    where: { status: "em_andamento", inscricoes: { some: { clubeId: atual.clubeId } } },
    select: { nome: true, edicao: true }, orderBy: [{ nome: "asc" }, { edicao: "asc" }],
  });
  if (impeditivos.length > 0) {
    const nomes = impeditivos.map(c => `${c.nome} ${c.edicao}`).join(", ");
    throw new ConflictException(`O clube atual participa de campeonato em andamento (${nomes}); a transferência só é permitida após o encerramento ou cancelamento.`);
  }

  await tx.$executeRaw`UPDATE "VinculoClube" SET fim = now() WHERE id = ${atual.id}::uuid`;
  await tx.$executeRaw`INSERT INTO "VinculoClube" (id, "atletaId", "clubeId", inicio, "definidoPorPresidenteId")
    VALUES (gen_random_uuid(), ${atletaId}::uuid, ${clubeDestinoId}::uuid, now(), ${presidenteId}::uuid)`;
  return { ...await historicoVinculos(tx, atletaId), alterado: true };
}

/** FOR SHARE nos campeonatos planejados ou em andamento em que o clube está inscrito, em ordem fixa. */
async function bloquearCampeonatosAtivos(tx: Tx, clubeId: string) {
  await tx.$queryRaw`SELECT c.id FROM "Campeonato" c
    WHERE c.status IN ('planejado', 'em_andamento')
      AND EXISTS(SELECT 1 FROM "InscricaoClube" i WHERE i."campeonatoId" = c.id AND i."clubeId" = ${clubeId}::uuid)
    ORDER BY c.id FOR SHARE OF c`;
}

/** Restrições do banco (vínculo aberto duplicado, sobreposição, campeonato iniciado) chegam como 409. */
export function traduzirErroTransferencia(error: unknown): unknown {
  const conflito = new ConflictException("Transferência recusada por conflito com o estado atual do atleta ou do campeonato. Consulte os vínculos e tente novamente.");
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003"].includes(error.code)) return conflito;
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo && ["23505", "23503", "23514", "23P01", "40P01"].includes(codigo)) return conflito;
  return error;
}
