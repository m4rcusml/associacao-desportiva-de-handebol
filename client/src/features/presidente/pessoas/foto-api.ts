import { apiUrl, ApiError } from "../../../lib/api";

/** Mesmo limite e formatos de `server/src/modules/fotos/fotos.ts` (4 MiB; JPEG, PNG ou WebP). */
export const LIMITE_FOTO_BYTES = 4 * 1024 * 1024;
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;

export type EnvioFoto = { atletaId: string; foto: { tipo: string; tamanho: number }; substituida: boolean };

const caminho = (atletaId: string) => `${apiUrl}/atletas/${encodeURIComponent(atletaId)}/foto`;

async function erroDe(resposta: Response): Promise<ApiError> {
  if (resposta.status === 401) return new ApiError("Entre com seu e-mail e senha para continuar.", 401);
  if (resposta.status === 429) return new ApiError("Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429);
  let mensagem: unknown;
  try { mensagem = (JSON.parse(await resposta.text()) as { message?: unknown } | null)?.message; } catch { mensagem = undefined; }
  return new ApiError(typeof mensagem === "string" ? mensagem : "Não foi possível concluir. Tente novamente.", resposta.status);
}

async function requisitar(atletaId: string, init: RequestInit) {
  try {
    return await fetch(caminho(atletaId), { ...init, credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError("Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.", 0);
  }
}

/** Foto privada do atleta, lida pela API com a sessão. `null` quando o atleta não tem foto (404). */
export async function lerFoto(atletaId: string): Promise<Blob | null> {
  const resposta = await requisitar(atletaId, { method: "GET" });
  if (resposta.status === 404) return null;
  if (!resposta.ok) throw await erroDe(resposta);
  return resposta.blob();
}

/** Envia ou substitui a foto como corpo binário, com o Content-Type do arquivo (sem multipart). */
export async function enviarFoto(atletaId: string, arquivo: File): Promise<EnvioFoto> {
  const resposta = await requisitar(atletaId, { method: "PUT", headers: { "Content-Type": arquivo.type }, body: arquivo });
  if (!resposta.ok) throw await erroDe(resposta);
  return await resposta.json() as EnvioFoto;
}

/** Validação local antes do envio; o servidor confere o conteúdo de novo. Devolve a mensagem de erro ou "". */
export function validarArquivo(arquivo: File) {
  if (!(TIPOS_FOTO as readonly string[]).includes(arquivo.type)) return "Escolha uma imagem JPEG, PNG ou WebP.";
  if (arquivo.size === 0) return "O arquivo escolhido está vazio.";
  if (arquivo.size > LIMITE_FOTO_BYTES) return "A foto deve ter no máximo 4 MB.";
  return "";
}
