import { ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type StatusJogo } from "../../generated/prisma/client.js";
import { revalidarArbitragem } from "../arbitragem/acesso.js";
import { atletasComSuspensaoVigente } from "../suspensoes/suspensoes.js";

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
  atleta: { select: { usuario: { select: { id: true, nomeCompleto: true } } } },
} satisfies Prisma.ParticipacaoSelect;
type LinhaParticipacao = Prisma.ParticipacaoGetPayload<{ select: typeof selecaoParticipacao }>;

/** Dados da participação expostos à arbitragem: somente o necessário à operação (RNF-012). */
function apresentar(p: LinhaParticipacao) {
  return {
    participacaoId: p.id, inscricaoId: p.inscricaoClubeId, atleta: p.atleta.usuario,
    numeroCamisa: p.numeroCamisa, credenciadoEm: p.credenciadoEm, entrouEmQuadraEm: p.entrouEmQuadraEm, escalado: p.escolhidaEm !== null,
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
 * Ordem dos bloqueios: jogo → arbitragem → sessão (revalidação) → conta do atleta → carteirinha → vínculo (trigger).
 * Atleta já credenciado neste jogo com a mesma camisa (QR repetido, reenvio ou pedido simultâneo) devolve o registro
 * com `alterado: false`, mesmo que tenha ficado inapto depois: o credenciamento anterior é preservado (RN-013, PEN-011).
 */
export async function credenciar(tx: Tx, jogoId: string, token: string | undefined, dados: z.infer<typeof credenciamentoSchema>) {
  await revalidarArbitragem(tx, jogoId, token);
  const jogo = await lerJogo(tx, jogoId);
  const atletaId = "atletaId" in dados ? dados.atletaId : await atletaDoQr(tx, dados.tokenQr);
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
  const conta = await tx.usuario.findUniqueOrThrow({ where: { id: atletaId }, select: { ativo: true } });
  if (!conta.ativo) throw new ConflictException("Atleta com conta desativada não pode entrar em quadra.");
  const { count } = await tx.participacao.updateMany({ where: { id: existente.id, entrouEmQuadraEm: null }, data: { entrouEmQuadraEm: new Date() } });
  const atual = await credenciamentoDoAtleta(tx, jogoId, atletaId);
  return { participacao: apresentar(atual!), alterado: count > 0 };
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
