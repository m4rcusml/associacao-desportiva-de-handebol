import type { StatusCampeonato, StatusJogo } from "../../../lib/presidente";
export { normalizar, data as instante } from "../../ui/formatos";

export const NOME_STATUS_CAMPEONATO: Record<StatusCampeonato, string> = {
  planejado: "Planejado", em_andamento: "Em andamento", encerrado: "Encerrado", cancelado: "Cancelado",
};
export const NOME_STATUS_JOGO: Record<StatusJogo, string> = {
  agendado: "Agendado", em_andamento: "Em andamento", finalizado: "Finalizado", cancelado: "Cancelado",
};
// As datas civis do campeonato e a hora local do jogo não devem passar por conversão de fuso.
export function dataCivil(valor: string | null) {
  if (!valor) return "Não informada";
  return valor.slice(0, 10).split("-").reverse().join("/");
}
export function horaLocal(valor: string | null) {
  return valor ? `${dataCivil(valor)} às ${valor.slice(11, 16)}` : "Sem data definida";
}
