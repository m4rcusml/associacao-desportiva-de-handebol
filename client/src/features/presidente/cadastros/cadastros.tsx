"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { consultarSolicitacoes, type DecisaoVerificacao, type SolicitacaoVerificacao, type StatusVerificacao } from "../../../lib/presidente";
import { Confirmacao } from "../../ui/confirmacao";
import { Iniciais } from "../../ui/identificacao";
import { data, normalizar, primeiroNome } from "../../ui/formatos";
import { conflito, status, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import styles from "./cadastros.module.css";

type Solicitacao = SolicitacaoVerificacao;
type Perfil = Solicitacao["perfil"] | "todos";
type FiltroStatus = StatusVerificacao | "todos";
const PERFIS = { atleta: "Atleta", tecnico: "Técnico" } as const;
const SITUACOES = { pendente: "Aguardando aprovação", aprovado: "Cadastro aprovado", rejeitado: "Cadastro rejeitado" } as const;
const CLASSE_STATUS = { pendente: controles.statusPendente, aprovado: controles.statusAprovado, rejeitado: controles.statusRejeitado };

/** Fila e ficha são a mesma tarefa; só a rejeição pede uma confirmação adicional. */
export function Cadastros() {
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[] | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [busca, setBusca] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("todos");
  const [filtro, setFiltro] = useState<FiltroStatus>("pendente");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [filaAberta, setFilaAberta] = useState(false);
  const [rejeitando, setRejeitando] = useState<Solicitacao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [erroDecisao, setErroDecisao] = useState("");
  const [aviso, setAviso] = useState("");
  const envio = useRef(false);
  const versaoConsulta = useRef(0);
  const tituloFicha = useRef<HTMLHeadingElement>(null);
  const tratarErro = useErroApi();

  const carregar = useCallback(() => {
    const versao = ++versaoConsulta.current;
    return consultarSolicitacoes().then(lista => {
      if (versao !== versaoConsulta.current) return;
      setSolicitacoes(lista);
      setErroCarga("");
    }).catch(erro => {
      if (versao === versaoConsulta.current) setErroCarga(tratarErro(erro));
    }).finally(() => {
      if (versao === versaoConsulta.current) setAtualizando(false);
    });
  }, [tratarErro]);
  const invalidarConsulta = useCallback(() => { versaoConsulta.current++; }, []);
  useEffect(() => { void carregar(); return invalidarConsulta; }, [carregar, invalidarConsulta]);

  function atualizar() {
    if (envio.current) return;
    setAtualizando(true);
    void carregar();
  }

  const termo = normalizar(busca);
  const visiveis = (solicitacoes ?? []).filter(s => (perfil === "todos" || s.perfil === perfil)
    && (filtro === "todos" || s.statusVerificacao === filtro)
    && (!termo || normalizar(`${s.nomeCompleto} ${s.clube?.nome ?? "sem clube"}`).includes(termo)));
  const aberta = visiveis.find(s => s.usuarioId === selecionada) ?? visiveis[0] ?? null;
  const pendentes = (solicitacoes ?? []).filter(s => s.statusVerificacao === "pendente").length;

  function escolher(s: Solicitacao) {
    if (envio.current) return;
    setSelecionada(s.usuarioId);
    setErroDecisao("");
    setFilaAberta(false);
    requestAnimationFrame(() => tituloFicha.current?.focus());
  }

  async function decidir(solicitacao: Solicitacao, decisao: "aprovar" | "rejeitar") {
    if (envio.current) return;
    envio.current = true;
    versaoConsulta.current++;
    setAtualizando(false);
    setEnviando(true);
    setErroDecisao("");
    setAviso("");
    try {
      const { solicitacao: atual } = await api<DecisaoVerificacao>(
        `/verificacoes/${solicitacao.usuarioId}/${decisao === "aprovar" ? "aprovacao" : "rejeicao"}`, {});
      setSolicitacoes(lista => (lista ?? []).map(s => s.usuarioId === atual.usuarioId ? atual : s));
      setAviso(`Cadastro de ${atual.nomeCompleto} ${atual.statusVerificacao === "aprovado" ? "aprovado" : "rejeitado"}.${atual.perfil === "atleta" && atual.carteirinha ? ` Carteirinha ${atual.carteirinha.codigo} emitida.` : ""}`);
      setSelecionada(visiveis.find(s => s.usuarioId !== atual.usuarioId && s.statusVerificacao === "pendente")?.usuarioId ?? atual.usuarioId);
      setRejeitando(null);
      requestAnimationFrame(() => tituloFicha.current?.focus());
    } catch (erro) {
      const mensagem = tratarErro(erro);
      setErroDecisao(mensagem);
      if (conflito(erro) || status(erro) === 404) {
        await carregar();
        setErroDecisao(`${mensagem} Confira a situação atual antes de decidir novamente.`);
        setRejeitando(null);
      }
    } finally {
      envio.current = false;
      setEnviando(false);
    }
  }

  return <>
    <div className={pagina.topo}>
      <div><h1 className={pagina.titulo}>Cadastros para aprovar</h1><p className={pagina.texto}>Confira a ficha; a decisão fica no mesmo lugar.</p></div>
      <button type="button" className={`${controles.secundario} ${styles.atualizarDesktop}`} onClick={atualizar} disabled={enviando || atualizando}>{atualizando ? "Atualizando…" : "Atualizar fila"}</button>
    </div>
    <div className={styles.barraMobile}>
      <span>{pendentes} {pendentes === 1 ? "pendente" : "pendentes"}</span>
      <button type="button" className={controles.secundario} onClick={() => setFilaAberta(!filaAberta)} aria-expanded={filaAberta} aria-controls="fila-cadastros" disabled={enviando}>{filaAberta ? "Ver ficha" : "Ver fila"}</button>
      <button type="button" className={controles.secundario} onClick={atualizar} disabled={enviando || atualizando}>{atualizando ? "Atualizando…" : "Atualizar"}</button>
    </div>
    {aviso && <p className={pagina.aviso} role="status">{aviso}</p>}
    {erroCarga && <p className={controles.erro} role="alert">{erroCarga}{solicitacoes ? " A lista anterior foi mantida." : ""}</p>}
    {erroDecisao && !aberta && !rejeitando && <p className={controles.erro} role="alert">{erroDecisao}</p>}
    {solicitacoes === null && !erroCarga && <p role="status" className={pagina.carregando}>Carregando solicitações…</p>}
    {solicitacoes === null && erroCarga && <button type="button" className={controles.secundario} onClick={atualizar}>Tentar novamente</button>}
    {solicitacoes !== null && <div className={styles.composicao}>
      <section id="fila-cadastros" aria-label="Fila de solicitações" className={`${styles.fila} ${filaAberta ? styles.filaAberta : ""}`}>
        <div className={styles.seletor} role="group" aria-label="Solicitações">
          <button type="button" className={controles.opcao} aria-pressed={filtro === "pendente"} onClick={() => setFiltro("pendente")} disabled={enviando}>Pendentes ({pendentes})</button>
          <button type="button" className={controles.opcao} aria-pressed={filtro !== "pendente"} onClick={() => setFiltro("todos")} disabled={enviando}>Consultar todos</button>
        </div>
        <div className={controles.campo}><label className={controles.rotulo} htmlFor="busca-solicitacoes">Buscar solicitação</label><input id="busca-solicitacoes" className={controles.entrada} type="search" placeholder="Nome ou clube" value={busca} onChange={e => setBusca(e.target.value)} disabled={enviando} /></div>
        <details className={styles.filtros}><summary>Mais filtros</summary><div className={controles.campo}><label htmlFor="cadastros-perfil" className={controles.rotulo}>Perfil</label><select id="cadastros-perfil" className={controles.entrada} value={perfil} onChange={e => setPerfil(e.target.value as Perfil)} disabled={enviando}><option value="todos">Todos os perfis</option><option value="atleta">Atletas</option><option value="tecnico">Técnicos</option></select></div><div className={controles.campo}><label htmlFor="cadastros-status" className={controles.rotulo}>Verificação</label><select id="cadastros-status" className={controles.entrada} value={filtro} onChange={e => setFiltro(e.target.value as FiltroStatus)} disabled={enviando}><option value="todos">Todos os estados</option><option value="pendente">Pendentes</option><option value="aprovado">Aprovados</option><option value="rejeitado">Rejeitados</option></select></div></details>
        <ul className={styles.lista}>{visiveis.map(s => <li key={s.usuarioId}><button type="button" className={styles.linha} aria-pressed={aberta?.usuarioId === s.usuarioId} onClick={() => escolher(s)} disabled={enviando}>
          <Iniciais nome={s.nomeCompleto} /><span className={styles.identidade}><strong>{s.nomeCompleto}</strong><span>{PERFIS[s.perfil]} · {s.clube?.nome ?? "Sem clube"}{!s.ativo ? " · Conta desativada" : ""}</span></span><span className={styles.acaoLinha}>{aberta?.usuarioId === s.usuarioId ? "Em análise" : "Conferir"}</span>
        </button></li>)}</ul>
        {!visiveis.length && <p className={pagina.vazioTexto}>Nenhuma solicitação corresponde aos filtros.</p>}
        <p className={controles.ajuda}>Mais antigas primeiro.</p>
      </section>
      <section className={`${styles.ficha} ${filaAberta ? styles.fichaOculta : ""}`} aria-label="Ficha para decisão">
        {aberta ? <>
          <div className={styles.cabecalhoFicha}><Iniciais nome={aberta.nomeCompleto} grande /><div><h2 ref={tituloFicha} tabIndex={-1} className={styles.nome}>{aberta.nomeCompleto}</h2><p className={pagina.texto}>{PERFIS[aberta.perfil]}</p></div></div>
          <span className={`${controles.status} ${CLASSE_STATUS[aberta.statusVerificacao]}`}>{SITUACOES[aberta.statusVerificacao]}</span>
          <dl className={styles.dados}>
            <div><dt>Clube informado</dt><dd>{aberta.clube?.nome ?? "Sem clube"}</dd></div>
            <div><dt>Solicitado em</dt><dd>{data(aberta.verificacaoSolicitadaEm)}</dd></div>
            <div><dt>Conta</dt><dd>{aberta.ativo ? "Ativa" : "Desativada"}</dd></div>
            {aberta.verificadoEm && <div><dt>Decisão</dt><dd>{data(aberta.verificadoEm)}</dd></div>}
            {aberta.carteirinha && <div><dt>Carteirinha</dt><dd>{aberta.carteirinha.codigo}</dd></div>}
          </dl>
          {erroDecisao && !rejeitando && <p className={controles.erro} role="alert">{erroDecisao}</p>}
          {!aberta.ativo ? <p className={controles.nota}>Conta desativada. A solicitação não pode ser decidida enquanto a conta estiver desativada.</p>
            : aberta.statusVerificacao === "pendente" ? <>
              <p className={pagina.texto}>{aberta.perfil === "atleta" ? "A aprovação confirma o vínculo e emite a carteirinha." : "A aprovação permite a atribuição a um clube pelo presidente."}</p>
              <button type="button" className={controles.primario} onClick={() => void decidir(aberta, "aprovar")} disabled={enviando}>{enviando ? "Enviando…" : aberta.perfil === "atleta" ? "Aprovar e emitir carteirinha" : "Aprovar cadastro"}</button>
              <button type="button" className={styles.rejeitar} onClick={() => { setErroDecisao(""); setRejeitando(aberta); }} disabled={enviando}>Rejeitar cadastro</button>
            </> : <p className={pagina.texto}>{aberta.statusVerificacao === "aprovado" ? "Cadastro aprovado. A aprovação não pode ser desfeita." : "Cadastro rejeitado. Uma nova análise depende de solicitação da própria pessoa."}</p>}
        </> : <><h2 className={styles.nome}>Nenhuma ficha para analisar</h2><p className={pagina.texto}>{pendentes ? "Ajuste a busca ou os filtros para consultar outra solicitação." : "Não há cadastros pendentes. Você pode consultar os cadastros já decididos."}</p></>}
      </section>
    </div>}
    <Confirmacao aberto={rejeitando !== null} titulo={`Rejeitar o cadastro de ${rejeitando ? primeiroNome(rejeitando.nomeCompleto) : ""}?`} rotulo="Confirmar rejeição" tom="perigo" enviando={enviando} erro={erroDecisao} aoConfirmar={() => { if (rejeitando) void decidir(rejeitando, "rejeitar"); }} aoFechar={() => setRejeitando(null)} focoAlternativo={tituloFicha}>
      <p className={pagina.confirmacaoTexto}>{rejeitando?.nomeCompleto} · {rejeitando?.clube?.nome ?? "Sem clube"}</p><p className={pagina.texto}>Uma nova análise só acontece se a pessoa pedir novamente.</p>
    </Confirmacao>
  </>;
}
