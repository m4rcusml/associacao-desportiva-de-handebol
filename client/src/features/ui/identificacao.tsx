import styles from "./identificacao.module.css";

export function Iniciais({ nome, grande = false }: { nome: string; grande?: boolean }) {
  const partes = nome.trim().split(/\s+/);
  const letras = `${partes[0]?.[0] ?? ""}${partes.length > 1 ? partes.at(-1)?.[0] ?? "" : ""}`.toLocaleUpperCase("pt-BR");
  return <span aria-hidden="true" className={`${styles.iniciais} ${grande ? styles.grande : ""}`}>{letras}</span>;
}
