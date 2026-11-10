// Referências locais (só ID e nome) dos presidentes criados neste navegador. A API não lista presidentes
// e não informa a situação das contas: estes dados não substituem o servidor e podem estar desatualizados.

export type ReferenciaPresidente = { id: string; nomeCompleto: string };

type Armazenado = { versao: 1; itens: ReferenciaPresidente[] };

const VERSAO = 1;
const LIMITE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(texto: string) {
  return UUID.test(texto);
}

/** Uma lista por presidente autenticado, para não misturar referências de contas diferentes no mesmo navegador. */
function chave(presidenteId: string) {
  return `adh:presidente:${presidenteId.toLowerCase()}:presidentes-criados`;
}

function valido(item: unknown): item is ReferenciaPresidente {
  if (typeof item !== "object" || item === null) return false;
  const { id, nomeCompleto } = item as Record<string, unknown>;
  return typeof id === "string" && ehUuid(id)
    && typeof nomeCompleto === "string" && nomeCompleto.trim().length > 0 && nomeCompleto.length <= 150;
}

/** Lê a lista; armazenamento indisponível, versão diferente ou conteúdo inválido resultam em lista vazia ou filtrada. */
export function lerReferencias(presidenteId: string): ReferenciaPresidente[] {
  try {
    const texto = window.localStorage.getItem(chave(presidenteId));
    if (!texto) return [];
    const dados = JSON.parse(texto) as unknown;
    if (typeof dados !== "object" || dados === null) return [];
    const { versao, itens } = dados as Record<string, unknown>;
    if (versao !== VERSAO || !Array.isArray(itens)) return [];
    const vistos = new Set<string>();
    const lidos: ReferenciaPresidente[] = [];
    for (const item of itens) {
      if (!valido(item)) continue;
      const id = item.id.toLowerCase();
      if (id === presidenteId.toLowerCase() || vistos.has(id)) continue;
      vistos.add(id);
      lidos.push({ id, nomeCompleto: item.nomeCompleto.trim() });
    }
    return lidos.slice(0, LIMITE);
  } catch {
    return [];
  }
}

/** Grava a lista; devolve false quando o navegador não permite (modo privado, cota ou bloqueio). */
export function gravarReferencias(presidenteId: string, itens: ReferenciaPresidente[]): boolean {
  try {
    const dados: Armazenado = { versao: VERSAO, itens: itens.slice(0, LIMITE).map(({ id, nomeCompleto }) => ({ id, nomeCompleto })) };
    window.localStorage.setItem(chave(presidenteId), JSON.stringify(dados));
    return true;
  } catch {
    return false;
  }
}
