import type { ReactNode } from "react";
import tema from "../../features/ui/tema.module.css";
import styles from "../../features/arbitragem/arbitragem.module.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <div className={`${tema.tema} ${styles.area}`}>
    <a href="#conteudo-arbitragem" className={styles.pular}>Pular para o conteúdo</a>
    <main id="conteudo-arbitragem" className={styles.area}>{children}</main>
  </div>;
}
