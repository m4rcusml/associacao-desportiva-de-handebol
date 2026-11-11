"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, type ApiMethod } from "../../../lib/api";
import type { Clube, DetalheCampeonato as Campeonato, Inscricao, Jogo, Suspensao } from "../../../lib/presidente";
import { Dialogo } from "../../ui/dialogo";
import { Confirmacao } from "../../ui/confirmacao";
import { conflito, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import styles from "../../ui/pagina.module.css";
import { dataCivil, horaLocal, NOME_STATUS_CAMPEONATO, NOME_STATUS_JOGO } from "./formatos";
import { SuspensoesCampeonato } from "./suspensoes-campeonato";
import visual from "../visual.module.css";

type Dados = { campeonato: Campeonato; clubes: Clube[]; jogos: Jogo[]; suspensoes: Suspensao[] };
type Transicao = "iniciar" | "encerrar" | "cancelar";
type Acao = { tipo: "inscrever" } | { tipo: "agendar" } | { tipo: "retirar"; inscricao: Inscricao } | { tipo: "transicao"; transicao: Transicao };
const VERBO_TRANSICAO: Record<Transicao, string> = { iniciar: "Iniciar campeonato", encerrar: "Encerrar campeonato", cancelar: "Cancelar campeonato" };

export function DetalheCampeonato({ campeonatoId }: { campeonatoId: string }) {
  const tratarErro = useErroApi();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [acao, setAcao] = useState<Acao | null>(null);
  const [erroAcao, setErroAcao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const envio = useRef(false);
  const fechar = useRef<HTMLButtonElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const [aba, setAba] = useState<"jogos" | "clubes" | "suspensoes">("jogos");
  const consulta = useRef(0);

  const carregar = useCallback(() => {
    const versao = ++consulta.current;
    return Promise.all([
    api<Campeonato>(`/campeonatos/${campeonatoId}`), api<Clube[]>("/clubes/visao-geral"),
    api<Jogo[]>(`/campeonatos/${campeonatoId}/jogos`), api<Suspensao[]>(`/campeonatos/${campeonatoId}/suspensoes`),
  ]).then(([campeonato, clubes, jogos, suspensoes]) => {
      if (versao !== consulta.current) return;
      setDados({ campeonato, clubes, jogos, suspensoes });
      setErro("");
    }).catch(falha => { if (versao === consulta.current) setErro(tratarErro(falha)); });
  }, [campeonatoId, tratarErro]);
  const invalidarConsulta = useCallback(() => { consulta.current++; }, []);
  useEffect(() => { void carregar(); return invalidarConsulta; }, [carregar, invalidarConsulta]);

  const recarregarSuspensoes = useCallback(async () => {
    const versao = ++consulta.current;
    const suspensoes = await api<Suspensao[]>(`/campeonatos/${campeonatoId}/suspensoes`);
    if (versao === consulta.current) setDados(atual => atual ? { ...atual, suspensoes } : atual);
  }, [campeonatoId]);

  function abrir(proxima: Acao) { setErroAcao(""); setAcao(proxima); }

  async function executar(caminho: string, corpo: unknown, metodo: ApiMethod, mensagem: string) {
    if (envio.current) return;
    envio.current = true;
    consulta.current++;
    setEnviando(true);
    setErroAcao("");
    try {
      await api<unknown>(caminho, corpo, metodo);
      setAcao(null);
      setAviso(mensagem);
      await carregar();
    } catch (falha) {
      setErroAcao(tratarErro(falha));
      if (conflito(falha)) await carregar();
    } finally { envio.current = false; setEnviando(false); }
  }

  function inscrever(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    void executar(`/campeonatos/${campeonatoId}/inscricoes`, { clubeId: String(formulario.get("clubeId")) }, "POST", "Clube inscrito no campeonato.");
  }

  function agendar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    const clubeAId = String(formulario.get("clubeAId"));
    const clubeBId = String(formulario.get("clubeBId"));
    if (clubeAId === clubeBId) { setErroAcao("Escolha dois clubes diferentes para o jogo."); return; }
    const local = String(formulario.get("local") ?? "").trim();
    void executar(`/campeonatos/${campeonatoId}/jogos`, {
      clubeAId, clubeBId, inicioPrevisto: String(formulario.get("inicioPrevisto")),
      fusoHorario: String(formulario.get("fusoHorario")).trim(), ...(local ? { local } : {}),
    }, "POST", "Jogo agendado. A arbitragem fará o início da partida.");
  }

  function confirmar() {
    if (acao?.tipo === "retirar") {
      void executar(`/campeonatos/${campeonatoId}/inscricoes/${acao.inscricao.id}`, undefined, "DELETE", `Inscrição de ${acao.inscricao.clube.nome} retirada.`);
    } else if (acao?.tipo === "transicao") {
      const mensagem = { iniciar: "Campeonato iniciado.", encerrar: "Campeonato encerrado.", cancelar: "Campeonato cancelado." }[acao.transicao];
      void executar(`/campeonatos/${campeonatoId}/${acao.transicao}`, {}, "POST", mensagem);
    }
  }

  if (!dados) return <>
    <Link className={styles.voltar} href="/presidente/campeonatos">Voltar aos campeonatos</Link>
    {erro ? <><p className={controles.erro} role="alert">{erro}</p><button className={controles.secundario} type="button" onClick={() => void carregar()}>Tentar novamente</button></> : <p className={styles.carregando} role="status">Carregando campeonato…</p>}
  </>;

  const { campeonato, clubes, jogos, suspensoes } = dados;
  const planejado = campeonato.status === "planejado";
  const recebeJogos = planejado || campeonato.status === "em_andamento";
  const jogosPendentes = jogos.some(j => j.status === "agendado" || j.status === "em_andamento");
  const jogoEmAndamento = jogos.some(j => j.status === "em_andamento");
  const disponiveis = clubes.filter(c => !campeonato.inscricoes.some(i => i.clube.id === c.id));
  const formularioAberto = acao?.tipo === "inscrever" || acao?.tipo === "agendar";
  const confirmacaoAberta = acao?.tipo === "retirar" || acao?.tipo === "transicao";
  const tituloConfirmacao = acao?.tipo === "retirar" ? `Retirar ${acao.inscricao.clube.nome}?` : acao?.tipo === "transicao" ? `${VERBO_TRANSICAO[acao.transicao]}?` : "Confirmar decisão";

  return <>
    <Link className={styles.voltar} href="/presidente/campeonatos">Voltar aos campeonatos</Link>
    <div className={styles.topo}><div><h1 ref={titulo} tabIndex={-1} className={styles.titulo}>{campeonato.nome}</h1><p className={styles.texto}>Edição {campeonato.edicao} · {campeonato.categoria}</p></div>{recebeJogos && <button className={controles.primario} type="button" disabled={enviando || campeonato.inscricoes.length < 2} onClick={() => abrir({ tipo: "agendar" })}>Agendar jogo</button>}</div>
    {erro && <p className={controles.erro} role="alert">{erro}</p>}
    <span className={`${controles.status} ${campeonato.status === "planejado" ? controles.statusPendente : campeonato.status === "cancelado" ? controles.statusRejeitado : controles.statusAprovado}`}>{NOME_STATUS_CAMPEONATO[campeonato.status]}</span>
    <details className={visual.maisFiltros}><summary>Opções do campeonato</summary>
    <dl className={styles.ficha}><div><dt>Início previsto</dt><dd>{dataCivil(campeonato.inicio)}</dd></div><div><dt>Fim previsto</dt><dd>{dataCivil(campeonato.fim)}</dd></div></dl>
    <div className={styles.acoes}>
      {planejado && <button type="button" className={controles.aprovar} disabled={enviando || campeonato.inscricoes.length < 2} onClick={() => abrir({ tipo: "transicao", transicao: "iniciar" })}>Iniciar campeonato</button>}
      {campeonato.status === "em_andamento" && <button type="button" className={controles.primario} disabled={enviando || jogosPendentes} onClick={() => abrir({ tipo: "transicao", transicao: "encerrar" })}>Encerrar campeonato</button>}
      {recebeJogos && <button type="button" className={controles.rejeitar} disabled={enviando || jogoEmAndamento} onClick={() => abrir({ tipo: "transicao", transicao: "cancelar" })}>Cancelar campeonato</button>}
    </div>
    {planejado && campeonato.inscricoes.length < 2 && <p className={controles.ajuda}>Inscreva ao menos dois clubes para iniciar o campeonato.</p>}
    {campeonato.status === "em_andamento" && jogosPendentes && <p className={controles.ajuda}>O encerramento exige todos os jogos finalizados ou cancelados.</p>}
    {jogoEmAndamento && <p className={controles.ajuda}>Não é possível cancelar um campeonato com jogo em andamento.</p>}
    <button className={controles.secundario} type="button" onClick={() => void carregar()} disabled={enviando}>Atualizar campeonato</button>
    </details>
    <p className={styles.aviso} role="status">{aviso}</p>
    <div className={visual.seletor} role="group" aria-label="Seções do campeonato"><button type="button" className={controles.opcao} aria-pressed={aba === "jogos"} onClick={() => setAba("jogos")}>Jogos</button><button type="button" className={controles.opcao} aria-pressed={aba === "clubes"} onClick={() => setAba("clubes")}>Clubes inscritos</button><button type="button" className={controles.opcao} aria-pressed={aba === "suspensoes"} onClick={() => setAba("suspensoes")}>Suspensões</button></div>
    <div className={styles.secoes}>
      <section hidden={aba !== "clubes"} id="clubes-inscritos" className={styles.secao} aria-labelledby="clubes-inscritos-titulo">
        <div className={styles.secaoTopo}><h2 id="clubes-inscritos-titulo" className={styles.secaoTitulo}>Clubes inscritos</h2>{planejado && <button className={controles.primario} type="button" disabled={enviando || disponiveis.length === 0} onClick={() => abrir({ tipo: "inscrever" })}>Inscrever clube</button>}</div>
        <p className={styles.secaoTexto}>As inscrições só podem mudar enquanto o campeonato estiver planejado. Clubes com jogos permanecem inscritos.</p>
        {campeonato.inscricoes.length ? <ul className={styles.lista}>{campeonato.inscricoes.map(i => {
          const temJogo = jogos.some(j => j.clubeA.inscricaoId === i.id || j.clubeB.inscricaoId === i.id);
          return <li key={i.id} className={styles.linhaAcoes}><div><strong className={styles.linhaNome}>{i.clube.nome}</strong><span className={styles.linhaMeta}>{i.clube.cidade ?? "Cidade não informada"}{temJogo ? " · Possui jogos no campeonato" : ""}</span></div>{planejado && <div><button className={controles.secundario} type="button" disabled={enviando || temJogo} onClick={() => abrir({ tipo: "retirar", inscricao: i })} aria-label={`Retirar inscrição de ${i.clube.nome}`}>Retirar inscrição</button></div>}</li>;
        })}</ul> : <p className={styles.texto}>Nenhum clube inscrito. Inclua os participantes para agendar jogos.</p>}
        {planejado && disponiveis.length === 0 && <p className={controles.ajuda}>Todos os clubes cadastrados já estão inscritos. Novos clubes podem ser cadastrados na área de clubes.</p>}
      </section>
      <section hidden={aba !== "jogos"} id="jogos" className={styles.secao} aria-labelledby="jogos-titulo">
        <div className={styles.secaoTopo}><h2 id="jogos-titulo" className={styles.secaoTitulo}>Jogos</h2>{recebeJogos && <button className={controles.primario} type="button" disabled={enviando || campeonato.inscricoes.length < 2} onClick={() => abrir({ tipo: "agendar" })}>Agendar jogo</button>}</div>
        <p className={styles.secaoTexto}>Agende os confrontos entre clubes inscritos. O início e o encerramento da partida são feitos pela arbitragem.</p>
        {jogos.length ? <ul className={styles.lista}>{jogos.map(j => <li key={j.id}><Link className={styles.linha} href={`/presidente/campeonatos/${campeonatoId}/jogos/${j.id}`}><span className={styles.linhaNome}>{j.clubeA.clube.nome} × {j.clubeB.clube.nome}</span><span className={styles.linhaMeta}>{j.local ?? "Local não informado"}</span><span className={styles.linhaData}>{horaLocal(j.inicioPrevistoLocal)} · {j.fusoHorario}</span><span className={`${styles.linhaStatus} ${controles.status} ${j.status === "agendado" ? controles.statusPendente : j.status === "cancelado" ? controles.statusRejeitado : controles.statusAprovado}`}>{j.interrompidoEm ? "Interrompido" : NOME_STATUS_JOGO[j.status]}</span></Link></li>)}</ul> : <p className={styles.texto}>Nenhum jogo agendado neste campeonato.</p>}
      </section>
      <div hidden={aba !== "suspensoes"}><SuspensoesCampeonato campeonatoId={campeonatoId} statusCampeonato={campeonato.status} suspensoes={suspensoes} aoAtualizar={recarregarSuspensoes} /></div>
    </div>

    <Dialogo aberto={formularioAberto} bloqueado={enviando} aoFechar={() => setAcao(null)} tituloId="campeonato-formulario-titulo" focoInicial={fechar} focoAlternativo={titulo}>
      <div className={styles.detalhe}><div className={styles.detalheTopo}><h2 id="campeonato-formulario-titulo" className={styles.detalheNome}>{acao?.tipo === "inscrever" ? "Inscrever clube" : "Agendar jogo"}</h2><button ref={fechar} className={styles.fechar} type="button" onClick={() => setAcao(null)} disabled={enviando}>Fechar</button></div>
        {acao?.tipo === "inscrever" && <form className={styles.formulario} onSubmit={inscrever}><div className={controles.campo}><label htmlFor="inscricao-clube" className={controles.rotulo}>Clube</label><select id="inscricao-clube" name="clubeId" className={controles.entrada} required defaultValue="" disabled={enviando || !planejado}><option value="" disabled>Selecione um clube</option>{disponiveis.map(c => <option key={c.id} value={c.id}>{c.nome}{c.cidade ? ` — ${c.cidade}` : ""}</option>)}</select></div>{!planejado && <p className={controles.nota}>O campeonato já não está planejado. Não é possível incluir inscrições.</p>}{erroAcao && <p className={controles.erro} role="alert">{erroAcao}</p>}<button className={controles.primario} type="submit" disabled={enviando || !planejado || disponiveis.length === 0}>{enviando ? "Inscrevendo…" : "Confirmar inscrição"}</button></form>}
        {acao?.tipo === "agendar" && <form className={styles.formulario} onSubmit={agendar}>
          <div className={controles.campo}><label htmlFor="jogo-clube-a" className={controles.rotulo}>Clube A</label><select id="jogo-clube-a" name="clubeAId" className={controles.entrada} required defaultValue="" disabled={enviando}><option value="" disabled>Selecione o clube A</option>{campeonato.inscricoes.map(i => <option key={i.id} value={i.clube.id}>{i.clube.nome}</option>)}</select></div>
          <div className={controles.campo}><label htmlFor="jogo-clube-b" className={controles.rotulo}>Clube B</label><select id="jogo-clube-b" name="clubeBId" className={controles.entrada} required defaultValue="" disabled={enviando}><option value="" disabled>Selecione o clube B</option>{campeonato.inscricoes.map(i => <option key={i.id} value={i.clube.id}>{i.clube.nome}</option>)}</select></div>
          <div className={controles.campo}><label htmlFor="jogo-inicio" className={controles.rotulo}>Data e hora local</label><input id="jogo-inicio" name="inicioPrevisto" type="datetime-local" step={60} className={controles.entrada} required disabled={enviando} /></div>
          <div className={controles.campo}><label htmlFor="jogo-fuso" className={controles.rotulo}>Fuso do local do jogo</label><input id="jogo-fuso" name="fusoHorario" className={controles.entrada} defaultValue="America/Sao_Paulo" required maxLength={64} list="fusos-jogo" aria-describedby="ajuda-fuso-jogo" disabled={enviando} /><datalist id="fusos-jogo"><option value="America/Sao_Paulo" /><option value="America/Recife" /><option value="America/Manaus" /><option value="America/Rio_Branco" /></datalist><p id="ajuda-fuso-jogo" className={controles.ajuda}>A hora informada pertence a este fuso, sem conversão pelo fuso do seu aparelho.</p></div>
          <div className={controles.campo}><label htmlFor="jogo-local" className={controles.rotulo}>Local (opcional)</label><input id="jogo-local" name="local" className={controles.entrada} maxLength={160} disabled={enviando} /></div>
          {!recebeJogos && <p className={controles.nota}>O campeonato foi encerrado ou cancelado e não recebe novos jogos.</p>}{erroAcao && <p className={controles.erro} role="alert">{erroAcao}</p>}<button className={controles.primario} type="submit" disabled={enviando || !recebeJogos}>{enviando ? "Agendando…" : "Agendar jogo"}</button>
        </form>}
      </div>
    </Dialogo>
    <Confirmacao aberto={confirmacaoAberta} focoAlternativo={titulo} titulo={tituloConfirmacao} rotulo={acao?.tipo === "retirar" ? "Retirar inscrição" : acao?.tipo === "transicao" ? VERBO_TRANSICAO[acao.transicao] : "Confirmar"} tom={acao?.tipo === "transicao" && acao.transicao === "iniciar" ? "aprovar" : "perigo"} enviando={enviando} erro={erroAcao} aoConfirmar={confirmar} aoFechar={() => setAcao(null)}>
      <p className={styles.confirmacaoTexto}>{acao?.tipo === "retirar" ? "O clube será retirado deste campeonato. O cadastro do clube e seus vínculos serão preservados." : acao?.tipo === "transicao" && acao.transicao === "iniciar" ? "As inscrições deixam de ser alteráveis após o início. Confirme se todos os clubes participantes estão inscritos." : acao?.tipo === "transicao" && acao.transicao === "encerrar" ? "Os saldos de suspensões vigentes serão encerrados, mantendo o histórico das decisões e jogos cumpridos." : "Os jogos agendados serão cancelados e seus acessos de arbitragem revogados. Os saldos de suspensões serão encerrados, preservando o histórico."}</p>
    </Confirmacao>
  </>;
}
