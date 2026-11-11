"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import type { Pessoa } from "../../lib/presidente";
import { useAreaPessoal } from "./shell";
import { ClubeAtual, SituacaoCadastro } from "./cadastro";
import { MinhaFoto } from "./foto";
import { Iniciais } from "../ui/identificacao";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./pessoal.module.css";

export function ContaPessoal() {
  const { sessao, atualizarUsuario, revalidar, sair, tratarErro } = useAreaPessoal();
  const [nome, setNome] = useState(sessao.usuario.nomeCompleto);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [erroSaida, setErroSaida] = useState("");
  const trava = useRef(false);
  const travaSaida = useRef(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (trava.current) return;
    if (nome.trim().length < 3 || nome.trim().length > 150) { setErro("Informe seu nome completo, com 3 a 150 caracteres."); return; }
    trava.current = true; setEnviando(true); setErro(""); setAviso("");
    try {
      const resposta = await api<{ usuario: Pessoa; alterado: boolean }>("/conta", { nomeCompleto: nome.trim() }, "PATCH");
      atualizarUsuario({ nomeCompleto: resposta.usuario.nomeCompleto }); setNome(resposta.usuario.nomeCompleto); setAviso("Nome salvo.");
    } catch (falha) {
      setErro(tratarErro(falha));
      if (falha instanceof ApiError && falha.status === 409) await revalidar().catch(() => {});
    } finally { trava.current = false; setEnviando(false); }
  }
  async function encerrar() {
    if (travaSaida.current) return;
    travaSaida.current = true; setSaindo(true); setErroSaida("");
    try { await sair(); }
    catch (falha) { setErroSaida(tratarErro(falha)); }
    finally { travaSaida.current = false; setSaindo(false); }
  }
  return <div className={styles.pilha}>
    <h1 className={styles.titulo}>Minha conta</h1>
    <div className={styles.identidade}><Iniciais nome={sessao.usuario.nomeCompleto} grande /><div><h2>{sessao.usuario.nomeCompleto}</h2><ClubeAtual /></div></div>
    {sessao.usuario.aprovado && <div><span className={`${controles.status} ${controles.statusAprovado}`}>Cadastro aprovado</span></div>}
    <div className={styles.acoesConta}>
    <details><summary className={styles.atalho}><Image src="/figma/pessoal/editar.svg" alt="" width={24} height={24} /><span><strong>Editar nome</strong><small>{sessao.usuario.nomeCompleto}</small></span><Image src="/figma/pessoal/chevron.svg" alt="" width={20} height={20} /></summary>
    <section className={styles.painel} aria-label="Editar nome">
      <form className={pagina.formulario} onSubmit={salvar}>
        <label className={controles.rotulo} htmlFor="nome-completo">Como você será identificado</label>
        <input className={controles.entrada} id="nome-completo" name="nomeCompleto" autoComplete="name" value={nome} minLength={3} maxLength={150} required disabled={enviando} onChange={e => setNome(e.target.value)} />
        <button className={controles.primario} disabled={enviando || nome.trim() === sessao.usuario.nomeCompleto}>{enviando ? "Salvando…" : "Salvar nome"}</button>
      </form>
      {erro && <p className={controles.erro} role="alert">{erro}</p>}
      <p className={aviso ? styles.sucesso : undefined} role="status">{aviso}</p>
    </section></details>
    {sessao.usuario.perfil === "atleta" && <details><summary className={styles.atalho}><Image src="/figma/pessoal/pessoa.svg" alt="" width={24} height={24} /><span><strong>Minha foto</strong><small>Consultar ou atualizar foto opcional</small></span><Image src="/figma/pessoal/chevron.svg" alt="" width={20} height={20} /></summary><MinhaFoto /></details>}
    <Link href={`/${sessao.usuario.perfil}/clubes`} className={styles.atalho}><Image src="/figma/pessoal/clube.svg" alt="" width={24} height={24} /><span><strong>Clubes da associação</strong><small>{sessao.usuario.perfil === "atleta" ? "Mudanças de clube dependem do presidente" : "Clubes e técnicos atuais"}</small></span><Image src="/figma/pessoal/chevron.svg" alt="" width={20} height={20} /></Link>
    <Link className={styles.atalho} href="/arbitragem"><Image src="/figma/pessoal/registros.svg" alt="" width={24} height={24} /><span><strong>Arbitrar um jogo</strong><small>Abra o link ou informe o ID da partida</small></span><Image src="/figma/pessoal/chevron.svg" alt="" width={20} height={20} /></Link>
    <button className={controles.discreto} disabled={saindo} onClick={() => { void encerrar(); }}>{saindo ? "Saindo…" : "Sair da conta"}</button>{erroSaida && <p className={controles.erro} role="alert">{erroSaida}</p>}
    {!sessao.usuario.aprovado && <SituacaoCadastro compacto />}
    </div>
  </div>;
}
