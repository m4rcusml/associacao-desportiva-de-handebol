"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { identificarJogo, lerAtalhos, normalizarAtalhos, salvarAtalhos } from "../../lib/tecnico";
import { uuidValido } from "../../lib/area-pessoal";
import type { ClubePessoal } from "../../lib/area-pessoal";
import type { EscalacaoJogo, Pessoa } from "../../lib/presidente";
import { api } from "../../lib/api";
import { useAreaPessoal } from "../area-pessoal/shell";
import { SituacaoCadastro } from "../area-pessoal/cadastro";
import { useConsulta, EstadoConsulta } from "../area-pessoal/consulta";
import { EmblemaClube } from "../area-pessoal/clubes";
import { Iniciais } from "../ui/identificacao";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "../area-pessoal/pessoal.module.css";

const EVENTO_ATALHOS = "handebol:atalhos-atualizados";
function assinarAtalhos(atualizar: () => void) {
  window.addEventListener("storage", atualizar); window.addEventListener(EVENTO_ATALHOS, atualizar);
  return () => { window.removeEventListener("storage", atualizar); window.removeEventListener(EVENTO_ATALHOS, atualizar); };
}
const vazio = () => "";

function Atalhos() {
  const { sessao } = useAreaPessoal();
  const usuarioId = sessao.usuario.id;
  const clubeId = sessao.usuario.clubeId!;
  const obter = useCallback(() => JSON.stringify(lerAtalhos(usuarioId, clubeId)), [usuarioId, clubeId]);
  const valor = useSyncExternalStore(assinarAtalhos, obter, vazio);
  const atalhos = valor ? normalizarAtalhos(JSON.parse(valor)) : [];
  const titulo = useRef<HTMLHeadingElement>(null);
  return <section className={styles.pilha}>
    <h2 ref={titulo} tabIndex={-1} className={styles.subtitulo}>Abertos neste navegador</h2>
    {!atalhos.length && <p className={pagina.texto}>Nenhum jogo aberto ainda. Peça ao presidente o link do jogo.</p>}
    <ul className={styles.lista}>{atalhos.map(atalho => <li key={atalho.id} className={styles.item}>
      <strong className={styles.subtitulo}>{atalho.rotulo}</strong>
      <Link className={controles.primario} href={`/tecnico/jogos/${atalho.id}`}>Abrir jogo e escalação</Link>
      <details className={styles.ajudaDetalhe}><summary>Opções da referência</summary><p className={styles.codigo}>{atalho.id}</p><button className={controles.secundario} onClick={() => { salvarAtalhos(usuarioId, clubeId, atalhos.filter(i => i.id !== atalho.id)); window.dispatchEvent(new Event(EVENTO_ATALHOS)); titulo.current?.focus(); }}>Tirar dos atalhos</button></details>
    </li>)}</ul>
    <p className={controles.ajuda}>Estes atalhos ficam neste navegador e não representam a agenda completa do clube. Os rótulos podem estar desatualizados; situação e permissões são conferidas ao abrir.</p>
  </section>;
}

export function AbrirAtleta() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [erro, setErro] = useState("");
  function abrir(e: FormEvent) {
    e.preventDefault();
    if (!uuidValido(id.trim())) { setErro("Informe um identificador de atleta (UUID) válido."); return; }
    router.push(`/tecnico/atletas/${id.trim().toLowerCase()}`);
  }
  return <section className={`${pagina.secao} ${styles.pilha}`}>
    <h2 className={pagina.secaoTitulo}>Ficha de atleta do meu clube</h2>
    <p className={controles.ajuda}>Abra a ficha pelas listas de um jogo ou informe o ID do atleta. A consulta é autorizada apenas para atletas atuais do seu clube; esta busca não lista o elenco.</p>
    <form className={pagina.formulario} onSubmit={abrir}>
      <label className={controles.rotulo} htmlFor="atleta-id">Identificador do atleta</label>
      <input className={controles.entrada} id="atleta-id" value={id} onChange={e => setId(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
      <button className={controles.secundario}>Consultar atleta</button>
    </form>
    {erro && <p className={controles.erro} role="alert">{erro}</p>}
  </section>;
}

export function InicioTecnico() {
  const { sessao } = useAreaPessoal();
  const router = useRouter();
  const [entrada, setEntrada] = useState("");
  const [erro, setErro] = useState("");
  function abrir(e: FormEvent) {
    e.preventDefault();
    const id = identificarJogo(entrada, window.location.origin);
    if (!id) { setErro("Cole um link de jogo desta aplicação ou informe o UUID do jogo."); return; }
    router.push(`/tecnico/jogos/${id}`);
  }
  if (!sessao.usuario.aprovado || !sessao.usuario.clubeId) return <SituacaoCadastro />;
  return <div className={styles.pilha}>
    <h1 className={styles.titulo}>Jogos</h1>
    {!sessao.usuario.aprovado || !sessao.usuario.clubeId ? <SituacaoCadastro /> : <>
      <section className={styles.pilha}>
        <p id="jogo-ajuda" className={styles.texto}>Abra o link recebido do presidente ou informe o ID.</p>
        <form className={styles.pilha} onSubmit={abrir}>
          <label className={controles.rotulo} htmlFor="link-jogo">Link ou ID do jogo</label>
          <input className={controles.entrada} id="link-jogo" aria-describedby="jogo-ajuda" value={entrada} onChange={e => setEntrada(e.target.value)} placeholder="/tecnico/jogos/…" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          <button className={controles.primario}>Abrir jogo</button>
        </form>
        {erro && <p className={controles.erro} role="alert">{erro}</p>}
      </section>
      <Atalhos />
    </>}
  </div>;
}

export function MeuClubeTecnico() {
  const { sessao } = useAreaPessoal();
  const consulta = useConsulta<ClubePessoal>(sessao.usuario.aprovado && sessao.usuario.clubeId ? `/clubes/${sessao.usuario.clubeId}` : null);
  return <div className={styles.pilha}>
    <h1 className={styles.titulo}>Meu clube</h1>
    {!sessao.usuario.aprovado || !sessao.usuario.clubeId ? <SituacaoCadastro compacto /> : <>
      {consulta.dados && <><EmblemaClube nome={consulta.dados.nome} /><h2 className={styles.titulo}>{consulta.dados.nome}</h2><p className={styles.texto}>{consulta.dados.cidade ?? "Cidade não informada"} · Técnico {consulta.dados.tecnico?.nomeCompleto ?? "não atribuído"}</p></>}
      <AtletasConhecidos />
      <details className={styles.ajudaDetalhe}><summary>Consultar atleta por ID</summary><AbrirAtleta /></details>
      <EstadoConsulta {...consulta} atualizar={() => { void consulta.carregar(); }} />
    </>}
    <Link className={styles.link} href="/tecnico/clubes">Consultar clubes da associação</Link>
  </div>;
}

function AtletasConhecidos() {
  const { sessao, tratarErro } = useAreaPessoal();
  const [atletas, setAtletas] = useState<Pessoa[] | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const trava = useRef(false);
  async function consultar() {
    if (trava.current || !sessao.usuario.clubeId) return;
    trava.current = true; setCarregando(true); setErro("");
    const atalhos = lerAtalhos(sessao.usuario.id, sessao.usuario.clubeId);
    const resultados = await Promise.allSettled(atalhos.map(a => api<EscalacaoJogo>(`/jogos/${a.id}/escalacao`)));
    const conhecidos = new Map<string, Pessoa>();
    for (const resultado of resultados) {
      if (resultado.status === "rejected") { setErro(tratarErro(resultado.reason)); continue; }
      const clube = resultado.value.clubes.find(c => c.clube.id === sessao.usuario.clubeId);
      for (const atleta of [...(clube?.atletasDoClube ?? []), ...(clube?.escalados.filter(e => e.vinculoAtual).map(e => e.atleta) ?? [])]) conhecidos.set(atleta.id, atleta);
    }
    setAtletas([...conhecidos.values()].sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR")));
    trava.current = false; setCarregando(false);
  }
  return <section className={styles.secaoLista}><h2 className={styles.subtitulo}>Atletas conhecidos</h2>
    <p className={controles.ajuda}>Do clube atual, encontrados nas consultas dos jogos abertos neste navegador. Esta não é a lista completa do elenco. Acesse uma ficha para conferir o vínculo atual.</p>
    <button className={controles.secundario} disabled={carregando} onClick={() => { void consultar(); }}>{carregando ? "Consultando…" : atletas ? "Atualizar atletas conhecidos" : "Consultar atletas dos jogos abertos"}</button>
    {erro && <p className={controles.erro} role="alert">Uma das consultas falhou. {erro}</p>}
    {atletas && <ul className={styles.lista}>{atletas.map(a => <li className={styles.linhaAtleta} key={a.id}><Iniciais nome={a.nomeCompleto} /><div><Link className={styles.nomeAtleta} href={`/tecnico/atletas/${a.id}`}>{a.nomeCompleto}</Link><p>Histórico e participações</p></div><Link className={controles.secundario} href={`/tecnico/atletas/${a.id}`}>Histórico</Link></li>)}</ul>}
    {atletas?.length === 0 && <p className={styles.texto}>Nenhum atleta encontrado nas referências atuais. Abra um jogo ou consulte uma ficha por ID.</p>}
  </section>;
}
