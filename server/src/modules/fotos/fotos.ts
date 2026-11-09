import { randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException, BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import sharp from "sharp";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Ator } from "../autorizacao/ator.js";
import { revalidarArbitragem } from "../arbitragem/acesso.js";
import { extensoes, type TipoImagem } from "./armazenamento.js";

type Tx = Prisma.TransactionClient;

/** Limite por arquivo (seção 11): 5 MB, contados como 5 × 1024 × 1024 bytes. */
export const LIMITE_FOTO_BYTES = 5 * 1024 * 1024;
const tiposAceitos = Object.keys(extensoes) as TipoImagem[];
// libvips compartilha cache e fila de avisos: valide uma imagem por vez, sem reaproveitar pixels corrompidos.
sharp.cache(false);
let validacaoAnterior: Promise<TipoImagem | null> = Promise.resolve(null);

/**
 * Identifica o formato e decodifica todos os pixels antes do envio, sem confiar na extensão ou no Content-Type.
 * Somente valida: os bytes originais, incluindo EXIF, continuam sendo armazenados sem reprocessamento.
 */
export function detectarImagem(conteudo: Buffer): Promise<TipoImagem | null> {
  const validacao = validacaoAnterior.then(async () => {
    try {
      const imagem = sharp(conteudo, { failOn: "warning", animated: true });
      let aviso = false;
      imagem.on("warning", () => { aviso = true; });
      const { format } = await imagem.metadata();
      const tipo = `image/${format}`;
      if (!tiposAceitos.includes(tipo as TipoImagem)) return null;
      await imagem.stats();
      return aviso ? null : tipo as TipoImagem;
    } catch {
      return null;
    }
  });
  validacaoAnterior = validacao;
  return validacao;
}

/**
 * Lê o corpo binário da requisição (Content-Type do formato da imagem), com o limite aplicado antes de
 * acumular. Acima do limite, o restante é descartado sem guardar e a resposta é 413.
 */
export async function lerImagem(request: Request): Promise<{ conteudo: Buffer; tipo: TipoImagem }> {
  const declarado = (request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!tiposAceitos.includes(declarado as TipoImagem)) {
    request.resume();
    throw new UnsupportedMediaTypeException("Envie a foto como corpo binário com Content-Type image/jpeg, image/png ou image/webp.");
  }
  const partes: Buffer[] = [];
  let total = 0;
  let excedeu = Number(request.headers["content-length"]) > LIMITE_FOTO_BYTES;
  for await (const parte of request as AsyncIterable<Buffer>) {
    if (excedeu) continue;
    total += parte.length;
    if (total > LIMITE_FOTO_BYTES) { excedeu = true; partes.length = 0; continue; }
    partes.push(parte);
  }
  if (excedeu) throw new PayloadTooLargeException("A foto deve ter no máximo 5 MB.");
  const conteudo = Buffer.concat(partes);
  if (conteudo.length === 0) throw new BadRequestException("Envie o arquivo da foto no corpo da requisição.");
  const tipo = await detectarImagem(conteudo);
  if (!tipo) throw new UnsupportedMediaTypeException("O conteúdo não é uma imagem JPEG, PNG ou WebP válida.");
  if (tipo !== declarado) throw new UnsupportedMediaTypeException(`O conteúdo é ${tipo}, diferente do Content-Type informado.`);
  return { conteudo, tipo };
}

/** Chave nova a cada envio: a foto atual nunca é sobrescrita antes de a troca ser confirmada no banco. */
export const novaChave = (atletaId: string, tipo: TipoImagem) => `atletas/${atletaId}/${randomUUID()}.${extensoes[tipo]}`;

/** Envio e substituição (seção 11): o próprio atleta ou um presidente. Não exige aprovação nem a altera. */
export function exigirEnvio(ator: Ator, atletaId: string) {
  if (ator.perfil === "presidente") return;
  if (ator.perfil === "atleta" && ator.usuarioId === atletaId) return;
  throw new ForbiddenException("Somente o próprio atleta ou um presidente envia a foto.");
}

export async function exigirAtleta(db: Pick<Tx, "atleta">, atletaId: string) {
  if (!await db.atleta.findUnique({ where: { usuarioId: atletaId }, select: { usuarioId: true } })) throw new NotFoundException("Atleta não encontrado");
}

/**
 * Grava a nova chave com a linha do atleta bloqueada (FOR UPDATE): envios simultâneos se sucedem, e cada
 * um devolve a chave que substituiu para remoção após o commit. Status de verificação e carteirinha não mudam.
 */
export async function registrarFoto(tx: Tx, ator: Ator, atletaId: string, chave: string) {
  exigirEnvio(ator, atletaId);
  const [linha] = await tx.$queryRaw<{ fotoChave: string | null }[]>`
    SELECT "fotoChave" FROM "Atleta" WHERE "usuarioId" = ${atletaId}::uuid FOR UPDATE`;
  if (!linha) throw new NotFoundException("Atleta não encontrado");
  await tx.atleta.update({ where: { usuarioId: atletaId }, data: { fotoChave: chave } });
  return { anterior: linha.fotoChave };
}

/**
 * Leitura por conta (seção 11): o próprio atleta, presidentes e o técnico atual do clube do atleta
 * (técnico aprovado, vínculo aberto do atleta no clube dele). Outras contas, inclusive atletas do mesmo
 * clube e técnicos de clubes anteriores, recebem 403, sem revelar se o atleta existe.
 */
export async function chaveParaConta(tx: Tx, leitor: Ator, atletaId: string): Promise<string | null> {
  const atleta = await tx.atleta.findUnique({ where: { usuarioId: atletaId }, select: {
    fotoChave: true, vinculos: { where: { fim: null }, select: { clubeId: true }, take: 1 },
  } });
  const permitido = leitor.perfil === "presidente"
    || (leitor.perfil === "atleta" && leitor.usuarioId === atletaId)
    || (leitor.perfil === "tecnico" && leitor.aprovado && leitor.clubeId !== null && atleta?.vinculos[0]?.clubeId === leitor.clubeId);
  if (!permitido) throw new ForbiddenException("Sem permissão para consultar a foto deste atleta.");
  if (!atleta) throw new NotFoundException("Atleta não encontrado");
  return atleta.fotoChave;
}

/**
 * Leitura pela arbitragem (seção 11): sessão temporária válida do jogo e atleta escalado ou credenciado
 * nele. O QR sozinho não dá acesso: sem a sessão do jogo, a leitura é negada.
 */
export async function chaveParaArbitragem(tx: Tx, jogoId: string, token: string | undefined, atletaId: string): Promise<string | null> {
  await revalidarArbitragem(tx, jogoId, token);
  const participacao = await tx.participacao.findFirst({
    where: { jogoId, atletaId, OR: [{ escolhidaEm: { not: null } }, { credenciadoEm: { not: null } }] },
    select: { atleta: { select: { fotoChave: true } } },
  });
  if (!participacao) throw new ForbiddenException("Atleta não escalado nem credenciado neste jogo.");
  return participacao.atleta.fotoChave;
}
