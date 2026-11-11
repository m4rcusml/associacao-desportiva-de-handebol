import { uuidValido } from "./area-pessoal";

/** Só aceita UUID ou link da própria aplicação. Texto/metadata do link nunca vira dado oficial. */
export function identificarJogo(entrada: string, origem: string): string | null {
  const texto = entrada.trim();
  if (uuidValido(texto)) return texto.toLowerCase();
  try {
    const url = new URL(texto, origem);
    if (url.origin !== origem || url.username || url.password) return null;
    const encontrado = /^\/tecnico\/jogos\/([^/]+)\/?$/.exec(url.pathname);
    return encontrado && uuidValido(encontrado[1]) ? encontrado[1].toLowerCase() : null;
  } catch { return null; }
}

export const LIMITE_ATALHOS = 8;
export type AtalhoJogo = { id: string; rotulo: string };
export function normalizarAtalhos(valor: unknown): AtalhoJogo[] {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<string>();
  const atalhos: AtalhoJogo[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !uuidValido(item.id) || typeof item.rotulo !== "string") continue;
    const id = item.id.toLowerCase();
    if (vistos.has(id)) continue;
    vistos.add(id);
    atalhos.push({ id, rotulo: item.rotulo.trim().slice(0, 200) || "Jogo consultado" });
    if (atalhos.length === LIMITE_ATALHOS) break;
  }
  return atalhos;
}
const chave = (usuarioId: string, clubeId: string) => `handebol:tecnico:jogos:v1:${usuarioId}:${clubeId}`;
export function lerAtalhos(usuarioId: string, clubeId: string): AtalhoJogo[] {
  try { return normalizarAtalhos(JSON.parse(localStorage.getItem(chave(usuarioId, clubeId)) ?? "[]")); }
  catch { return []; }
}
export function salvarAtalhos(usuarioId: string, clubeId: string, atalhos: AtalhoJogo[]) {
  try { localStorage.setItem(chave(usuarioId, clubeId), JSON.stringify(normalizarAtalhos(atalhos))); }
  catch { /* Atalhos são opcionais; armazenamento indisponível não impede abrir um jogo. */ }
}
