import type { ReactNode } from "react";
import styles from "./arbitragem.module.css";

export function CabecalhoArbitragem({ titulo = "Arbitragem", conexao, children }: { titulo?: string; conexao?: string; children?: ReactNode }) {
  return <header className={styles.cabecalho}><p className={styles.marca}>{titulo}</p>{conexao && <span className={styles.conexao} role="status">{conexao}</span>}{children}</header>;
}
