/**
 * Conversão entre hora local de um fuso IANA e instante UTC (PEN-021). O dia do jogo é sempre
 * calculado no fuso do local da partida, nunca no do navegador de quem consulta.
 */

const formatadores = new Map<string, Intl.DateTimeFormat>();
/** Nome IANA (região/cidade ou UTC); recusa offsets como "+03:00" e abreviações soltas. */
const NOME_IANA = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

function formatador(fuso: string) {
  let formato = formatadores.get(fuso);
  if (!formato) {
    formato = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatadores.set(fuso, formato);
  }
  return formato;
}

export function fusoValido(fuso: string): boolean {
  if (!NOME_IANA.test(fuso)) return false;
  try {
    formatador(fuso);
    return true;
  } catch {
    return false;
  }
}

/** Hora local "AAAA-MM-DDTHH:mm" do instante no fuso informado. */
export function horaLocal(instante: Date, fuso: string): string {
  const partes = Object.fromEntries(formatador(fuso).formatToParts(instante).map(p => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

/** Diferença entre a hora local e o UTC no instante (ms). */
function deslocamentoMs(instante: number, fuso: string): number {
  const p = Object.fromEntries(formatador(fuso).formatToParts(new Date(instante)).map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (instante - (instante % 1000));
}

export type ConversaoLocal = { instante: Date } | { erro: "invalida" | "inexistente" | "ambigua" };

/**
 * Instante UTC correspondente à hora local "AAAA-MM-DDTHH:mm" no fuso. Horários pulados ou repetidos
 * por mudança de horário de verão são recusados, em vez de escolher um deles por suposição.
 */
export function instanteLocal(local: string, fuso: string): ConversaoLocal {
  const comoUtc = Date.parse(`${local}:00Z`);
  // Data de calendário inexistente (ex.: 30/02) não sobrevive à ida e volta em UTC.
  if (Number.isNaN(comoUtc) || new Date(comoUtc).toISOString().slice(0, 16) !== local) return { erro: "invalida" };
  const candidatos = new Set<number>();
  for (const referencia of [comoUtc - 86_400_000, comoUtc + 86_400_000]) {
    const instante = comoUtc - deslocamentoMs(referencia, fuso);
    if (horaLocal(new Date(instante), fuso) === local) candidatos.add(instante);
  }
  if (candidatos.size === 0) return { erro: "inexistente" };
  if (candidatos.size > 1) return { erro: "ambigua" };
  return { instante: new Date([...candidatos][0]) };
}
