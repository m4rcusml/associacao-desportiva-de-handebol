import type { ReactNode } from "react";
import styles from "./visual.module.css";

type Tipo = "carteirinha" | "clube" | "clube-azul" | "clube-cobre" | "chevron" | "pessoa" | "pessoas" | "editar" | "calendario" | "trofeu";
export function IconePresidente({ tipo }: { tipo: Tipo }) {
  const tamanho = tipo === "carteirinha" ? 32 : tipo === "trofeu" ? 28 : tipo === "chevron" ? 20 : 24;
  // Assets locais exportados do Figma; não há transformação nem redimensionamento do desenho.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/figma/presidente/${tipo}.svg`} width={tamanho} height={tamanho} alt="" aria-hidden="true" />;
}

export function AtalhoPresidente({ titulo, detalhe, icone, aoAbrir }: { titulo: string; detalhe: ReactNode; icone: Tipo; aoAbrir: () => void }) {
  return <button type="button" className={styles.atalho} onClick={aoAbrir}><IconePresidente tipo={icone} /><span><strong className={styles.nome}>{titulo}</strong><span className={styles.meta}>{detalhe}</span></span><IconePresidente tipo="chevron" /></button>;
}

export function EmblemaClube({ nome, cobre = false }: { nome: string; cobre?: boolean }) {
  const palavras = nome.trim().split(/\s+/);
  const sigla = `${palavras[0]?.[0] ?? ""}${palavras.length > 1 ? palavras.at(-1)?.[0] ?? "" : ""}`.toLocaleUpperCase("pt-BR");
  return <span aria-hidden="true" className={`${styles.emblema} ${cobre ? styles.cobre : ""}`}><IconePresidente tipo={cobre ? "clube-cobre" : "clube-azul"} />{sigla}</span>;
}
