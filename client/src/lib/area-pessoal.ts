import type { ClubeBasico, Pessoa, ReferenciaClube, StatusCarteirinha, StatusVerificacao } from "./presidente";

export type ClubePessoal = ClubeBasico & { tecnico: Pessoa | null };
export type CarteirinhaPropria = {
  id: string;
  codigo: string;
  tokenQr: string;
  status: StatusCarteirinha;
  emitidaEm: string;
  nomeCompleto: string;
  clubeAtual: ReferenciaClube | null;
  possuiFoto: boolean;
};
export type NovaAnalise = { statusVerificacao: StatusVerificacao; verificacaoSolicitadaEm: string | null; alterado: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uuidValido(valor: string) { return UUID.test(valor); }

/** Agrupa os detalhes nas mesmas abas que oferecem sua navegação. */
export function secaoPessoal(perfil: "atleta" | "tecnico", caminho: string) {
  const base = `/${perfil}`;
  const dentro = (secao: string) => caminho === `${base}/${secao}` || caminho.startsWith(`${base}/${secao}/`);
  if (perfil === "atleta") {
    if (dentro("historico")) return `${base}/historico`;
    if (dentro("clubes")) return `${base}/clubes`;
    if (dentro("conta")) return `${base}/conta`;
  } else {
    if (dentro("clube") || dentro("atletas")) return `${base}/clube`;
    if (dentro("conta") || dentro("clubes")) return `${base}/conta`;
  }
  return base;
}

/** Horário no fuso do jogo, nunca no fuso implícito do dispositivo. */
export function horarioJogo(iso: string | null, fuso: string) {
  if (!iso) return "Horário não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: fuso }).format(new Date(iso));
}
