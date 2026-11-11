"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { uuidValido, type ClubePessoal } from "../../lib/area-pessoal";
import { normalizar } from "../ui/formatos";
import { useAreaPessoal } from "./shell";
import { EstadoConsulta, useConsulta } from "./consulta";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./pessoal.module.css";

export function ClubesPessoais() {
  const { sessao } = useAreaPessoal();
  const consulta = useConsulta<ClubePessoal[]>("/clubes/visao-geral");
  const [busca, setBusca] = useState("");
  const clubes = consulta.dados?.filter(c => normalizar(`${c.nome} ${c.cidade ?? ""}`).includes(normalizar(busca)));
  return <div className={styles.pilha}>
    <h1 className={styles.titulo}>Clubes da associação</h1>
    <p className={styles.texto}>Clubes e técnicos atuais.</p>
    {clubes && <ul className={styles.clubesLista}>{clubes.map((c, indice) => <li key={c.id}>
      <Link href={`/${sessao.usuario.perfil}/clubes/${c.id}`} className={styles.atalho}>
        <EmblemaClube nome={c.nome} cobre={indice % 2 === 1} />
        <span><strong>{c.nome}{c.id === sessao.usuario.clubeId ? " (seu clube)" : ""}</strong><small>{c.tecnico?.nomeCompleto ?? "Sem técnico atribuído"}</small></span>
        <Image src="/figma/pessoal/chevron.svg" alt="" width={20} height={20} />
      </Link>
    </li>)}</ul>}
    {clubes && !clubes.length && <p className={pagina.texto}>{busca ? "Nenhum clube encontrado para essa busca." : "Nenhum clube cadastrado."}</p>}
    <details className={styles.ajudaDetalhe}><summary>Buscar clube ou cidade</summary><div className={styles.filtros}><label className={controles.rotulo} htmlFor="buscar-clube">Nome ou cidade</label><input id="buscar-clube" className={controles.entrada} type="search" value={busca} onChange={e => setBusca(e.target.value)} /></div></details>
    <EstadoConsulta {...consulta} atualizar={() => { void consulta.carregar(); }} />
  </div>;
}

export function ClubePessoalDetalhe({ id }: { id: string }) {
  const { sessao } = useAreaPessoal();
  const consulta = useConsulta<ClubePessoal>(uuidValido(id) ? `/clubes/${id}` : null);
  if (!uuidValido(id)) return <p className={controles.erro} role="alert">Identificador de clube inválido. Abra um clube pela consulta de clubes.</p>;
  return <div className={styles.pilha}>
    <Link className={styles.link} href={`/${sessao.usuario.perfil}/clubes`}>Voltar aos clubes</Link>
    {consulta.dados && <EmblemaClube nome={consulta.dados.nome} />}
    <h1 className={styles.titulo}>{consulta.dados?.nome ?? "Clube"}</h1>
    <EstadoConsulta {...consulta} atualizar={() => { void consulta.carregar(); }} />
    {consulta.dados && <section className={styles.painel}><dl className={styles.ficha}>
      <div><dt>Cidade</dt><dd>{consulta.dados.cidade ?? "Não informada"}</dd></div>
      <div><dt>Técnico atual</dt><dd>{consulta.dados.tecnico?.nomeCompleto ?? "Sem técnico atribuído"}</dd></div>
    </dl></section>}
  </div>;
}

export function EmblemaClube({ nome, cobre = false }: { nome: string; cobre?: boolean }) {
  const sigla = nome.trim().split(/\s+/).filter(p => !["de", "do", "da", "dos", "das"].includes(p.toLowerCase())).slice(0, 2).map(p => p[0]).join("").toLocaleUpperCase("pt-BR");
  return <div aria-hidden="true" className={`${styles.emblema} ${cobre ? styles.emblemaCobre : ""}`}><Image src={`/figma/pessoal/${cobre ? "emblema-cobre" : "emblema"}.svg`} alt="" width={24} height={24} /><span>{sigla}</span></div>;
}
