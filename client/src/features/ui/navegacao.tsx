"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./navegacao.module.css";

export type SecaoArea = { href: string; rotulo: string; icone?: string; iconeAtivo?: string; iconeDesktop?: string; iconeTamanho?: number; exata?: boolean };

export function CabecalhoArea({ secoes, nome, area, conteudoId, contaHref, navegacaoInferior = false, ativaHref, contaIcone, marcaMobile = "Handebol", marcaDesktop, mostrarNomeDesktop = false }: {
  secoes: readonly SecaoArea[]; nome?: string; area: string; conteudoId: string; contaHref?: string;
  navegacaoInferior?: boolean; ativaHref?: string; contaIcone?: string;
  marcaMobile?: string; marcaDesktop?: string; mostrarNomeDesktop?: boolean;
}) {
  const caminho = usePathname();
  return <>
    <a className={styles.pular} href={`#${conteudoId}`}>Ir ao conteúdo</a>
    <header className={`${styles.cabecalho} ${navegacaoInferior ? styles.inferior : ""} ${contaIcone ? styles.compacto : ""} ${mostrarNomeDesktop ? styles.contaVisivel : ""}`}>
      <div className={styles.barra}>
        <Link className={styles.marca} href={secoes[0]?.href ?? "/"}>{navegacaoInferior ? <><span className={styles.marcaMobile}>{marcaMobile}</span><span className={styles.marcaDesktop}>{marcaDesktop ?? "Associação de Handebol"}</span></> : "Handebol"}</Link>
        {nome && contaHref && <Link className={styles.conta} href={contaHref} aria-label={nome}>{contaIcone && <Image className={styles.contaIcone} src={contaIcone} alt="" width={22} height={22} />}<span className={styles.contaNome}>{nome}</span></Link>}
      </div>
      {secoes.length > 0 && <nav className={styles.nav} aria-label={area}>
        {secoes.map(secao => {
          const ativa = ativaHref ? ativaHref === secao.href : caminho === secao.href || (!secao.exata && caminho.startsWith(`${secao.href}/`));
          return <Link key={secao.href} href={secao.href} aria-current={ativa ? "page" : undefined}>
          {secao.icone && <Image className={secao.iconeDesktop ? styles.iconeMobile : undefined} src={ativa ? secao.iconeAtivo ?? secao.icone : secao.icone} alt="" width={secao.iconeTamanho ?? 20} height={secao.iconeTamanho ?? 20} />}
          {secao.iconeDesktop && <Image className={styles.iconeDesktop} src={secao.iconeDesktop} alt="" width={20} height={20} />}
          <span>{secao.rotulo}</span>
        </Link>; })}
      </nav>}
    </header>
  </>;
}
