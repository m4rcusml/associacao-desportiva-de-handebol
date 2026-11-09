import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, ResultadoJogo, type StatusJogo } from "../../generated/prisma/client.js";
import {
  encerrarAcessoArbitragem, renovarSenha, resumirSessao, revalidarArbitragem, revalidarArbitragemOuEncerramento, revogarSessoes,
} from "../arbitragem/acesso.js";
import type { CofreSenhaArbitragem } from "../arbitragem/senha.js";
import { placar } from "../resultados/lancamentos.js";
import { reconciliarSuspensoesAutomaticas, registrarCumprimentos } from "../suspensoes/suspensoes.js";
import { horaLocal } from "./fuso.js";
import { detalharJogo, fusoHorarioSchema, inicioPrevistoSchema, instantePrevisto, localSchema, validarFuso } from "./jogos.js";
import { registrarEvento } from "../notificacoes/eventos.js";

type Tx = Prisma.TransactionClient;

/**
 * Adiamento pelo presidente (seção 10/11): nova hora local do início (`null` deixa o jogo sem data, aguardando
 * reagendamento) e, opcionalmente, novo fuso IANA ou local. Sem fuso, mantém o do jogo.
 */
export const adiamentoSchema = z.strictObject({
  inicioPrevisto: inicioPrevistoSchema.nullable(),
  fusoHorario: fusoHorarioSchema.optional(),
  local: localSchema.optional(),
});

/**
 * Encerramento definitivo pela arbitragem (MAR-72): forma do encerramento e vencedor separados do placar.
 * `vencedorInscricaoId` é obrigatório: a inscrição do clube A ou B, ou `null` para nenhum vencedor, explicitamente.
 */
export const encerramentoSchema = z.strictObject({
  resultado: z.enum(ResultadoJogo),
  vencedorInscricaoId: z.uuid().transform(id => id.toLowerCase()).nullable(),
});
export type DadosEncerramento = z.infer<typeof encerramentoSchema>;

/**
 * Bloqueios do ciclo do jogo, sempre na ordem campeonato (FOR SHARE) → jogo (FOR NO KEY UPDATE), a mesma do
 * cancelamento do campeonato (campeonato FOR UPDATE → jogos): este aguarda o ciclo em curso ou é visto por ele,
 * sem deadlock. O bloqueio do jogo conflita com o FOR SHARE de toda operação da arbitragem (credenciamento,
 * entrada, lançamentos) e da gestão da senha: cada uma termina antes da mudança de status ou já a enxerga, e
 * duas tentativas simultâneas de iniciar, encerrar, adiar ou cancelar são executadas uma após a outra.
 */
export async function bloquearCiclo(tx: Tx, jogoId: string): Promise<StatusJogo> {
  const [referencia] = await tx.$queryRaw<{ campeonatoId: string }[]>`SELECT "campeonatoId" FROM "Jogo" WHERE id = ${jogoId}::uuid`;
  if (!referencia) throw new NotFoundException("Jogo não encontrado");
  await tx.$queryRaw`SELECT 1 FROM "Campeonato" WHERE id = ${referencia.campeonatoId}::uuid FOR SHARE`;
  const [jogo] = await tx.$queryRaw<{ status: StatusJogo }[]>`SELECT status FROM "Jogo" WHERE id = ${jogoId}::uuid FOR NO KEY UPDATE`;
  return jogo.status;
}

const descricao = (status: StatusJogo) => status.replace("_", " ");

/**
 * Arbitragem autorizada inicia formalmente o jogo (RF-030), depois do credenciamento e no dia do jogo no fuso do
 * local (a revalidação exige jogo agendado no dia ou em andamento). Repetir, inclusive em paralelo ou após resposta
 * perdida, não altera `iniciadoEm`: devolve o estado atual com `alterado: false` (PEN-023).
 */
export async function iniciarJogo(tx: Tx, jogoId: string, token: string | undefined) {
  await bloquearCiclo(tx, jogoId);
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  if (status === "em_andamento") return { ...await resumirSessao(tx, jogoId, token), alterado: false };
  await tx.jogo.update({ where: { id: jogoId }, data: { status: "em_andamento", iniciadoEm: new Date() } });
  await registrarEvento(tx, jogoId, "jogo_iniciado");
  return { ...await resumirSessao(tx, jogoId, token), alterado: true };
}

/** Vencedor apresentado com o clube; `null` com o jogo finalizado significa nenhum vencedor (MAR-72). */
export async function vencedorDo(tx: Tx, inscricaoId: string | null) {
  if (!inscricaoId) return null;
  const { id, clube } = await tx.inscricaoClube.findUniqueOrThrow({ where: { id: inscricaoId }, select: { id: true, clube: { select: { id: true, nome: true } } } });
  return { inscricaoId: id, clube };
}

/** Confirmação restrita do encerramento: estado do jogo, resultado, vencedor e placar final, sem dados de sessão ou participantes. */
async function confirmacaoEncerramento(tx: Tx, jogoId: string) {
  const { inscricaoClubeVencedorId, ...jogo } = await tx.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: {
    id: true, status: true, iniciadoEm: true, encerradoEm: true, resultado: true, inscricaoClubeVencedorId: true,
  } });
  return { jogo: { ...jogo, vencedor: await vencedorDo(tx, inscricaoClubeVencedorId) }, placar: await placar(tx, jogoId) };
}

/** Vencedor informado deve ser uma das inscrições do jogo (ou null, nenhum vencedor). */
export async function exigirVencedorDoJogo(tx: Tx, jogoId: string, vencedorInscricaoId: string | null) {
  if (vencedorInscricaoId === null) return;
  const jogo = await tx.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: { inscricaoClubeAId: true, inscricaoClubeBId: true } });
  if (![jogo.inscricaoClubeAId, jogo.inscricaoClubeBId].includes(vencedorInscricaoId)) {
    throw new BadRequestException("vencedorInscricaoId deve ser a inscrição do clube A ou do clube B deste jogo, ou null para nenhum vencedor.");
  }
}

/**
 * Um árbitro autorizado encerra definitivamente o jogo (RF-035, RN-031, seção 11, MAR-72), sem aprovação de outro,
 * informando a forma do encerramento e o vencedor (clube do jogo ou nenhum), registrados separadamente do placar,
 * que continua vindo dos lançamentos. Jogo em andamento encerra como normal, interrompido definitivamente ou
 * abandono, inclusive durante uma interrupção; W.O. encerra o jogo agendado, sem início, no dia do jogo (0 a 0).
 * Na mesma transação: status finalizado, cumprimento das suspensões (RF-041, RN-039, uma vez), geração das suspensões
 * automáticas por desqualificação com relatório (RF-039, MAR-79; depois dos cumprimentos) e revogação da senha
 * e de todas as sessões temporárias do jogo (RF-029). Escritas da arbitragem que aguardavam o bloqueio veem o jogo
 * finalizado e a sessão revogada; não gravam depois. Reenvio por sessão revogada por este encerramento (repetição,
 * paralelo ou resposta perdida) recebe a confirmação vigente com `alterado: false`, sem reabrir acesso nem autorizar
 * outra operação; mudar o resultado depois cabe ao presidente.
 */
export async function encerrarJogo(tx: Tx, jogoId: string, token: string | undefined, dados: DadosEncerramento) {
  await bloquearCiclo(tx, jogoId);
  const autorizacao = await revalidarArbitragemOuEncerramento(tx, jogoId, token);
  if (autorizacao.situacao === "jogo_encerrado") return { ...await confirmacaoEncerramento(tx, jogoId), alterado: false };
  if (dados.resultado === "wo") {
    if (autorizacao.status !== "agendado") throw new ConflictException("W.O. encerra somente jogo ainda não iniciado; jogo iniciado encerra como normal, interrompido ou abandono.");
  } else if (autorizacao.status !== "em_andamento") {
    throw new ConflictException("Somente jogo em andamento é encerrado pela arbitragem; inicie o jogo antes de encerrá-lo ou registre W.O.");
  }
  await exigirVencedorDoJogo(tx, jogoId, dados.vencedorInscricaoId);
  await tx.jogo.update({ where: { id: jogoId }, data: {
    status: "finalizado", encerradoEm: new Date(), resultado: dados.resultado, inscricaoClubeVencedorId: dados.vencedorInscricaoId,
  } });
  await registrarCumprimentos(tx, jogoId);
  await reconciliarSuspensoesAutomaticas(tx, jogoId);
  await encerrarAcessoArbitragem(tx, [jogoId], "jogo_encerrado");
  // Aviso publicado só após o commit (MAR-73); as sessões revogadas recebem `acesso:encerrado`.
  await registrarEvento(tx, jogoId, "jogo_encerrado");
  return { ...await confirmacaoEncerramento(tx, jogoId), alterado: true };
}

/**
 * Presidente adia o jogo agendado (seção 10): grava a nova data, gera nova senha (se já emitida) e revoga as
 * sessões temporárias de ambos os métodos, na mesma transação. O acesso volta a depender da nova data; escalação
 * e credenciamentos já feitos são preservados, assim como contas e acessos a outros jogos. Jogo adiado não cumpre
 * suspensão até ser realizado (RN-040). Cada pedido é um novo adiamento: repetir gera outra senha.
 */
export async function adiarJogo(tx: Tx, cofre: CofreSenhaArbitragem, jogoId: string, dados: z.infer<typeof adiamentoSchema>) {
  const status = await bloquearCiclo(tx, jogoId);
  if (status !== "agendado") throw new ConflictException(`Somente jogo agendado é adiado (jogo ${descricao(status)}).`);
  const atual = await tx.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: { fusoHorario: true } });
  const fusoHorario = dados.fusoHorario ?? atual.fusoHorario;
  let inicioPrevistoEm: Date | null = null;
  if (dados.inicioPrevisto !== null) {
    inicioPrevistoEm = await instantePrevisto(tx, dados.inicioPrevisto, fusoHorario);
    if (dados.inicioPrevisto.slice(0, 10) < horaLocal(new Date(), fusoHorario).slice(0, 10)) {
      throw new BadRequestException("A nova data do jogo já passou no fuso do local da partida.");
    }
  } else if (dados.fusoHorario) {
    await validarFuso(tx, fusoHorario);
  }

  await tx.jogo.update({ where: { id: jogoId }, data: { inicioPrevistoEm, fusoHorario, ...(dados.local ? { local: dados.local } : {}) } });
  const senhaEmitida = await tx.acessoArbitragem.count({ where: { jogoId } }) > 0;
  // Senha nova revoga as sessões por senha; em seguida, as designadas (RF-029).
  const porSenha = senhaEmitida ? (await renovarSenha(tx, cofre, jogoId, "jogo_adiado")).sessoesRevogadas : 0;
  const sessoesRevogadas = porSenha + await revogarSessoes(tx, [jogoId], "jogo_adiado");
  await registrarEvento(tx, jogoId, "jogo_adiado");
  return { jogo: await detalharJogo(tx, jogoId), senhaRenovada: senhaEmitida, sessoesRevogadas };
}

/**
 * Presidente cancela o jogo agendado (seção 10): revoga senha e sessões temporárias na mesma transação. Jogo
 * cancelado não cumpre suspensão (RN-040); escalação, credenciamentos, contas e outros jogos são preservados.
 * Repetir devolve o estado com `alterado: false`. Jogo em andamento não é cancelado: a arbitragem o interrompe
 * temporariamente ou o encerra como interrompido definitivamente ou abandono (MAR-72).
 */
export async function cancelarJogo(tx: Tx, jogoId: string) {
  const status = await bloquearCiclo(tx, jogoId);
  if (status === "cancelado") return { jogo: await detalharJogo(tx, jogoId), alterado: false };
  if (status !== "agendado") throw new ConflictException(`Somente jogo agendado é cancelado (jogo ${descricao(status)}).`);
  await tx.jogo.update({ where: { id: jogoId }, data: { status: "cancelado" } });
  await encerrarAcessoArbitragem(tx, [jogoId], "jogo_cancelado");
  await registrarEvento(tx, jogoId, "jogo_cancelado");
  return { jogo: await detalharJogo(tx, jogoId), alterado: true };
}

/** Restrições do banco e deadlocks por corrida com outra mudança do jogo ou do campeonato chegam como 409. */
export function traduzirErroCiclo(error: unknown): unknown {
  const conflito = new ConflictException("Operação recusada por conflito com o estado atual do jogo ou do campeonato. Consulte-o e tente novamente.");
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2025"].includes(error.code)) return conflito;
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo && ["23505", "23503", "23514", "40P01"].includes(codigo)) return conflito;
  return error;
}
