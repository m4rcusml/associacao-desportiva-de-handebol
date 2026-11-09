import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, ResultadoJogo } from "../../generated/prisma/client.js";
import { resumirSessao, revalidarArbitragem } from "../arbitragem/acesso.js";
import { placar } from "../resultados/lancamentos.js";
import { bloquearCiclo, exigirVencedorDoJogo, vencedorDo } from "./ciclo.js";
import { interrupcaoAberta } from "./jogos.js";

type Tx = Prisma.TransactionClient;

const vencedor = z.uuid().transform(id => id.toLowerCase()).nullable();
const resultadoComVencedor = z.strictObject({ resultado: z.enum(ResultadoJogo), vencedorInscricaoId: vencedor });

/**
 * Correção do resultado pelo presidente (MAR-72): `atual` é o resultado/vencedor vistos por quem corrige (divergência é
 * conflito com o registro vigente, sem sobrescrever) e `novo`, o que passa a valer. `null` no vencedor = nenhum.
 */
export const correcaoResultadoSchema = z.strictObject({ atual: resultadoComVencedor, novo: resultadoComVencedor });
/** Invalidação posterior pelo presidente (MAR-72): motivo obrigatório; definitiva. */
export const invalidacaoSchema = z.strictObject({ motivo: z.string().trim().min(1).max(500) });

const interrupcoesDo = (tx: Tx, jogoId: string) =>
  tx.interrupcaoJogo.findMany({ where: { jogoId }, select: { interrompidoEm: true, retomadoEm: true }, orderBy: [{ interrompidoEm: "asc" }, { id: "asc" }] });

/** Estado da interrupção para a arbitragem: sessão atual e o histórico de interrupções/retomadas do jogo. */
async function estadoInterrupcao(tx: Tx, jogoId: string, token: string | undefined, alterado: boolean) {
  return { ...await resumirSessao(tx, jogoId, token), interrupcoes: await interrupcoesDo(tx, jogoId), alterado };
}

/**
 * Arbitragem autorizada interrompe temporariamente o jogo em andamento (MAR-72, PEN-012): o status continua em
 * andamento, com os mesmos registros e acessos; não cumpre suspensões. Novos lançamentos e entradas em quadra
 * aguardam a retomada. Repetir com o jogo já interrompido devolve o estado com `alterado: false`.
 */
export async function interromperJogo(tx: Tx, jogoId: string, token: string | undefined) {
  await bloquearCiclo(tx, jogoId);
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  if (status !== "em_andamento") throw new ConflictException("Somente jogo em andamento é interrompido.");
  if (await interrupcaoAberta(tx, jogoId)) return estadoInterrupcao(tx, jogoId, token, false);
  await tx.interrupcaoJogo.create({ data: { jogoId, interrompidoEm: new Date() } });
  return estadoInterrupcao(tx, jogoId, token, true);
}

/**
 * Arbitragem autorizada retoma o mesmo jogo interrompido (MAR-72): mesmos registros, placar e participações. O acesso
 * de jogo iniciado continua após a virada do dia até o encerramento. Repetir sem interrupção aberta: `alterado: false`.
 */
export async function retomarJogo(tx: Tx, jogoId: string, token: string | undefined) {
  await bloquearCiclo(tx, jogoId);
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  if (status !== "em_andamento") throw new ConflictException("Somente jogo em andamento é retomado.");
  const aberta = await interrupcaoAberta(tx, jogoId);
  if (!aberta) return estadoInterrupcao(tx, jogoId, token, false);
  await tx.interrupcaoJogo.update({ where: { id: aberta.id }, data: { retomadoEm: new Date() } });
  return estadoInterrupcao(tx, jogoId, token, true);
}

const pessoa = { select: { usuario: { select: { id: true, nomeCompleto: true } } } } as const;

/**
 * Resultado do jogo para o presidente (MAR-72): forma do encerramento, vencedor (null = nenhum, com o jogo
 * finalizado), placar, invalidação, interrupções e o histórico de alterações posteriores ao encerramento.
 */
export async function consultarResultado(tx: Tx, jogoId: string) {
  // Mantém jogo, histórico e placar consistentes, inclusive contra correções de lançamentos (FOR SHARE).
  await tx.$queryRaw`SELECT 1 FROM "Jogo" WHERE id = ${jogoId}::uuid FOR NO KEY UPDATE`;
  const jogo = await tx.jogo.findUnique({ where: { id: jogoId }, select: {
    id: true, status: true, iniciadoEm: true, encerradoEm: true, resultado: true, inscricaoClubeVencedorId: true, invalidadoEm: true,
  } });
  if (!jogo) throw new NotFoundException("Jogo não encontrado");
  const alteracoes = await tx.alteracaoResultadoJogo.findMany({
    where: { jogoId },
    select: {
      id: true, tipo: true, resultadoAnterior: true, inscricaoVencedorAnteriorId: true, resultadoNovo: true, inscricaoVencedorNovoId: true,
      motivo: true, registradaEm: true, presidente: pessoa,
    },
    orderBy: [{ registradaEm: "asc" }, { id: "asc" }],
  });
  const { inscricaoClubeVencedorId, invalidadoEm, ...dados } = jogo;
  const invalidacao = alteracoes.find(a => a.tipo === "invalidacao");
  return {
    jogo: { ...dados, vencedor: await vencedorDo(tx, inscricaoClubeVencedorId) },
    placar: await placar(tx, jogoId),
    invalidacao: invalidadoEm ? { invalidadoEm, motivo: invalidacao?.motivo ?? null, presidente: invalidacao?.presidente.usuario ?? null } : null,
    interrupcoes: await interrupcoesDo(tx, jogoId),
    alteracoes: alteracoes.map(({ presidente, ...a }) => ({ ...a, presidente: presidente.usuario })),
  };
}

/** Jogo finalizado bloqueado para a alteração, na ordem do ciclo (campeonato FOR SHARE → jogo FOR NO KEY UPDATE). */
async function bloquearFinalizado(tx: Tx, jogoId: string) {
  const status = await bloquearCiclo(tx, jogoId);
  if (status !== "finalizado") {
    throw new ConflictException("O presidente altera o resultado somente após o encerramento; antes, quem decide é a arbitragem.");
  }
  return tx.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: { resultado: true, inscricaoClubeVencedorId: true, iniciadoEm: true, invalidadoEm: true } });
}

const mesmoResultado = (a: { resultado: ResultadoJogo | null; vencedor: string | null }, b: z.infer<typeof resultadoComVencedor>) =>
  a.resultado === b.resultado && a.vencedor === b.vencedorInscricaoId;

/**
 * Presidente corrige a forma do encerramento e/ou o vencedor após o encerramento (RF-036, MAR-72), sem reabrir a
 * arbitragem. W.O. só vale para jogo sem início; os demais, somente para jogo iniciado. Placar, estatísticas e
 * cumprimentos não mudam (todo encerramento definitivo cumpre). O histórico guarda anterior e novo, com
 * responsável e data. Repetir a correção já aplicada devolve `alterado: false`; `atual` divergente do vigente é
 * conflito, com o resultado atualizado, para nova decisão.
 */
export async function corrigirResultado(tx: Tx, presidenteId: string, jogoId: string, dados: z.infer<typeof correcaoResultadoSchema>) {
  const jogo = await bloquearFinalizado(tx, jogoId);
  const vigente = { resultado: jogo.resultado, vencedor: jogo.inscricaoClubeVencedorId };
  if (mesmoResultado(vigente, dados.novo)) return { ...await consultarResultado(tx, jogoId), alterado: false };
  if (!mesmoResultado(vigente, dados.atual)) {
    throw new ConflictException({
      statusCode: 409, error: "Conflict",
      message: "O resultado vigente difere do informado em atual. Consulte o resultado atualizado antes de corrigir.",
      resultado: await consultarResultado(tx, jogoId),
    });
  }
  if ((dados.novo.resultado === "wo") !== (jogo.iniciadoEm === null)) {
    throw new ConflictException(jogo.iniciadoEm === null
      ? "Jogo encerrado sem início permanece W.O.; corrija apenas o vencedor."
      : "Jogo iniciado não é W.O.; use normal, interrompido ou abandono.");
  }
  await exigirVencedorDoJogo(tx, jogoId, dados.novo.vencedorInscricaoId);
  await tx.$executeRaw`
    INSERT INTO "AlteracaoResultadoJogo" (id, "jogoId", tipo, "resultadoAnterior", "inscricaoVencedorAnteriorId", "resultadoNovo", "inscricaoVencedorNovoId", "presidenteId", "registradaEm")
    VALUES (gen_random_uuid(), ${jogoId}::uuid, 'correcao', ${vigente.resultado}::"ResultadoJogo", ${vigente.vencedor}::uuid,
      ${dados.novo.resultado}::"ResultadoJogo", ${dados.novo.vencedorInscricaoId}::uuid, ${presidenteId}::uuid, now())`;
  await tx.jogo.update({ where: { id: jogoId }, data: { resultado: dados.novo.resultado, inscricaoClubeVencedorId: dados.novo.vencedorInscricaoId } });
  return { ...await consultarResultado(tx, jogoId), alterado: true };
}

/**
 * Presidente invalida o jogo após o encerramento (MAR-72, seção 11), definitivamente e com motivo. Placar, estatísticas
 * individuais, vencedor e cumprimentos de suspensão são preservados (jogo invalidado conta para cumprimento); o
 * vencedor, se necessário, é corrigido à parte. Repetir devolve `alterado: false` com a invalidação original.
 */
export async function invalidarJogo(tx: Tx, presidenteId: string, jogoId: string, { motivo }: z.infer<typeof invalidacaoSchema>) {
  const jogo = await bloquearFinalizado(tx, jogoId);
  if (jogo.invalidadoEm) return { ...await consultarResultado(tx, jogoId), alterado: false };
  await tx.$executeRaw`
    INSERT INTO "AlteracaoResultadoJogo" (id, "jogoId", tipo, "resultadoAnterior", "inscricaoVencedorAnteriorId", "resultadoNovo", "inscricaoVencedorNovoId", motivo, "presidenteId", "registradaEm")
    VALUES (gen_random_uuid(), ${jogoId}::uuid, 'invalidacao', ${jogo.resultado}::"ResultadoJogo", ${jogo.inscricaoClubeVencedorId}::uuid,
      ${jogo.resultado}::"ResultadoJogo", ${jogo.inscricaoClubeVencedorId}::uuid, ${motivo}, ${presidenteId}::uuid, now())`;
  await tx.$executeRaw`UPDATE "Jogo" SET "invalidadoEm" = now() WHERE id = ${jogoId}::uuid`;
  return { ...await consultarResultado(tx, jogoId), alterado: true };
}
