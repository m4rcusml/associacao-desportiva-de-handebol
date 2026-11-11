// Formatação compartilhada pelas áreas do presidente. Datas da API chegam como texto ISO (UTC).

const formatoDataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
});
const FUSO_PADRAO = "America/Sao_Paulo";
const formatosDia = new Map<string, Intl.DateTimeFormat>();

function formatoDia(fusoHorario: string): Intl.DateTimeFormat {
  let formato = formatosDia.get(fusoHorario);
  if (!formato) {
    try {
      formato = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: fusoHorario });
    } catch {
      // Fuso IANA desconhecido pelo navegador: usa o horário de Brasília em vez de quebrar a tela.
      formato = formatoDia(FUSO_PADRAO);
    }
    formatosDia.set(fusoHorario, formato);
  }
  return formato;
}

/** Data e hora no horário de Brasília; "Sem registro" quando ausente. */
export function data(iso: string | null | undefined) {
  return iso ? formatoDataHora.format(new Date(iso)) : "Sem registro";
}

/**
 * Somente o dia de um instante, no fuso informado (ex.: `fusoHorario` do jogo) ou, por padrão, no horário
 * de Brasília; "Sem registro" quando ausente.
 */
export function dia(iso: string | null | undefined, fusoHorario: string = FUSO_PADRAO) {
  return iso ? formatoDia(fusoHorario).format(new Date(iso)) : "Sem registro";
}

/** Texto para busca: sem acentos, minúsculo e sem espaços nas pontas. */
export function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** "1 clube" / "3 clubes". */
export function contar(quantidade: number, singular: string, plural: string) {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`;
}
