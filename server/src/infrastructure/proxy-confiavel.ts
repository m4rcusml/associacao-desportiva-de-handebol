import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Proxy confiável da implantação hospedada (MAR-76; arquitetura, "Ambientes e implantação").
 *
 * O domínio público (Vercel) encaminha `/api` ao Render pelo `proxy.ts` do client, que acrescenta o segredo
 * compartilhado e o IP do cliente lido pela Vercel. Com `PROXY_SEGREDO` definido, o backend recusa requisições
 * sem o segredo (acesso direto ao Render) e usa somente o IP informado pelo proxy nos limites de tentativa;
 * `X-Forwarded-For` enviado pelo cliente é descartado. Sem `PROXY_SEGREDO` (desenvolvimento e testes), nada muda.
 */
export const CABECALHO_SEGREDO_PROXY = "x-proxy-segredo";
export const CABECALHO_IP_CLIENTE = "x-cliente-ip";
/** Verificações da hospedagem (Render), chamadas diretamente, sem o proxy público. */
export const ROTAS_SAUDE = new Set(["/api/health", "/api/health/ready"]);

export function lerSegredoProxy(env: NodeJS.ProcessEnv = process.env): string | null {
  const segredo = env.PROXY_SEGREDO;
  if (!segredo) {
    if (env.NODE_ENV === "production") throw new Error("Produção exige PROXY_SEGREDO (mínimo 32 caracteres), o mesmo configurado no client");
    return null;
  }
  if (segredo.length < 32) throw new Error("PROXY_SEGREDO deve ter no mínimo 32 caracteres");
  return segredo;
}

const resumo = (valor: string) => createHash("sha256").update(valor).digest();

/** Comparação em tempo constante do segredo recebido; cabeçalho ausente ou repetido é recusado. */
export function segredoConfere(headers: IncomingHttpHeaders, segredo: string): boolean {
  const recebido = headers[CABECALHO_SEGREDO_PROXY];
  return typeof recebido === "string" && timingSafeEqual(resumo(recebido), resumo(segredo));
}

/** IP do cliente informado pelo proxy, somente se for um endereço válido. */
export function ipDoCliente(headers: IncomingHttpHeaders): string | null {
  const valor = headers[CABECALHO_IP_CLIENTE];
  return typeof valor === "string" && isIP(valor.trim()) ? valor.trim() : null;
}
