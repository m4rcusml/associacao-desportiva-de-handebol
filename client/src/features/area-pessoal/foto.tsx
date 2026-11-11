"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lerFoto, enviarFoto, TIPOS_FOTO, validarArquivo } from "../presidente/pessoas/foto-api";
import { ApiError } from "../../lib/api";
import { useAreaPessoal } from "./shell";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./pessoal.module.css";

export function ImagemPrivada({ blob, nome, previa = false }: { blob: Blob; nome: string; previa?: boolean }) {
  const imagem = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (imagem.current) imagem.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // O conteúdo privado chega como Blob autenticado, sem URL pública para next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={imagem} alt={previa ? "Prévia da foto escolhida" : `Foto de ${nome}`} className={previa ? styles.previa : styles.foto} />;
}

/** Leitura isolada; 403 vira texto e revalida a sessão, sem repetição automática. */
export function FotoPrivada({ atletaId, nome }: { atletaId: string; nome: string }) {
  const { tratarErro } = useAreaPessoal();
  const [foto, setFoto] = useState<Blob | null>(null);
  const [estado, setEstado] = useState("Consultando foto…");
  useEffect(() => {
    let ativa = true;
    lerFoto(atletaId).then(blob => { if (ativa) { setFoto(blob); setEstado(blob ? "" : "Sem foto"); } })
      .catch(falha => { if (ativa) { if (falha instanceof ApiError && [401, 403, 404].includes(falha.status)) setFoto(null); setEstado(`Foto indisponível. ${tratarErro(falha)}`); } });
    return () => { ativa = false; };
  }, [atletaId, tratarErro]);
  return <div>{foto ? <ImagemPrivada blob={foto} nome={nome} /> : <span className={styles.avatar} aria-label={`Foto de ${nome} indisponível`}>{nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("")}</span>}{estado && <p className={controles.ajuda} role="status">{estado}</p>}</div>;
}

export function MinhaFoto() {
  const { sessao, tratarErro } = useAreaPessoal();
  const [foto, setFoto] = useState<Blob | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const entrada = useRef<HTMLInputElement>(null);
  const trava = useRef(false);
  const carregar = useCallback(() => lerFoto(sessao.usuario.id)
    .then(blob => { setFoto(blob); setErro(""); })
    .catch(falha => { if (falha instanceof ApiError && [401, 403, 404].includes(falha.status)) setFoto(null); setErro(tratarErro(falha)); })
    .finally(() => setCarregando(false)), [sessao.usuario.id, tratarErro]);
  useEffect(() => { void carregar(); }, [carregar]);
  async function enviar() {
    if (!arquivo || trava.current) return;
    trava.current = true; setEnviando(true); setErro(""); setAviso("");
    try {
      await enviarFoto(sessao.usuario.id, arquivo);
      setFoto(arquivo); setArquivo(null);
      if (entrada.current) entrada.current.value = "";
      setAviso("Foto salva.");
    } catch (falha) { setErro(tratarErro(falha)); }
    finally { trava.current = false; setEnviando(false); }
  }
  return <section className={`${pagina.secao} ${styles.pilha}`}>
    <h2 className={pagina.secaoTitulo}>Minha foto</h2>
    {foto ? <ImagemPrivada blob={foto} nome={sessao.usuario.nomeCompleto} /> : <p className={controles.ajuda} role="status">{carregando ? "Consultando foto…" : "Sem foto disponível"}</p>}
    <p id="foto-ajuda" className={controles.ajuda}>JPEG, PNG ou WebP de até 4 MiB. A foto é privada e apoia sua identificação. Não é obrigatória para a validade da carteirinha.</p>
    <label className={controles.rotulo} htmlFor="minha-foto">Escolher foto</label>
    <input ref={entrada} id="minha-foto" className={controles.arquivo} type="file" accept={TIPOS_FOTO.join(",")} aria-describedby="foto-ajuda" disabled={enviando || carregando} onChange={e => {
      const escolhida = e.target.files?.[0] ?? null;
      const problema = escolhida ? validarArquivo(escolhida) : "";
      setErro(problema); setArquivo(problema ? null : escolhida); setAviso("");
    }} />
    {arquivo && <><ImagemPrivada blob={arquivo} nome="" previa /><div className={pagina.acoes}>
      <button className={controles.primario} disabled={enviando || carregando} onClick={() => { void enviar(); }}>{enviando ? "Enviando…" : "Salvar foto"}</button>
      <button className={controles.secundario} disabled={enviando} onClick={() => { setArquivo(null); setErro(""); if (entrada.current) { entrada.current.value = ""; entrada.current.focus(); } }}>Cancelar</button>
    </div></>}
    {erro && <><p className={controles.erro} role="alert">{erro}</p><button className={controles.secundario} disabled={carregando || enviando} onClick={() => { setCarregando(true); void carregar(); }}>Consultar foto atual</button></>}
    <p className={pagina.aviso} role="status">{aviso}</p>
  </section>;
}
