import styles from "./linhas-quadra.module.css";

/** Linhas da área de gol (6 m contínua, 9 m tracejada e o gol), decorativas, para faixas em azul de quadra. */
export function LinhasQuadra() {
  return (
    <svg className={styles.quadra} viewBox="0 0 220 160" aria-hidden="true" focusable="false">
      <line x1="219" y1="0" x2="219" y2="160" />
      <path d="M219 20 A60 60 0 0 0 159 80 A60 60 0 0 0 219 140" />
      <path className={styles.linhaNove} d="M219 0 A90 90 0 0 0 129 80 A90 90 0 0 0 219 160" />
      <rect x="211" y="65" width="8" height="30" />
    </svg>
  );
}
