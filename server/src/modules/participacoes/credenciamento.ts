import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type StatusJogo } from "../../generated/prisma/client.js";
import { revalidarArbitragem } from "../arbitragem/acesso.js";
import { exigirJogoSemInterrupcao } from "../jogos/jogos.js";
import { atletasComSuspensaoVigente, bloquearGeracaoAutomatica } from "../suspensoes/suspensoes.js";
import { registrarEvento } from "../notificacoes/eventos.js";

type Tx = Prisma.TransactionClient;

const camisa = z.int().min(0).max(2_147_483_647);
/** O token lido vai no corpo, nunca na URL, para não aparecer em logs ou históricos de navegação. */
const tokenQr = z.string().trim().min(1).max(256);

/**
 * Credenciamento (RF-017/019): confirmação manual pelo atleta escolhido na lista ou leitura do QR da
 * carteirinha, sempre com o número da camisa. As duas formas aplicam as mesmas regras (RN-017).
 */
export const credenciamentoSchema = z.union([
  z.strictObject({ atletaId: z.uuid().transform(id => id.toLowerCase()), numeroCamisa: camisa }),
  z.strictObject({ tokenQr, numeroCamisa: camisa }),
]);
export const leituraQrArbitragemSchema = z.strictObject({ tokenQr });

/** Motivo que impede um novo credenciamento, na ordem em que é conferido (RN-016, RF-040). */
export type Impedimento = "nao_aprovado" | "sem_vinculo_com_clubes_do_jogo" | "conta_desativada" | "carteirinha_invalidada" | "suspensao";

const mensagens: Record<Impedimento, string> = {
  nao_aprovado: "Somente atleta aprovado pode ser credenciado.",
  sem_vinculo_com_clubes_do_jogo: "O atleta não tem vínculo atual com um dos clubes do jogo.",
  conta_desativada: "Atleta com conta desativada não pode ser credenciado.",
  carteirinha_invalidada: "Atleta com carteirinha invalidada não pode ser credenciado.",
  suspensao: "Atleta com suspensão a cumprir neste campeonato não pode ser credenciado.",
};

interface JogoCredenciamento {
  id: string;
  status: StatusJogo;
  campeonatoId: string;
  inscricoes: { inscricaoId: string; clube: { id: string; nome: string } }[];
}

async function lerJogo(db: Pick<Tx, "jogo">, jogoId: string): Promise<JogoCredenciamento> {
  const jogo = await db.jogo.findUniqueOrThrow({ where: { id: jogoId }, select: {
    id: true, status: true, campeonatoId: true,
    inscricaoClubeA: { select: { id: true, clube: { select: { id: true, nome: true } } } },
    inscricaoClubeB: { select: { id: true, clube: { select: { id: true, nome: true } } } },
  } });
  return {
    id: jogo.id, status: jogo.status, campeonatoId: jogo.campeonatoId,
    inscricoes: [jogo.inscricaoClubeA, jogo.inscricaoClubeB].map(({ id, clube }) => ({ inscricaoId: id, clube })),
  };
}

const selecaoParticipacao = {
  id: true, inscricaoClubeId: true, numeroCamisa: true, credenciadoEm: true, entrouEmQuadraEm: true, escolhidaEm: true,
  entradaAnuladaEm: true, entradaAnuladaPorPresidenteId: true, registradaPorPresidenteId: true, irregularidades: true,
  atleta: { select: { usuario: { select: { id: true, nomeCompleto: true } } } },
} satisfies Prisma.ParticipacaoSelect;
type LinhaParticipacao = Prisma.ParticipacaoGetPayload<{ select: typeof selecaoParticipacao }>;

/**
 * Dados da participação expostos à arbitragem: somente o necessário à operação (RNF-012). `entradaAnulada` e
 * `registroAdministrativo` (MAR-83) só existem nas correções do presidente após o encerramento; senão ficam null.
 */
function apresentar(p: LinhaParticipacao) {
  return {
    participacaoId: p.id, inscricaoId: p.inscricaoClubeId, atleta: p.atleta.usuario,
    numeroCamisa: p.numeroCamisa, credenciadoEm: p.credenciadoEm, entrouEmQuadraEm: p.entrouEmQuadraEm, escalado: p.escolhidaEm !== null,
    entradaAnulada: p.entradaAnuladaEm ? { anuladaEm: p.entradaAnuladaEm, presidenteId: p.entradaAnuladaPorPresidenteId } : null,
    registroAdministrativo: p.registradaPorPresidenteId ? { presidenteId: p.registradaPorPresidenteId, irregularidades: p.irregularidades } : null,
  };
}

const credenciamentoDoAtleta = (db: Pick<Tx, "participacao">, jogoId: string, atletaId: string) =>
  db.participacao.findFirst({ where: { jogoId, atletaId, credenciadoEm: { not: null } }, select: selecaoParticipacao });

interface Situacao {
  inscricaoId: string | null;
  vinculoClubeId: string | null;
  carteirinhaId: string | null;
  impedimento: Impedimento | null;
}

/**
 * Situação do atleta para um novo credenciamento neste jogo (RN-016): aprovado, vínculo atual com um dos clubes
 * do jogo, conta ativa, carteirinha ativa e nenhuma suspensão vigente no campeonato. Nas escritas, o chamador já
 * bloqueou a conta do atleta (FOR SHARE) e pede a carteirinha também em FOR SHARE, para que desativação,
 * transferência, invalidação e aplicação de suspensão concorrentes aguardem ou sejam vistas.
 */
async function situacaoDoAtleta(tx: Tx, jogo: JogoCredenciamento, atletaId: string, bloquear: boolean): Promise<Situacao> {
  const atleta = await tx.atleta.findUnique({ where: { usuarioId: atletaId }, select: {
    statusVerificacao: true, usuario: { select: { ativo: true } }, vinculos: { where: { fim: null }, select: { id: true, clubeId: true } },
  } });
  if (!atleta) throw new NotFoundException("Atleta não encontrado");
  const vinculo = atleta.vinculos[0];
  const inscricao = jogo.inscricoes.find(i => i.clube.id === vinculo?.clubeId);
  const [carteirinha] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status::text AS status FROM "Carteirinha" WHERE "atletaId" = ${atletaId}::uuid
    ${bloquear ? Prisma.sql`FOR SHARE` : Prisma.empty}`;
  const base = { inscricaoId: inscricao?.inscricaoId ?? null, vinculoClubeId: inscricao ? vinculo.id : null, carteirinhaId: carteirinha?.id ?? null };
  const impedimento: Impedimento | null =
    atleta.statusVerificacao !== "aprovado" ? "nao_aprovado"
      : !inscricao ? "sem_vinculo_com_clubes_do_jogo"
        : !atleta.usuario.ativo ? "conta_desativada"
          : carteirinha?.status !== "ativa" ? "carteirinha_invalidada"
            : (await atletasComSuspensaoVigente(tx, jogo.campeonatoId, [atletaId])).has(atletaId) ? "suspensao"
              : null;
  return { ...base, impedimento };
}

/** Conta do atleta em FOR SHARE: desativação, transferência e aplicação de suspensão (FOR UPDATE) aguardam ou são vistas. */
async function bloquearAtleta(tx: Tx, atletaId: string) {
  const [conta] = await tx.$queryRaw<{ perfil: string }[]>`SELECT perfil::text AS perfil FROM "Usuario" WHERE id = ${atletaId}::uuid FOR SHARE`;
  if (conta?.perfil !== "atleta") throw new NotFoundException("Atleta não encontrado");
}

/** QR vigente → atleta. QR substituído ou desconhecido responde como não reconhecido (PEN-020). */
async function atletaDoQr(db: Pick<Tx, "carteirinha">, token: string) {
  const carteirinha = await db.carteirinha.findUnique({ where: { tokenQr: token }, select: { atletaId: true } });
  if (!carteirinha) throw new NotFoundException("QR não reconhecido");
  return carteirinha.atletaId;
}

/**
 * Atletas do jogo para a arbitragem, por clube: aprovados com vínculo atual com o clube e os já credenciados por
 * ele (inclusive transferidos depois, RN-009). Cada um traz a escolha do técnico (só informativa, RN-014), o
 * credenciamento (camisa, data e entrada em quadra) e, se ainda não credenciado, o impedimento atual.
 */
export async function listarAtletasDoJogo(tx: Tx, jogoId: string, token: string | undefined) {
  await revalidarArbitragem(tx, jogoId, token);
  const jogo = await lerJogo(tx, jogoId);
  const clubes = await Promise.all(jogo.inscricoes.map(async ({ inscricaoId, clube }) => {
    const [participacoes, vinculados] = await Promise.all([
      tx.participacao.findMany({ where: { jogoId, inscricaoClubeId: inscricaoId }, select: selecaoParticipacao }),
      tx.vinculoClube.findMany({
        where: { clubeId: clube.id, fim: null, atleta: { statusVerificacao: "aprovado" } },
        select: { atleta: { select: { usuarioId: true, usuario: { select: { id: true, nomeCompleto: true, ativo: true } }, carteirinha: { select: { status: true } } } } },
      }),
    ]);
    const suspensos = await atletasComSuspensaoVigente(tx, jogo.campeonatoId, vinculados.map(v => v.atleta.usuarioId));
    const credenciados = new Map(participacoes.filter(p => p.credenciadoEm).map(p => [p.atleta.usuario.id, p]));
    const escalados = new Set(participacoes.filter(p => p.escolhidaEm).map(p => p.atleta.usuario.id));
    const atletas = new Map<string, { atleta: { id: string; nomeCompleto: string }; escalado: boolean; credenciamento: ReturnType<typeof apresentar> | null; impedimento: Impedimento | null }>();
    for (const { atleta } of vinculados) {
      const { id, nomeCompleto, ativo } = atleta.usuario;
      const impedimento = !ativo ? "conta_desativada" : atleta.carteirinha?.status !== "ativa" ? "carteirinha_invalidada" : suspensos.has(id) ? "suspensao" : null;
      atletas.set(id, { atleta: { id, nomeCompleto }, escalado: escalados.has(id), credenciamento: null, impedimento });
    }
    for (const [id, p] of credenciados) {
      atletas.set(id, { atleta: p.atleta.usuario, escalado: escalados.has(id), credenciamento: apresentar(p), impedimento: null });
    }
    const lista = [...atletas.values()].sort((x, y) => x.atleta.nomeCompleto.localeCompare(y.atleta.nomeCompleto, "pt-BR") || x.atleta.id.localeCompare(y.atleta.id));
    return { inscricaoId, clube, atletas: lista };
  }));
  return { jogo: { id: jogo.id, status: jogo.status }, clubes };
}

/**
 * Leitura do QR pela arbitragem autorizada do jogo (RF-017/018): identificação mínima (nome, código e status da
 * carteirinha), o clube do jogo pelo qual o atleta seria credenciado e o impedimento, ou o credenciamento já feito.
 * Só ler não credencia: a confirmação automática acontece ao enviar o QR com a camisa. O token não concede
 * permissão alguma; quem lê precisa da sessão temporária do jogo (RNF-004).
 */
export async function lerQrNoJogo(tx: Tx, jogoId: string, token: string | undefined, qr: string) {
  await revalidarArbitragem(tx, jogoId, token);
  const jogo = await lerJogo(tx, jogoId);
  const atletaId = await atletaDoQr(tx, qr);
  const carteirinha = await tx.carteirinha.findUniqueOrThrow({ where: { atletaId }, select: { codigo: true, status: true, atleta: { select: { usuario: { select: { id: true, nomeCompleto: true } } } } } });
  const existente = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  const situacao = existente ? null : await situacaoDoAtleta(tx, jogo, atletaId, false);
  const inscricaoId = existente?.inscricaoClubeId ?? situacao?.inscricaoId ?? null;
  return {
    atleta: carteirinha.atleta.usuario,
    carteirinha: { codigo: carteirinha.codigo, status: carteirinha.status },
    clube: jogo.inscricoes.find(i => i.inscricaoId === inscricaoId) ?? null,
    credenciamento: existente ? apresentar(existente) : null,
    impedimento: situacao?.impedimento ?? null,
  };
}

/**
 * Arbitragem autorizada credencia o atleta com a camisa do jogo (RF-017 a 021, RN-015 a 019), por confirmação
 * manual ou QR, antes do início ou durante a partida (atrasados), escolhido ou não pelo técnico. Grava carteirinha,
 * data e camisa juntos na participação do vínculo atual, reaproveitando a escolha se houver.
 * Ordem: jogo → arbitragem → sessão (revalidação) → bloqueio consultivo atleta/campeonato → conta → carteirinha → vínculo (trigger).
 * Atleta já credenciado neste jogo com a mesma camisa (QR repetido, reenvio ou pedido simultâneo) devolve o registro
 * com `alterado: false`, mesmo que tenha ficado inapto depois: o credenciamento anterior é preservado (RN-013, PEN-011).
 */
export async function credenciar(tx: Tx, jogoId: string, token: string | undefined, dados: z.infer<typeof credenciamentoSchema>) {
  await revalidarArbitragem(tx, jogoId, token);
  const jogo = await lerJogo(tx, jogoId);
  const atletaId = "atletaId" in dados ? dados.atletaId : await atletaDoQr(tx, dados.tokenQr);
  await bloquearGeracaoAutomatica(tx, jogo.campeonatoId, atletaId);
  await bloquearAtleta(tx, atletaId);
  if ("tokenQr" in dados) {
    // Substituição do QR concorrente (FOR UPDATE da carteirinha) aguarda ou é vista: o QR antigo não credencia.
    const [vigente] = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Carteirinha" WHERE "tokenQr" = ${dados.tokenQr} AND "atletaId" = ${atletaId}::uuid FOR SHARE`;
    if (!vigente) throw new NotFoundException("QR não reconhecido");
  }

  const repetido = async () => {
    const existente = await credenciamentoDoAtleta(tx, jogoId, atletaId);
    if (!existente) return null;
    if (existente.numeroCamisa !== dados.numeroCamisa) {
      throw new ConflictException(`Atleta já credenciado neste jogo com a camisa ${existente.numeroCamisa}.`);
    }
    return { participacao: apresentar(existente), alterado: false };
  };
  const anterior = await repetido();
  if (anterior) return anterior;

  const situacao = await situacaoDoAtleta(tx, jogo, atletaId, true);
  if (situacao.impedimento) throw new ConflictException(mensagens[situacao.impedimento]);
  const { inscricaoId, vinculoClubeId, carteirinhaId } = situacao as { inscricaoId: string; vinculoClubeId: string; carteirinhaId: string };
  const camisaEmUso = async () => {
    const ocupada = await tx.participacao.findFirst({ where: { jogoId, inscricaoClubeId: inscricaoId, numeroCamisa: dados.numeroCamisa }, select: { atletaId: true } });
    if (ocupada && ocupada.atletaId !== atletaId) throw new ConflictException(`A camisa ${dados.numeroCamisa} já está em uso por outro atleta deste clube no jogo.`);
  };
  await camisaEmUso();

  // Escritas condicionais: pedido simultâneo do mesmo atleta espera o primeiro e termina sem efeito; camisa
  // disputada por dois atletas fica com o primeiro e o segundo recebe 409.
  const credenciadoEm = new Date();
  const dadosCredenciamento = { carteirinhaId, credenciadoEm, numeroCamisa: dados.numeroCamisa };
  const escolha = await tx.participacao.findUnique({ where: { jogoId_vinculoClubeId: { jogoId, vinculoClubeId } }, select: { id: true } });
  const gravou = escolha
    ? (await tx.participacao.updateMany({ where: { id: escolha.id, credenciadoEm: null }, data: dadosCredenciamento })).count > 0
    : (await tx.$queryRaw<unknown[]>`
        INSERT INTO "Participacao" (id, "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", "numeroCamisa")
        VALUES (gen_random_uuid(), ${jogoId}::uuid, ${inscricaoId}::uuid, ${vinculoClubeId}::uuid, ${atletaId}::uuid, ${carteirinhaId}::uuid, ${credenciadoEm}, ${dados.numeroCamisa})
        ON CONFLICT DO NOTHING
        RETURNING id`).length > 0;
  if (!gravou) {
    const concorrente = await repetido();
    if (concorrente) return concorrente;
    await camisaEmUso();
    throw new ConflictException("O credenciamento mudou durante a operação. Consulte a lista e tente novamente.");
  }
  const participacao = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  await registrarEvento(tx, jogoId, "credenciamento_registrado", atletaId);
  return { participacao: apresentar(participacao!), alterado: true };
}

/**
 * Arbitragem confirma uma única vez que o atleta credenciado entrou em quadra (RF-022/023, RN-020/021), com o jogo
 * em andamento e a conta do atleta ativa. Não registra cada entrada/saída nem tempo jogado; repetir devolve
 * `alterado: false`. Suspensão aplicada ou carteirinha invalidada depois do credenciamento não impedem a entrada,
 * porque a participação já credenciada é preservada (RN-013, PEN-011).
 */
export async function registrarEntrada(tx: Tx, jogoId: string, token: string | undefined, atletaId: string) {
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  await bloquearAtleta(tx, atletaId);
  const existente = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  if (!existente) throw new ConflictException("Somente atleta credenciado neste jogo pode entrar em quadra.");
  if (existente.entrouEmQuadraEm) return { participacao: apresentar(existente), alterado: false };
  if (status !== "em_andamento") throw new ConflictException("A entrada em quadra é registrada somente com o jogo em andamento.");
  await exigirJogoSemInterrupcao(tx, jogoId, "registrar entradas em quadra");
  const conta = await tx.usuario.findUniqueOrThrow({ where: { id: atletaId }, select: { ativo: true } });
  if (!conta.ativo) throw new ConflictException("Atleta com conta desativada não pode entrar em quadra.");
  // Estorno concorrente (MAR-71) bloqueia a linha antes: a gravação condicional não acontece e a resposta é 409.
  const { count } = await tx.participacao.updateMany({ where: { id: existente.id, credenciadoEm: { not: null }, entrouEmQuadraEm: null }, data: { entrouEmQuadraEm: new Date() } });
  const atual = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  if (!atual) throw new ConflictException("Somente atleta credenciado neste jogo pode entrar em quadra.");
  if (count > 0) await registrarEvento(tx, jogoId, "entrada_registrada", atletaId);
  return { participacao: apresentar(atual), alterado: count > 0 };
}

/** Correção de camisa (MAR-71): a camisa conhecida por quem corrige torna a disputa reconhecível (PEN-023). */
export const correcaoCamisaSchema = z.strictObject({ numeroCamisaAtual: camisa, numeroCamisa: camisa })
  .refine(d => d.numeroCamisaAtual !== d.numeroCamisa, "A correção deve alterar a camisa.");
/** Estorno (MAR-71): a camisa do credenciamento a desfazer confirma qual credenciamento quem estorna viu. */
export const estornoSchema = z.strictObject({ numeroCamisa: camisa });

/** Quem altera o credenciamento: a arbitragem até o encerramento e o presidente depois (seção 11). */
type Corretor = "arbitragem" | "presidente";

const selecaoAlteracao = {
  id: true, tipo: true, inscricaoClubeId: true, credenciadoEm: true, numeroCamisaAnterior: true, numeroCamisaNova: true, registradaEm: true,
  entrouEmQuadraEm: true, entradaAnuladaEm: true, entradaAnuladaPorPresidenteId: true, registradaPorPresidenteId: true, irregularidades: true,
  presidenteId: true,
  atleta: { select: { usuario: { select: { id: true, nomeCompleto: true } } } },
} satisfies Prisma.AlteracaoCredenciamentoSelect;

/**
 * Registro do histórico com a cópia do credenciamento alterado (MAR-71) e, desde a MAR-83, da entrada em quadra, da sua
 * anulação e do registro administrativo; `presidenteId` é o autor quando foi o presidente (null para a arbitragem).
 */
function apresentarAlteracao(a: Prisma.AlteracaoCredenciamentoGetPayload<{ select: typeof selecaoAlteracao }>) {
  return {
    id: a.id, tipo: a.tipo, inscricaoId: a.inscricaoClubeId, atleta: a.atleta.usuario, credenciadoEm: a.credenciadoEm,
    numeroCamisaAnterior: a.numeroCamisaAnterior, numeroCamisaNova: a.numeroCamisaNova, registradaEm: a.registradaEm,
    entrouEmQuadraEm: a.entrouEmQuadraEm,
    entradaAnulada: a.entradaAnuladaEm ? { anuladaEm: a.entradaAnuladaEm, presidenteId: a.entradaAnuladaPorPresidenteId } : null,
    registroAdministrativo: a.registradaPorPresidenteId ? { presidenteId: a.registradaPorPresidenteId, irregularidades: a.irregularidades } : null,
    presidenteId: a.presidenteId,
  };
}

/**
 * Credenciamento do atleta no jogo com bloqueio exclusivo (FOR UPDATE): correções e estornos simultâneos se
 * enfileiram, e lançamento ou entrada em curso (que bloqueiam ou alteram a mesma linha) terminam antes ou veem o resultado.
 */
async function bloquearCredenciamento(tx: Tx, jogoId: string, atletaId: string) {
  const [linha] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Participacao" WHERE "jogoId" = ${jogoId}::uuid AND "atletaId" = ${atletaId}::uuid AND "credenciadoEm" IS NOT NULL FOR UPDATE`;
  return linha ? tx.participacao.findUniqueOrThrow({ where: { id: linha.id }, select: selecaoParticipacao }) : null;
}

/** Credenciamento diferente do informado por quem corrige: recusado sem sobrescrever, com o registro atual (PEN-023). */
function credenciamentoMudou(atual: LinhaParticipacao) {
  return new ConflictException({
    statusCode: 409, error: "Conflict",
    message: `O credenciamento mudou: o atleta está com a camisa ${atual.numeroCamisa}. Consulte o registro atual e tente novamente.`,
    participacao: apresentar(atual),
  });
}

/** Grava no histórico a cópia do credenciamento vigente, na mesma transação da alteração (o trigger exige). */
async function registrarAlteracao(tx: Tx, participacaoId: string, tipo: "correcao_camisa" | "estorno", numeroCamisaNova: number | null, presidenteId: string | null = null) {
  const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "AlteracaoCredenciamento" (id, "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", tipo, "numeroCamisaAnterior", "numeroCamisaNova", "registradaEm",
      "entrouEmQuadraEm", "entradaAnuladaEm", "entradaAnuladaPorPresidenteId", "registradaPorPresidenteId", irregularidades, "presidenteId")
    SELECT gen_random_uuid(), "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", ${tipo}::"TipoAlteracaoCredenciamento", "numeroCamisa", ${numeroCamisaNova}, now(),
      "entrouEmQuadraEm", "entradaAnuladaEm", "entradaAnuladaPorPresidenteId", "registradaPorPresidenteId", irregularidades, ${presidenteId}::uuid
    FROM "Participacao" WHERE id = ${participacaoId}::uuid
    RETURNING id`;
  return tx.alteracaoCredenciamento.findUniqueOrThrow({ where: { id }, select: selecaoAlteracao });
}

/**
 * Correção da camisa (MAR-71; seção 11): pela arbitragem até o encerramento, inclusive após a entrada em quadra, e
 * depois somente pelo presidente; preserva a camisa anterior no histórico. A camisa continua única no clube/jogo
 * (RN-019); a disputa simultânea fica com a primeira e as demais recebem 409. Corrigir para a camisa que o atleta já
 * tem devolve `alterado: false` (reenvio). Ordem dos bloqueios: jogo → participação (FOR UPDATE).
 */
async function corrigirCamisa(tx: Tx, corretor: Corretor, status: StatusJogo, jogoId: string, atletaId: string, dados: z.infer<typeof correcaoCamisaSchema>, presidenteId: string | null = null) {
  if (corretor === "presidente" && status !== "finalizado") {
    throw new ConflictException("O presidente corrige a camisa somente após o encerramento do jogo; antes, quem corrige é a arbitragem.");
  }
  const atual = await bloquearCredenciamento(tx, jogoId, atletaId);
  if (!atual) throw new ConflictException("O atleta não está credenciado neste jogo.");
  if (atual.numeroCamisa === dados.numeroCamisa) return { participacao: apresentar(atual), alterado: false };
  if (atual.numeroCamisa !== dados.numeroCamisaAtual) throw credenciamentoMudou(atual);
  const ocupada = await tx.participacao.findFirst({ where: { jogoId, inscricaoClubeId: atual.inscricaoClubeId, numeroCamisa: dados.numeroCamisa }, select: { id: true } });
  if (ocupada) throw new ConflictException(`A camisa ${dados.numeroCamisa} já está em uso por outro atleta deste clube no jogo.`);

  const alteracao = await registrarAlteracao(tx, atual.id, "correcao_camisa", dados.numeroCamisa, presidenteId);
  await tx.participacao.update({ where: { id: atual.id }, data: { numeroCamisa: dados.numeroCamisa } });
  const corrigida = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  await registrarEvento(tx, jogoId, "credenciamento_corrigido", atletaId);
  return { participacao: apresentar(corrigida!), alteracao: apresentarAlteracao(alteracao), alterado: true };
}

export async function corrigirCamisaPelaArbitragem(tx: Tx, jogoId: string, token: string | undefined, atletaId: string, dados: z.infer<typeof correcaoCamisaSchema>) {
  const { status } = await revalidarArbitragem(tx, jogoId, token);
  return corrigirCamisa(tx, "arbitragem", status, jogoId, atletaId, dados);
}

/**
 * Presidente corrige a camisa somente após o encerramento, sem reabrir a arbitragem; o jogo fica em FOR SHARE.
 * Desde a MAR-83 o histórico registra o presidente autor.
 */
export async function corrigirCamisaPeloPresidente(tx: Tx, jogoId: string, atletaId: string, dados: z.infer<typeof correcaoCamisaSchema>, presidenteId: string | null = null) {
  const [jogo] = await tx.$queryRaw<{ status: StatusJogo }[]>`SELECT status FROM "Jogo" WHERE id = ${jogoId}::uuid FOR SHARE`;
  if (!jogo) throw new NotFoundException("Jogo não encontrado.");
  return corrigirCamisa(tx, "presidente", jogo.status, jogoId, atletaId, dados, presidenteId);
}

/**
 * Arbitragem desfaz o credenciamento antes do encerramento (MAR-71; seção 11), somente sem entrada em quadra e sem
 * gols/penalidades registrados (inclusive anulados, que preservam a participação no histórico). Grava a cópia do
 * credenciamento no histórico e retira carteirinha, data e camisa; a escolha do técnico, se houver, permanece, e sem
 * ela a participação é excluída. O atleta pode ser credenciado de novo pelas regras normais. Casos com entrada ou
 * lançamentos ficam com o presidente após o encerramento (`estornarPeloPresidente`, MAR-83).
 * Repetir o estorno já feito devolve `alterado: false`. Ordem: jogo → arbitragem → sessão → participação (FOR UPDATE).
 */
export async function estornarCredenciamento(tx: Tx, jogoId: string, token: string | undefined, atletaId: string, dados: z.infer<typeof estornoSchema>) {
  await revalidarArbitragem(tx, jogoId, token);
  const atual = await bloquearCredenciamento(tx, jogoId, atletaId);
  if (!atual) {
    const anterior = await tx.alteracaoCredenciamento.findFirst({
      where: { jogoId, atletaId, tipo: "estorno" }, orderBy: [{ registradaEm: "desc" }, { id: "desc" }], select: selecaoAlteracao,
    });
    if (anterior?.numeroCamisaAnterior === dados.numeroCamisa) return { estorno: apresentarAlteracao(anterior), alterado: false };
    throw new ConflictException("O atleta não está credenciado neste jogo.");
  }
  if (atual.numeroCamisa !== dados.numeroCamisa) throw credenciamentoMudou(atual);
  if (atual.entrouEmQuadraEm) {
    throw new ConflictException("Atleta que já entrou em quadra não tem o credenciamento desfeito pela arbitragem; a correção cabe ao presidente, após o encerramento do jogo.");
  }
  if (await tx.lancamentoJogo.count({ where: { participacaoId: atual.id } }) > 0) {
    throw new ConflictException("Atleta com gols ou penalidades registrados não tem o credenciamento desfeito pela arbitragem; a correção cabe ao presidente, após o encerramento do jogo.");
  }

  const estorno = await registrarAlteracao(tx, atual.id, "estorno", null);
  if (atual.escolhidaEm) {
    await tx.participacao.update({ where: { id: atual.id }, data: { carteirinhaId: null, credenciadoEm: null, numeroCamisa: null } });
  } else {
    await tx.participacao.delete({ where: { id: atual.id } });
  }
  await registrarEvento(tx, jogoId, "credenciamento_desfeito", atletaId);
  return { estorno: apresentarAlteracao(estorno), alterado: true };
}

/** Registro administrativo da participação real (MAR-83): atleta, camisa usada no jogo e se entrou em quadra. */
export const registroAdministrativoSchema = z.strictObject({
  atletaId: z.uuid().transform(id => id.toLowerCase()), numeroCamisa: camisa, entrouEmQuadra: z.boolean(),
});

/**
 * Bloqueios das correções administrativas (MAR-83), na mesma ordem das correções de lançamentos do presidente (MAR-70):
 * campeonato (FOR SHARE) → jogo (FOR NO KEY UPDATE). Assim, as correções do mesmo jogo pelo presidente se serializam.
 * Somente com o jogo finalizado (decisão de Marcus, 09/11/2026); antes, quem corrige é a arbitragem.
 */
async function jogoParaCorrecaoAdministrativa(tx: Tx, jogoId: string, acao: string) {
  const referencia = await tx.jogo.findUnique({ where: { id: jogoId }, select: { campeonatoId: true } });
  if (!referencia) throw new NotFoundException("Jogo não encontrado.");
  await tx.$queryRaw`SELECT id FROM "Campeonato" WHERE id = ${referencia.campeonatoId}::uuid FOR SHARE`;
  const [jogo] = await tx.$queryRaw<{ status: StatusJogo; iniciadoEm: Date | null; campeonatoId: string; inscricaoClubeAId: string; inscricaoClubeBId: string }[]>`
    SELECT status, "iniciadoEm", "campeonatoId", "inscricaoClubeAId", "inscricaoClubeBId" FROM "Jogo" WHERE id = ${jogoId}::uuid FOR NO KEY UPDATE`;
  if (!jogo) throw new NotFoundException("Jogo não encontrado.");
  if (jogo.status !== "finalizado") {
    throw new ConflictException(`O presidente ${acao} somente após o encerramento do jogo; antes, quem corrige é a arbitragem.`);
  }
  return jogo;
}

/**
 * Presidente registra a participação real de um atleta após o encerramento (MAR-83; seção 13), por exemplo Pedro, que
 * jogou no lugar de João credenciado por engano. Exige atleta aprovado, com carteirinha e com vínculo com um dos clubes
 * do jogo no início da partida (o clube representado vem desse vínculo, mesmo que ele tenha sido transferido depois).
 * Não aplica as condições do credenciamento normal: o que o impediria fica gravado em `irregularidades` —
 * `suspensao` quando este jogo contou como cumprimento de uma suspensão dele, `conta_desativada` e
 * `carteirinha_invalidada` pela situação no registro. A participação não fica regular, o resultado não muda e o
 * cumprimento já registrado permanece (decisão de Marcus, 09/11/2026); punição adicional é decisão manual.
 * Gols e penalidades são atribuídos depois, um a um, pela correção dos lançamentos (transferência). A camisa continua
 * única no clube/jogo: se for a do atleta credenciado por engano, use outra e corrija-a após o estorno dele.
 * Repetir com os mesmos dados devolve `alterado: false`. A arbitragem não ganha novos credenciamentos com isso.
 */
export async function registrarParticipacaoAdministrativa(tx: Tx, presidenteId: string, jogoId: string, dados: z.infer<typeof registroAdministrativoSchema>) {
  const jogo = await jogoParaCorrecaoAdministrativa(tx, jogoId, "registra a participação");
  const { atletaId } = dados;
  await bloquearGeracaoAutomatica(tx, jogo.campeonatoId, atletaId);
  await bloquearAtleta(tx, atletaId);

  const existente = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  if (existente) {
    if (existente.registradaPorPresidenteId && existente.numeroCamisa === dados.numeroCamisa && (existente.entrouEmQuadraEm !== null) === dados.entrouEmQuadra) {
      return { participacao: apresentar(existente), alterado: false };
    }
    throw new ConflictException(`Atleta já credenciado neste jogo com a camisa ${existente.numeroCamisa}. Corrija o credenciamento existente.`);
  }
  if (!jogo.iniciadoEm) throw new ConflictException("Jogo encerrado sem início (W.O.) não tem participações a registrar.");

  const [vinculo] = await tx.$queryRaw<{ id: string; inscricaoId: string }[]>`
    SELECT v.id, i.id AS "inscricaoId" FROM "VinculoClube" v JOIN "InscricaoClube" i ON i."clubeId" = v."clubeId"
    WHERE v."atletaId" = ${atletaId}::uuid AND i.id IN (${jogo.inscricaoClubeAId}::uuid, ${jogo.inscricaoClubeBId}::uuid)
      AND v.inicio <= ${jogo.iniciadoEm} AND (v.fim IS NULL OR v.fim > ${jogo.iniciadoEm})
    FOR SHARE OF v`;
  if (!vinculo) throw new ConflictException("O atleta não tinha vínculo com um dos clubes do jogo no início da partida.");
  const atleta = await tx.atleta.findUniqueOrThrow({ where: { usuarioId: atletaId }, select: { statusVerificacao: true, usuario: { select: { ativo: true } } } });
  if (atleta.statusVerificacao !== "aprovado") throw new ConflictException("Somente atleta aprovado tem a participação registrada.");
  const [carteirinha] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status::text AS status FROM "Carteirinha" WHERE "atletaId" = ${atletaId}::uuid FOR SHARE`;
  if (!carteirinha) throw new ConflictException("Somente atleta com carteirinha tem a participação registrada.");
  const [{ suspenso }] = await tx.$queryRaw<{ suspenso: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "CumprimentoSuspensao" c JOIN "Suspensao" s ON s.id = c."suspensaoId"
      WHERE c."jogoId" = ${jogoId}::uuid AND s."atletaId" = ${atletaId}::uuid) AS suspenso`;
  const irregularidades = [
    ...(!atleta.usuario.ativo ? ["conta_desativada" as const] : []),
    ...(carteirinha.status !== "ativa" ? ["carteirinha_invalidada" as const] : []),
    ...(suspenso ? ["suspensao" as const] : []),
  ];
  const ocupada = await tx.participacao.findFirst({ where: { jogoId, inscricaoClubeId: vinculo.inscricaoId, numeroCamisa: dados.numeroCamisa }, select: { id: true } });
  if (ocupada) throw new ConflictException(`A camisa ${dados.numeroCamisa} já está em uso por outro atleta deste clube no jogo.`);

  // `now()` da transação: o trigger confere que o registro e a entrada são datados nela.
  const entrada = dados.entrouEmQuadra ? Prisma.sql`now()` : Prisma.sql`NULL`;
  const irregularidadesSql = Prisma.sql`CAST(${`{${irregularidades.join(",")}}`} AS "IrregularidadeParticipacao"[])`;
  const atualizadas = await tx.$executeRaw`
    UPDATE "Participacao" SET "carteirinhaId" = ${carteirinha.id}::uuid, "credenciadoEm" = now(), "numeroCamisa" = ${dados.numeroCamisa},
      "entrouEmQuadraEm" = ${entrada}, "registradaPorPresidenteId" = ${presidenteId}::uuid, irregularidades = ${irregularidadesSql},
      "credenciamentoDesfeitoEm" = NULL
    WHERE "jogoId" = ${jogoId}::uuid AND "vinculoClubeId" = ${vinculo.id}::uuid AND "credenciadoEm" IS NULL`;
  if (atualizadas === 0) {
    await tx.$executeRaw`
      INSERT INTO "Participacao" (id, "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "carteirinhaId", "credenciadoEm", "numeroCamisa",
        "entrouEmQuadraEm", "registradaPorPresidenteId", irregularidades)
      VALUES (gen_random_uuid(), ${jogoId}::uuid, ${vinculo.inscricaoId}::uuid, ${vinculo.id}::uuid, ${atletaId}::uuid, ${carteirinha.id}::uuid, now(),
        ${dados.numeroCamisa}, ${entrada}, ${presidenteId}::uuid, ${irregularidadesSql})`;
  }
  const participacao = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  await registrarEvento(tx, jogoId, "credenciamento_registrado", atletaId);
  return { participacao: apresentar(participacao!), alterado: true };
}

/**
 * Presidente anula a entrada em quadra registrada por engano após o encerramento (MAR-83; seção 13). O horário original
 * permanece, com quem anulou e quando; a entrada anulada deixa de contar no histórico. Repetir devolve `alterado: false`.
 * Lançamentos não mudam: são corrigidos um a um. Ordem: campeonato → jogo → participação (FOR UPDATE).
 */
export async function anularEntrada(tx: Tx, presidenteId: string, jogoId: string, atletaId: string) {
  await jogoParaCorrecaoAdministrativa(tx, jogoId, "anula a entrada em quadra");
  const atual = await bloquearCredenciamento(tx, jogoId, atletaId);
  if (!atual) throw new ConflictException("O atleta não está credenciado neste jogo.");
  if (!atual.entrouEmQuadraEm) throw new ConflictException("O atleta não tem entrada em quadra registrada neste jogo.");
  if (atual.entradaAnuladaEm) return { participacao: apresentar(atual), alterado: false };
  await tx.$executeRaw`
    UPDATE "Participacao" SET "entradaAnuladaEm" = now(), "entradaAnuladaPorPresidenteId" = ${presidenteId}::uuid WHERE id = ${atual.id}::uuid`;
  const anulada = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  await registrarEvento(tx, jogoId, "credenciamento_corrigido", atletaId);
  return { participacao: apresentar(anulada!), alterado: true };
}

/**
 * Presidente desfaz, após o encerramento, o credenciamento de quem não participou (MAR-83; seção 13), quando não restam
 * entrada válida (sem entrada ou anulada) nem gols/penalidades válidos (anulados ou transferidos a outro atleta). O
 * histórico recebe a cópia completa — camisa, entrada, anulação, registro administrativo e o presidente autor — e a
 * participação é preservada sem etapas (`credenciamentoDesfeitoEm`), porque os lançamentos anulados continuam
 * apontando para ela; a escolha do técnico, se houver, permanece. Nada é apagado. Repetir devolve `alterado: false`.
 */
export async function estornarPeloPresidente(tx: Tx, presidenteId: string, jogoId: string, atletaId: string, dados: z.infer<typeof estornoSchema>) {
  await jogoParaCorrecaoAdministrativa(tx, jogoId, "desfaz o credenciamento");
  const atual = await bloquearCredenciamento(tx, jogoId, atletaId);
  if (!atual) {
    const anterior = await tx.alteracaoCredenciamento.findFirst({
      where: { jogoId, atletaId, tipo: "estorno" }, orderBy: [{ registradaEm: "desc" }, { id: "desc" }], select: selecaoAlteracao,
    });
    if (anterior?.numeroCamisaAnterior === dados.numeroCamisa) return { estorno: apresentarAlteracao(anterior), alterado: false };
    throw new ConflictException("O atleta não está credenciado neste jogo.");
  }
  if (atual.numeroCamisa !== dados.numeroCamisa) throw credenciamentoMudou(atual);
  if (atual.entrouEmQuadraEm && !atual.entradaAnuladaEm) {
    throw new ConflictException("O atleta tem entrada em quadra válida. Anule a entrada antes de desfazer o credenciamento.");
  }
  if (await tx.lancamentoJogo.count({ where: { participacaoId: atual.id, anuladoEm: null } }) > 0) {
    throw new ConflictException("O atleta tem gols ou penalidades válidos. Transfira ou anule cada lançamento antes de desfazer o credenciamento (restam lançamentos válidos).");
  }

  const estorno = await registrarAlteracao(tx, atual.id, "estorno", null, presidenteId);
  await tx.$executeRaw`
    UPDATE "Participacao" SET "carteirinhaId" = NULL, "credenciadoEm" = NULL, "numeroCamisa" = NULL, "entrouEmQuadraEm" = NULL,
      "entradaAnuladaEm" = NULL, "entradaAnuladaPorPresidenteId" = NULL, "registradaPorPresidenteId" = NULL,
      irregularidades = ARRAY[]::"IrregularidadeParticipacao"[], "credenciamentoDesfeitoEm" = now()
    WHERE id = ${atual.id}::uuid`;
  await registrarEvento(tx, jogoId, "credenciamento_desfeito", atletaId);
  return { estorno: apresentarAlteracao(estorno), alterado: true };
}

/**
 * Credenciamentos do jogo para o presidente (MAR-83), em qualquer status: participações credenciadas e desfeitas, com
 * entrada, anulação e registro administrativo, e o histórico completo de correções de camisa e estornos.
 */
export async function consultarCredenciamentosPeloPresidente(tx: Tx, jogoId: string) {
  const jogo = await tx.jogo.findUnique({ where: { id: jogoId }, select: { id: true, status: true } });
  if (!jogo) throw new NotFoundException("Jogo não encontrado.");
  const [participacoes, desfeitas, alteracoes] = await Promise.all([
    tx.participacao.findMany({ where: { jogoId, credenciadoEm: { not: null } }, select: selecaoParticipacao, orderBy: [{ inscricaoClubeId: "asc" }, { numeroCamisa: "asc" }] }),
    tx.participacao.findMany({ where: { jogoId, credenciamentoDesfeitoEm: { not: null } }, select: { id: true, inscricaoClubeId: true, credenciamentoDesfeitoEm: true, atleta: { select: { usuario: { select: { id: true, nomeCompleto: true } } } } }, orderBy: { id: "asc" } }),
    tx.alteracaoCredenciamento.findMany({ where: { jogoId }, select: selecaoAlteracao, orderBy: [{ registradaEm: "asc" }, { id: "asc" }] }),
  ]);
  return {
    jogo,
    participacoes: participacoes.map(apresentar),
    desfeitas: desfeitas.map(d => ({ participacaoId: d.id, inscricaoId: d.inscricaoClubeId, atleta: d.atleta.usuario, desfeitoEm: d.credenciamentoDesfeitoEm })),
    alteracoes: alteracoes.map(apresentarAlteracao),
  };
}

/** Restrições do banco (camisa ou credenciamento simultâneos, estado alterado) chegam como 409. */
export function traduzirErroCredenciamento(error: unknown): unknown {
  const conflito = new ConflictException("Credenciamento recusado por conflito com o estado atual do jogo, do atleta ou da camisa. Consulte a lista e tente novamente.");
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2025"].includes(error.code)) return conflito;
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo && ["23505", "23503", "23514", "40P01"].includes(codigo)) return conflito;
  return error;
}
