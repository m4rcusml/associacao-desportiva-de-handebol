import type { StatusCarteirinha, StatusVerificacao } from "../../../lib/presidente";
import controles from "../../ui/controles.module.css";

export const NOME_PERFIL = { atleta: "Atleta", tecnico: "Técnico" } as const;
export const NOME_STATUS: Record<StatusVerificacao, string> = { pendente: "Pendente", aprovado: "Aprovado", rejeitado: "Rejeitado" };
export const CLASSE_STATUS: Record<StatusVerificacao, string> = {
  pendente: controles.statusPendente,
  aprovado: controles.statusAprovado,
  rejeitado: controles.statusRejeitado,
};
export const NOME_CARTEIRINHA: Record<StatusCarteirinha, string> = { ativa: "Ativa", invalidada: "Invalidada" };
export const CLASSE_CARTEIRINHA: Record<StatusCarteirinha, string> = { ativa: controles.statusAprovado, invalidada: controles.statusRejeitado };
