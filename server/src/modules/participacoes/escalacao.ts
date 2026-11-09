import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type StatusJogo } from "../../generated/prisma/client.js";
import type { Ator } from "../autorizacao/ator.js";
import { horaLocal } from "../jogos/fuso.js";
import { atletasComSuspensaoVigente } from "../suspensoes/suspensoes.js";

/** Inclusão de um atleta na escalação do clube do técnico (RF-016). */
export const escolhaSchema = z.strictObject({ atletaId: z.uuid().transform(id => id.toLowerCase()) });

type Tx = Prisma.TransactionClient;
type Leitura = Pick<Tx, "jogo" | "participacao" | "alteracaoEscalacao" | "vinculoClube" | "tecnico" | "$queryRaw">;

const pessoa = { select: { usuario: { select: { id: true, nomeCompleto: true } } } } as const;
const pessoaDoAtleta = { atleta: pessoa } as const;
const nome = ({ usuario }: { usuario: { id: string; nomeCompleto: string } }) => usuario;

/**
 * Escalação do jogo por clube (RN-014): somente escolhas preliminares, que não credenciam nem confirmam
 * entrada em quadra. O técnico vê só o próprio clube; o presidente, os dois. Cada escolha mostra o vínculo
 * usado (`vinculoAtual: false` depois de uma transferência: não serve para credenciar pelo clube anterior)
 * e quem a fez; `alteracoes` preserva todas as inclusões e retiradas, com o técnico responsável.
 * `atletasDoClube` são os que podem ser escolhidos: aprovados, com conta e carteirinha ativas e vínculo atual no clube.
 * `suspensaoPendente` sinaliza suspensão vigente no campeonato do jogo: não impede a escolha, porque o saldo pode ser
 * cumprido antes do jogo; quem barra é o credenciamento (decisão de Marcus, MAR-66).
 */
export async function consultarEscalacao(db: Leitura, jogoId: string, clubeDoTecnico?: string) {
  const jogo = await db.jogo.findUnique({ where: { id: jogoId }, select: {
    id: true, campeonatoId: true, status: true, fusoHorario: true, inicioPrevistoEm: true,
    inscricaoClubeA: { select: { id: true, clube: { select: { id: true, nome: true, cidade: true } } } },
    inscricaoClubeB: { select: { id: true, clube: { select: { id: true, nome: true, cidade: true } } } },
  } });
  if (!jogo) throw new NotFoundException("Jogo não encontrado");
  const { inscricaoClubeA, inscricaoClubeB, ...dados } = jogo;
  let inscricoes = [inscricaoClubeA, inscricaoClubeB];
  if (clubeDoTecnico !== undefined) {
    inscricoes = inscricoes.filter(i => i.clube.id === clubeDoTecnico);
    if (inscricoes.length === 0) throw new ForbiddenException("Acesso restrito aos jogos do seu clube");
  }

  const clubes = await Promise.all(inscricoes.map(async ({ id: inscricaoId, clube }) => {
    const [tecnico, escolhas, alteracoes, atletas] = await Promise.all([
      db.tecnico.findUnique({ where: { clubeId: clube.id }, ...pessoa }),
      db.participacao.findMany({
        where: { jogoId, inscricaoClubeId: inscricaoId, escolhidaEm: { not: null } },
        select: {
          id: true, escolhidaEm: true, atleta: pessoa, escolhidaPorTecnico: pessoa,
          vinculoClube: { select: { id: true, fim: true } },
        },
        orderBy: [{ escolhidaEm: "asc" }, { id: "asc" }],
      }),
      db.alteracaoEscalacao.findMany({
        where: { jogoId, vinculoClube: { clubeId: clube.id } },
        select: { tipo: true, ocorridoEm: true, vinculoClubeId: true, tecnico: pessoa, vinculoClube: { select: { atleta: pessoa } } },
        orderBy: [{ ocorridoEm: "asc" }, { id: "asc" }],
      }),
      db.vinculoClube.findMany({
        where: { clubeId: clube.id, fim: null, atleta: { statusVerificacao: "aprovado", usuario: { ativo: true }, carteirinha: { status: "ativa" } } },
        select: pessoaDoAtleta,
        orderBy: [{ atleta: { usuario: { nomeCompleto: "asc" } } }, { atletaId: "asc" }],
      }),
    ]);
    const suspensos = await atletasComSuspensaoVigente(db, dados.campeonatoId, [
      ...escolhas.map(e => e.atleta.usuario.id), ...atletas.map(a => a.atleta.usuario.id),
    ]);
    return {
      inscricaoId, clube, tecnico: tecnico ? nome(tecnico) : null,
      escalados: escolhas.map(({ id, escolhidaEm, atleta, escolhidaPorTecnico, vinculoClube }) => ({
        participacaoId: id, atleta: nome(atleta), vinculoClubeId: vinculoClube.id, vinculoAtual: vinculoClube.fim === null,
        escolhidaPorTecnico: escolhidaPorTecnico ? nome(escolhidaPorTecnico) : null, escolhidaEm,
        suspensaoPendente: suspensos.has(atleta.usuario.id),
      })),
      alteracoes: alteracoes.map(({ tipo, ocorridoEm, vinculoClubeId, tecnico, vinculoClube }) => ({
        tipo, atleta: nome(vinculoClube.atleta), vinculoClubeId, tecnico: nome(tecnico), ocorridoEm,
      })),
      atletasDoClube: atletas.map(({ atleta }) => ({ ...atleta.usuario, suspensaoPendente: suspensos.has(atleta.usuario.id) })),
    };
  }));
  return {
    jogo: { ...dados, inicioPrevistoLocal: dados.inicioPrevistoEm ? horaLocal(dados.inicioPrevistoEm, dados.fusoHorario) : null },
    clubes,
  };
}

/**
 * Bloqueia o jogo (FOR SHARE: o início concorrente aguarda ou já é visto) e devolve a inscrição do clube
 * do técnico. A escalação só muda com o jogo agendado: depois do início, somente a arbitragem inclui atletas.
 */
async function jogoDoClube(tx: Tx, jogoId: string, clubeId: string) {
  const [jogo] = await tx.$queryRaw<{ status: StatusJogo; inscricaoA: string; clubeA: string; inscricaoB: string; clubeB: string }[]>`
    SELECT j.status, a.id AS "inscricaoA", a."clubeId" AS "clubeA", b.id AS "inscricaoB", b."clubeId" AS "clubeB"
    FROM "Jogo" j
    JOIN "InscricaoClube" a ON a.id = j."inscricaoClubeAId"
    JOIN "InscricaoClube" b ON b.id = j."inscricaoClubeBId"
    WHERE j.id = ${jogoId}::uuid
    FOR SHARE OF j`;
  if (!jogo) throw new NotFoundException("Jogo não encontrado");
  const inscricaoId = jogo.clubeA === clubeId ? jogo.inscricaoA : jogo.clubeB === clubeId ? jogo.inscricaoB : null;
  if (!inscricaoId) throw new ForbiddenException("Acesso restrito aos jogos do seu clube");
  if (jogo.status !== "agendado") {
    throw new ConflictException(`A escalação só pode ser alterada até o início do jogo (jogo ${jogo.status.replace("_", " ")}).`);
  }
  return inscricaoId;
}

/** Clube do técnico já revalidado na transação (linha `Usuario` em FOR SHARE: substituição concorrente aguarda). */
function clubeDoTecnico(tecnico: Ator) {
  if (!tecnico.clubeId) throw new ForbiddenException("Técnico sem clube atribuído não escala atletas");
  return tecnico.clubeId.toLowerCase();
}

/**
 * Bloqueia a conta do atleta (FOR SHARE): transferência, aprovação e desativação (FOR UPDATE) aguardam ou
 * já são vistas. Devolve se a conta está ativa.
 */
async function bloquearAtleta(tx: Tx, atletaId: string) {
  const [conta] = await tx.$queryRaw<{ perfil: string; ativo: boolean }[]>`SELECT perfil::text AS perfil, ativo FROM "Usuario" WHERE id = ${atletaId}::uuid FOR SHARE`;
  if (conta?.perfil !== "atleta") throw new NotFoundException("Atleta não encontrado");
  return conta.ativo;
}

/** Carteirinha lida com FOR SHARE: invalidação concorrente (FOR UPDATE) aguarda ou já é vista. */
async function carteirinhaAtiva(tx: Tx, atletaId: string) {
  const [carteirinha] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "Carteirinha" WHERE "atletaId" = ${atletaId}::uuid FOR SHARE`;
  return carteirinha?.status === "ativa";
}

/**
 * Técnico aprovado atual escolhe um atleta aprovado, com conta ativa, carteirinha ativa e vínculo atual no
 * próprio clube, para um jogo agendado do clube (RF-016, RN-014, PEN-018). Quem seria barrado no
 * credenciamento por esses motivos não é escolhido (decisão de Marcus, MAR-64). Suspensão vigente não impede a
 * escolha, apenas é sinalizada na consulta (MAR-66). Não credencia nem confirma entrada. Atleta já escolhido, inclusive pelo
 * técnico anterior, permanece como está (`alterado: false`), preservando a autoria. Se a participação já
 * existir sem escolha (credenciamento futuro), recebe a escolha. Ordem dos bloqueios: técnico → jogo → atleta.
 */
export async function escolherAtleta(tx: Tx, tecnico: Ator, jogoId: string, atletaId: string) {
  const clubeId = clubeDoTecnico(tecnico);
  const inscricaoClubeId = await jogoDoClube(tx, jogoId, clubeId);
  const contaAtiva = await bloquearAtleta(tx, atletaId);
  const atleta = await tx.atleta.findUnique({ where: { usuarioId: atletaId }, select: {
    statusVerificacao: true, vinculos: { where: { fim: null }, select: { id: true, clubeId: true } },
  } });
  if (!atleta) throw new NotFoundException("Atleta não encontrado");
  if (atleta.statusVerificacao !== "aprovado") throw new ConflictException("Somente atleta aprovado pode ser escalado.");
  const vinculo = atleta.vinculos[0];
  if (vinculo?.clubeId !== clubeId) throw new ConflictException("O técnico escala somente atletas com vínculo atual com o próprio clube.");
  if (!contaAtiva) throw new ConflictException("Atleta com conta desativada não pode ser escalado.");
  if (!await carteirinhaAtiva(tx, atletaId)) throw new ConflictException("Atleta com carteirinha invalidada não pode ser escalado.");

  const existente = await tx.participacao.findUnique({ where: { jogoId_vinculoClubeId: { jogoId, vinculoClubeId: vinculo.id } }, select: { id: true, escolhidaEm: true } });
  if (existente?.escolhidaEm) return { ...await consultarEscalacao(tx, jogoId, clubeId), alterado: false };

  // Escritas condicionais: pedido repetido em paralelo espera o primeiro e termina sem efeito, em vez de 409.
  const agora = new Date();
  const incluiu = existente
    ? (await tx.participacao.updateMany({ where: { id: existente.id, escolhidaEm: null }, data: { escolhidaPorTecnicoId: tecnico.usuarioId, escolhidaEm: agora } })).count > 0
    : (await tx.$queryRaw<unknown[]>`
        INSERT INTO "Participacao" (id, "jogoId", "inscricaoClubeId", "vinculoClubeId", "atletaId", "escolhidaPorTecnicoId", "escolhidaEm")
        VALUES (gen_random_uuid(), ${jogoId}::uuid, ${inscricaoClubeId}::uuid, ${vinculo.id}::uuid, ${atletaId}::uuid, ${tecnico.usuarioId}::uuid, ${agora})
        ON CONFLICT ("jogoId", "vinculoClubeId") DO NOTHING
        RETURNING id`).length > 0;
  if (!incluiu) {
    const atual = await tx.participacao.findUnique({ where: { jogoId_vinculoClubeId: { jogoId, vinculoClubeId: vinculo.id } }, select: { escolhidaEm: true } });
    if (!atual?.escolhidaEm) throw new ConflictException("A escalação mudou durante a operação. Consulte-a e tente novamente.");
    return { ...await consultarEscalacao(tx, jogoId, clubeId), alterado: false };
  }
  await tx.alteracaoEscalacao.create({ data: { jogoId, vinculoClubeId: vinculo.id, tipo: "inclusao", tecnicoId: tecnico.usuarioId, ocorridoEm: agora } });
  return { ...await consultarEscalacao(tx, jogoId, clubeId), alterado: true };
}

/**
 * Técnico aprovado atual retira o atleta da escalação do próprio clube até o início do jogo, inclusive escolha
 * feita pelo técnico anterior ou por vínculo já encerrado (atleta transferido). Sem outra etapa, a participação
 * é removida; credenciamento futuro é preservado e só perde a escolha. A retirada fica no histórico com o
 * técnico responsável. Atleta não escalado: `alterado: false`.
 */
export async function retirarAtleta(tx: Tx, tecnico: Ator, jogoId: string, atletaId: string) {
  const clubeId = clubeDoTecnico(tecnico);
  const inscricaoClubeId = await jogoDoClube(tx, jogoId, clubeId);
  await bloquearAtleta(tx, atletaId);
  const escolhas = await tx.participacao.findMany({
    where: { jogoId, inscricaoClubeId, atletaId, escolhidaEm: { not: null } },
    select: { id: true, vinculoClubeId: true, credenciadoEm: true },
  });
  const agora = new Date();
  let alterado = false;
  for (const { id, vinculoClubeId, credenciadoEm } of escolhas) {
    // Condicionais: retirada repetida em paralelo espera a primeira e não registra outra remoção.
    const onde = { id, escolhidaEm: { not: null } };
    const { count } = credenciadoEm
      ? await tx.participacao.updateMany({ where: onde, data: { escolhidaPorTecnicoId: null, escolhidaEm: null } })
      : await tx.participacao.deleteMany({ where: { ...onde, credenciadoEm: null } });
    if (count === 0) continue;
    alterado = true;
    await tx.alteracaoEscalacao.create({ data: { jogoId, vinculoClubeId, tipo: "remocao", tecnicoId: tecnico.usuarioId, ocorridoEm: agora } });
  }
  return { ...await consultarEscalacao(tx, jogoId, clubeId), alterado };
}

/** Restrições do banco (escolha duplicada simultânea, jogo iniciado, vínculo encerrado) chegam como 409. */
export function traduzirErroEscalacao(error: unknown): unknown {
  const conflito = new ConflictException("Escalação recusada por conflito com o estado atual do jogo, do atleta ou do técnico. Consulte-a e tente novamente.");
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2025"].includes(error.code)) return conflito;
  type ErroDriver = { cause?: { originalCode?: string } };
  const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
  const codigo = driver?.cause?.originalCode;
  if (codigo && ["23505", "23503", "23514", "40P01"].includes(codigo)) return conflito;
  return error;
}
