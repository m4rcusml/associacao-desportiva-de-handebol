"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import { idJogo } from "../../lib/arbitragem";
import type { Sessao } from "../../lib/presidente";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./arbitragem.module.css";
import { CabecalhoArbitragem } from "./cabecalho";

export function AbrirJogo() {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState("");
  function abrir(e: FormEvent) {
    e.preventDefault();
    const id = idJogo(valor, window.location.origin);
    if (!id) { setErro("Informe o identificador do jogo (UUID) ou um link de arbitragem desta aplicação, sem parâmetros."); return; }
    router.push(`/arbitragem/jogos/${id}`);
  }
  return <><CabecalhoArbitragem /><div className={`${styles.estreito} ${styles.pilha}`}><h1 className={pagina.titulo}>Arbitrar um jogo</h1><p className={pagina.texto}>Abra o link enviado pela organização ou informe o identificador da partida.</p>
    <form className={pagina.formulario} onSubmit={abrir}><label className={controles.campo}><span className={controles.rotulo}>Link ou identificador do jogo</span><input className={controles.entrada} value={valor} onChange={e => setValor(e.target.value)} required autoComplete="off" spellCheck={false} /></label>
      {erro && <p className={controles.erro} role="alert">{erro}</p>}<button className={controles.primario}>Abrir jogo</button></form>
    <p className={controles.ajuda}>O acesso depende da designação ou da senha do jogo e é validado no dia da partida, no fuso do local, ou enquanto ela estiver em andamento.</p><Link href="/login" className={controles.secundario}>Voltar à minha conta</Link></div></>;
}

export function EntradaArbitragem({ jogoId, enviando, entrar }: { jogoId: string; enviando: boolean; entrar: (metodo: string, dados: unknown) => Promise<boolean> }) {
  const [conta, setConta] = useState<Sessao | null>(null);
  const [contaErro, setContaErro] = useState("");
  const [consulta, setConsulta] = useState(0);
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  useEffect(() => {
    let atual = true;
    api<Sessao>("/sessao").then(s => { if (atual) { setConta(s); setContaErro(""); } }).catch(erro => {
      if (atual) { setConta(null); setContaErro(erro instanceof ApiError && erro.status === 401 ? "" : "Não foi possível consultar sua conta. Você ainda pode entrar com a senha do jogo."); }
    });
    return () => { atual = false; };
  }, [consulta]);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (await entrar("senha", { nomeCompleto: nome.trim(), senha, visualizacao: "banco" })) setSenha("");
  }
  const designavel = conta && (conta.usuario.perfil === "atleta" || conta.usuario.perfil === "tecnico");
  return <div className={`${styles.estreito} ${styles.pilha}`}>
    <h1 className={pagina.titulo}>Entre no jogo</h1>
    <p className={pagina.texto}>Use a senha recebida para atuar nesta partida.</p>
    <form className={styles.formulario} onSubmit={enviar}>
      <label className={controles.campo}><span className={controles.rotulo}>Seu nome completo</span><input className={controles.entrada} required minLength={2} maxLength={120} value={nome} onChange={e => setNome(e.target.value)} autoComplete="name" disabled={enviando} /></label>
      <label className={controles.campo}><span className={controles.rotulo}>Senha do jogo</span><input className={controles.entrada} type="password" required minLength={1} maxLength={64} value={senha} onChange={e => setSenha(e.target.value)} autoComplete="off" disabled={enviando} /></label>
      <button className={controles.primario} disabled={enviando || nome.trim().length < 2}>{enviando ? "Entrando…" : "Entrar com senha do jogo"}</button>
    </form>
    <p className={controles.ajuda}>Sem conta cadastrada. O acesso vale somente para este jogo.</p>
    <section className={styles.entradaConta}><h2 className={pagina.secaoTitulo}>Foi designado para este jogo?</h2>
      {designavel ? <><p className={pagina.texto}>Usar a conta de {conta.usuario.nomeCompleto}. A designação e a aprovação serão conferidas pelo servidor.</p><button className={controles.secundario} disabled={enviando} onClick={() => { void entrar("designacao", { visualizacao: "banco" }); }}>Entrar por designação</button></>
        : conta?.usuario.perfil === "presidente" ? <p className={pagina.texto}>A conta de presidente não pode ser designada. Use a senha do jogo.</p>
          : <><p className={pagina.texto}>Entre com sua conta de atleta ou técnico para usar a designação.</p><Link className={controles.secundario} href={`/login?retorno=${encodeURIComponent(`/arbitragem/jogos/${jogoId}`)}`}>Entrar pela minha conta</Link></>}
      {contaErro && <p className={controles.nota}>{contaErro}</p>}<button className={controles.secundario} disabled={enviando} onClick={() => setConsulta(n => n + 1)}>Atualizar conta</button>
    </section>
    <p className={styles.sucesso}>A identificação dos clubes aparece após a autorização de acesso. Você começa na Mesa e pode alternar para Linha em Opções, com as mesmas ações.</p>
  </div>;
}
