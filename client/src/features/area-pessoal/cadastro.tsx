"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { NovaAnalise, ClubePessoal } from "../../lib/area-pessoal";
import { useAreaPessoal } from "./shell";
import { useConsulta } from "./consulta";
import { Confirmacao } from "../ui/confirmacao";
import { Iniciais } from "../ui/identificacao";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./pessoal.module.css";

export function ClubeAtual() {
  const { sessao } = useAreaPessoal();
  const { dados, erro, carregar, carregando } = useConsulta<ClubePessoal>(sessao.usuario.clubeId ? `/clubes/${sessao.usuario.clubeId}` : null);
  if (!sessao.usuario.clubeId) return <p className={controles.nota}>{sessao.usuario.perfil === "tecnico" ? "Sua conta ainda não tem um clube atribuído. Solicite ao presidente a atribuição para escalar atletas." : "Clube atual não informado. Consulte o presidente sobre seu vínculo."}</p>;
  return <div>
    {dados && <p className={pagina.texto}>Clube atual: <Link className={styles.link} href={`/${sessao.usuario.perfil}/clubes/${dados.id}`}>{dados.nome}</Link>{dados.cidade ? `, ${dados.cidade}` : ""}.</p>}
    {!dados && !erro && <p role="status">Consultando clube…</p>}
    {erro && <><p className={controles.erro} role="alert">{erro}</p><button className={controles.secundario} disabled={carregando} onClick={() => { void carregar(); }}>Atualizar clube</button></>}
  </div>;
}

export function SituacaoCadastro({ compacto = false }: { compacto?: boolean }) {
  const { sessao, revalidar, atualizarUsuario, tratarErro } = useAreaPessoal();
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const trava = useRef(false);
  const rejeitado = sessao.usuario.statusVerificacao === "rejeitado";
  async function solicitar() {
    if (trava.current) return;
    trava.current = true; setEnviando(true); setErro("");
    try {
      const resposta = await api<NovaAnalise>("/verificacoes/solicitacao", {});
      atualizarUsuario({ statusVerificacao: resposta.statusVerificacao, aprovado: resposta.statusVerificacao === "aprovado" });
      setAviso("Solicitação enviada para análise."); setConfirmar(false);
    } catch (falha) {
      setErro(tratarErro(falha));
      if (falha instanceof ApiError && falha.status === 409) await revalidar().catch(() => {});
    } finally { trava.current = false; setEnviando(false); }
  }
  async function atualizar() {
    setAtualizando(true); setErro("");
    try { await revalidar(); } catch (falha) { setErro(tratarErro(falha)); }
    finally { setAtualizando(false); }
  }
  const titulo = sessao.usuario.aprovado ? sessao.usuario.clubeId ? "Cadastro aprovado" : "Técnico sem clube" : rejeitado ? "Cadastro não aprovado" : "Cadastro em análise";
  return <section className={styles.pilha}>
    {compacto ? <h2 className={styles.subtitulo}>{titulo}</h2> : <h1 className={styles.titulo}>{titulo}</h1>}
    <div><span className={`${controles.status} ${sessao.usuario.aprovado ? controles.statusAprovado : rejeitado ? controles.statusRejeitado : controles.statusPendente}`}>{sessao.usuario.aprovado ? "Cadastro aprovado" : rejeitado ? "Solicitação não aprovada" : "Aguardando presidente"}</span></div>
    {!compacto && <div className={styles.identidade}><Iniciais nome={sessao.usuario.nomeCompleto} grande /><div><h2>{sessao.usuario.nomeCompleto}</h2><ClubeAtual /></div></div>}
    {!sessao.usuario.aprovado && <p className={styles.texto}>{rejeitado ? `Revise seu nome${sessao.usuario.perfil === "atleta" ? " e sua foto" : ""} antes de solicitar uma nova análise. Para saber o que precisa corrigir, fale com o presidente.` : `O presidente está analisando seu cadastro.${sessao.usuario.perfil === "atleta" ? " Sua carteirinha estará disponível após a aprovação." : " Você pode revisar seus dados enquanto espera."}`}</p>}
    {sessao.usuario.aprovado && !sessao.usuario.clubeId && <ClubeAtual />}
    {sessao.usuario.perfil === "atleta" && !sessao.usuario.aprovado && <p className={controles.ajuda}>A carteirinha será emitida após aprovação. Se o clube escolhido no cadastro estiver incorreto, peça ao presidente que avalie seu caso.</p>}
    <div className={styles.pilha}>
      {rejeitado && <button className={controles.primario} onClick={() => { setErro(""); setConfirmar(true); }}>Solicitar nova análise</button>}
      {!compacto && <Link className={controles.secundario} href={`/${sessao.usuario.perfil}/conta`}>{sessao.usuario.perfil === "atleta" ? "Revisar nome e foto" : "Revisar meus dados"}</Link>}
      <button className={controles.discreto} onClick={() => { void atualizar(); }} disabled={atualizando || enviando}>{atualizando ? "Atualizando…" : "Atualizar situação"}</button>
    </div>
    {!confirmar && erro && <p className={controles.erro} role="alert">{erro}</p>}
    <p className={pagina.aviso} role="status">{aviso}</p>
    <Confirmacao aberto={confirmar} titulo="Solicitar nova análise?" rotulo="Solicitar nova análise" enviando={enviando} erro={erro} aoConfirmar={() => { void solicitar(); }} aoFechar={() => { if (!trava.current) setConfirmar(false); }}>
      <p className={pagina.confirmacaoTexto}>O presidente receberá seu cadastro novamente para análise.</p>
    </Confirmacao>
  </section>;
}
