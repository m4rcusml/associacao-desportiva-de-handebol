"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { consultarSolicitacoes, type CredenciamentosJogo, type DesempenhoJogo, type DetalheCampeonato, type DetalheJogo as Jogo, type EscalacaoJogo, type Lancamento, type RegistrosJogo, type ResultadoDetalhado, type SolicitacaoVerificacao } from "../../../lib/presidente";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { AdministracaoJogo } from "./administracao-jogo";
import { CorrecoesJogo } from "./correcoes-jogo";
import { LinkTecnico } from "./link-tecnico";
import { data, MetricasAtleta, nomeClube, RESULTADOS, STATUS_JOGO, TIPOS_LANCAMENTO } from "./apoio";
import { EmblemaClube } from "../visual";
import styles from "./jogo.module.css";

type Base = { jogo: Jogo; campeonato: DetalheCampeonato; resultado: ResultadoDetalhado; registros: RegistrosJogo };
type Complementos = { credenciamentos: CredenciamentosJogo; escalacao: EscalacaoJogo; desempenho: DesempenhoJogo; pessoas: SolicitacaoVerificacao[] };
type Aba = "resumo" | "participantes" | "lancamentos" | "administracao" | "correcoes";
const ABAS: { id: Aba; nome: string }[] = [
  { id: "resumo", nome: "Resumo" }, { id: "participantes", nome: "Participantes" }, { id: "lancamentos", nome: "Lançamentos" },
  { id: "administracao", nome: "Arbitragem e agenda" }, { id: "correcoes", nome: "Correções pós-jogo" },
];

export function DetalheJogo({ campeonatoId, jogoId }: { campeonatoId: string; jogoId: string }) {
  const [base, setBase] = useState<Base | null>(null);
  const [complementos, setComplementos] = useState<Complementos | null>(null);
  const [aba, setAba] = useState<Aba>("resumo");
  const [carregando, setCarregando] = useState(true);
  const [carregandoComplementos, setCarregandoComplementos] = useState(false);
  const [erro, setErro] = useState("");
  const [erroComplementos, setErroComplementos] = useState("");
  const [aviso, setAviso] = useState("");
  const titulo = useRef<HTMLHeadingElement>(null);
  const complementosEmCurso = useRef(false);
  const versaoBase = useRef(0);
  const versaoComplementos = useRef(0);
  const tratarErro = useErroApi();

  const consultarBase = useCallback(async (): Promise<Base> => {
    const [jogo, campeonato, resultado, registros] = await Promise.all([
      api<Jogo>(`/jogos/${jogoId}`), api<DetalheCampeonato>(`/campeonatos/${campeonatoId}`),
      api<ResultadoDetalhado>(`/jogos/${jogoId}/resultado`), api<RegistrosJogo>(`/jogos/${jogoId}/lancamentos`),
    ]);
    if (jogo.campeonatoId !== campeonatoId) throw new Error("Este jogo não pertence ao campeonato informado.");
    return { jogo, campeonato, resultado, registros };
  }, [campeonatoId, jogoId]);

  async function carregarBase() {
    const versao = ++versaoBase.current;
    const dados = await consultarBase();
    if (versao === versaoBase.current) setBase(dados);
  }

  async function carregarComplementos() {
    if (complementosEmCurso.current) return;
    complementosEmCurso.current = true;
    const versao = ++versaoComplementos.current;
    setCarregandoComplementos(true);
    setErroComplementos("");
    try {
      const [credenciamentos, escalacao, desempenho, pessoas] = await Promise.all([
        api<CredenciamentosJogo>(`/jogos/${jogoId}/credenciamentos`), api<EscalacaoJogo>(`/jogos/${jogoId}/escalacao`),
        api<DesempenhoJogo>(`/jogos/${jogoId}/desempenho`), consultarSolicitacoes(),
      ]);
      if (versao === versaoComplementos.current) setComplementos({ credenciamentos, escalacao, desempenho, pessoas });
    } catch (error) {
      if (versao === versaoComplementos.current) setErroComplementos(tratarErro(error));
    } finally {
      complementosEmCurso.current = false;
      setCarregandoComplementos(false);
    }
  }

  useEffect(() => {
    let ativo = true;
    consultarBase().then(dados => { if (ativo) setBase(dados); }).catch(error => { if (ativo) setErro(tratarErro(error)); }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [consultarBase, tratarErro]);

  async function atualizar(mensagem?: string) {
    if (mensagem) setAviso(mensagem);
    setErro("");
    try { await Promise.all([carregarBase(), ...(complementos ? [carregarComplementos()] : [])]); }
    catch (error) { setErro(`${mensagem ? "A alteração foi registrada, mas não foi possível atualizar a consulta. " : ""}${tratarErro(error)}`); }
  }

  function mudarAba(nova: Aba) {
    setAba(nova);
    if (nova !== "resumo" && nova !== "lancamentos" && !complementos) void carregarComplementos();
  }

  if (!base) return <>
    <Link className={pagina.voltar} href={`/presidente/campeonatos/${campeonatoId}`}>Voltar ao campeonato</Link>
    {carregando ? <p role="status" className={pagina.carregando}>Carregando jogo…</p> : <><p role="alert" className={controles.erro}>{erro || "Não foi possível carregar o jogo."}</p><button type="button" className={controles.secundario} onClick={() => { setCarregando(true); void carregarBase().catch(error => setErro(tratarErro(error))).finally(() => setCarregando(false)); }}>Tentar novamente</button></>}
  </>;

  const { jogo, campeonato, registros, resultado } = base;
  const placar = registros.placar;
  const ordem: Aba[] = jogo.status === "finalizado" ? ["resumo", "correcoes", "participantes", "lancamentos", "administracao"]
    : jogo.status === "agendado" ? ["resumo", "administracao", "participantes", "lancamentos"]
    : ["resumo", "participantes", "lancamentos", "administracao"];
  return <>
    <Link className={pagina.voltar} href={`/presidente/campeonatos/${campeonatoId}`}>Voltar a {campeonato.nome}</Link>
    <div className={pagina.topo}>
      <div><h1 ref={titulo} tabIndex={-1} className={pagina.titulo}>{jogo.status === "agendado" ? "Preparar jogo" : jogo.status === "em_andamento" ? "Jogo em andamento" : jogo.status === "finalizado" ? "Jogo encerrado" : "Jogo cancelado"}</h1><p className={pagina.texto}>{campeonato.nome} · {campeonato.categoria} {campeonato.edicao}</p></div>
      <button type="button" className={controles.secundario} onClick={() => void atualizar()}>Atualizar jogo</button>
    </div>
    <span className={`${controles.status} ${jogo.status === "finalizado" ? controles.statusAprovado : jogo.status === "cancelado" ? controles.statusRejeitado : controles.statusPendente}`}>{STATUS_JOGO[jogo.status]}{jogo.interrompidoEm ? " · Interrompido" : ""}{jogo.invalidadoEm ? " · Invalidado" : ""}</span>
    <div className={styles.resumo}>
      <div className={styles.confronto}><div className={styles.clubeA}><EmblemaClube nome={jogo.clubeA.clube.nome} /><strong>{jogo.clubeA.clube.nome}</strong></div><p className={styles.placar} aria-label={placar ? `Placar: ${placar.placarClubeA} a ${placar.placarClubeB}` : "Placar indisponível"}>{placar ? `${placar.placarClubeA} × ${placar.placarClubeB}` : "— × —"}</p><div className={styles.clubeB}><EmblemaClube nome={jogo.clubeB.clube.nome} cobre /><strong>{jogo.clubeB.clube.nome}</strong></div></div>
      <p className={styles.texto}>{jogo.inicioPrevistoEm ? data(jogo.inicioPrevistoEm, jogo.fusoHorario) : "Sem data prevista"} · {jogo.fusoHorario}{jogo.local ? ` · ${jogo.local}` : ""}</p>
      {jogo.status === "finalizado" && <p className={styles.texto}>{jogo.resultado ? RESULTADOS[jogo.resultado] : "Resultado não informado"} · Vencedor: {nomeClube(jogo, jogo.vencedorInscricaoId)}</p>}
    </div>
    {jogo.status === "agendado" && aba === "resumo" && <section className={`${pagina.secao} ${styles.secao}`}><h2 className={pagina.secaoTitulo}>Arbitragem</h2><p className={pagina.secaoTexto}>{jogo.arbitragens.length ? jogo.arbitragens.map(a => a.usuario?.nomeCompleto ?? a.nomeCompleto ?? "Pessoa designada").join(", ") : "Nenhuma pessoa designada."}</p><button type="button" className={controles.primario} onClick={() => mudarAba("administracao")}>Designar arbitragem</button></section>}
    {jogo.status === "em_andamento" && <div className={styles.acoes}><button type="button" className={controles.primario} onClick={() => mudarAba("participantes")}>Consultar registros do jogo</button><button type="button" className={controles.secundario} onClick={() => mudarAba("administracao")}>Designar arbitragem</button></div>}
    {jogo.status === "agendado" && <LinkTecnico jogoId={jogoId} />}
    <p role="status" className={pagina.aviso}>{aviso}</p>
    {erro && <p role="alert" className={`${controles.erro} ${styles.erro}`}>{erro}</p>}
    <div className={styles.abas} role="group" aria-label="Informações do jogo">{ordem.map(id => ABAS.find(a => a.id === id)!).map(a => <button key={a.id} type="button" className={controles.opcao} aria-pressed={aba === a.id} onClick={() => mudarAba(a.id)}>{a.nome}</button>)}</div>

    {aba === "resumo" && <details className={styles.historico}><summary>Dados e histórico do jogo</summary><Resumo jogo={jogo} resultado={resultado} /></details>}
    {aba === "lancamentos" && <Lancamentos jogo={jogo} registros={registros} />}
    {aba !== "resumo" && aba !== "lancamentos" && <>
      {carregandoComplementos && !complementos && <p role="status" className={pagina.carregando}>Consultando participantes e cadastros…</p>}
      {erroComplementos && <div className={styles.erro}><p role="alert" className={controles.erro}>{erroComplementos}</p><button type="button" className={controles.secundario} onClick={() => void carregarComplementos()} disabled={carregandoComplementos}>Tentar novamente</button></div>}
      {complementos && <>
        {aba === "participantes" && <Participantes jogo={jogo} dados={complementos} />}
        {aba === "administracao" && <AdministracaoJogo jogo={jogo} pessoas={complementos.pessoas} atualizar={atualizar} focoAlternativo={titulo} />}
        {aba === "correcoes" && <CorrecoesJogo jogo={jogo} registros={registros} credenciamentos={complementos.credenciamentos} pessoas={complementos.pessoas} atualizar={atualizar} focoAlternativo={titulo} />}
      </>}
    </>}
  </>;
}

function Resumo({ jogo, resultado }: { jogo: Jogo; resultado: ResultadoDetalhado }) {
  return <div className={pagina.secoes}>
    <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Dados do jogo</h2><dl className={styles.ficha}>
      <div><dt>Clube A</dt><dd>{jogo.clubeA.clube.nome}</dd></div><div><dt>Clube B</dt><dd>{jogo.clubeB.clube.nome}</dd></div>
      <div><dt>Início previsto</dt><dd>{jogo.inicioPrevistoEm ? data(jogo.inicioPrevistoEm, jogo.fusoHorario) : "Sem data"}</dd></div><div><dt>Fuso do local</dt><dd>{jogo.fusoHorario}</dd></div>
      <div><dt>Local</dt><dd>{jogo.local ?? "Não informado"}</dd></div><div><dt>Início realizado</dt><dd>{data(jogo.iniciadoEm, jogo.fusoHorario)}</dd></div><div><dt>Encerramento</dt><dd>{data(jogo.encerradoEm, jogo.fusoHorario)}</dd></div>
    </dl></section>
    {resultado.invalidacao && <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Invalidação</h2><p className={styles.texto}>{resultado.invalidacao.motivo}</p><p className={styles.meta}>{data(resultado.invalidacao.invalidadoEm, jogo.fusoHorario)} · {resultado.invalidacao.presidente?.nomeCompleto ?? "Presidente responsável"}</p></section>}
    <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Histórico do resultado</h2>{!resultado.alteracoes.length ? <p className={styles.texto}>Nenhuma correção administrativa de resultado.</p> : <ul className={styles.lista}>{resultado.alteracoes.map(a => <li className={styles.item} key={a.id}><p className={styles.nome}>{a.tipo === "invalidacao" ? "Invalidação do jogo" : "Correção de resultado"}</p><p className={styles.meta}>{data(a.registradaEm, jogo.fusoHorario)} · {a.presidente.nomeCompleto}</p><p className={styles.texto}>De {RESULTADOS[a.resultadoAnterior]}, vencedor {nomeClube(jogo, a.inscricaoVencedorAnteriorId)}, para {RESULTADOS[a.resultadoNovo]}, vencedor {nomeClube(jogo, a.inscricaoVencedorNovoId)}.</p>{a.motivo && <p className={styles.texto}>{a.motivo}</p>}</li>)}</ul>}</section>
    {!!resultado.interrupcoes.length && <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Interrupções da partida</h2><ul className={styles.lista}>{resultado.interrupcoes.map(i => <li className={styles.item} key={i.interrompidoEm}><p className={styles.texto}>Interrompido em {data(i.interrompidoEm, jogo.fusoHorario)} · {i.retomadoEm ? `Retomado em ${data(i.retomadoEm, jogo.fusoHorario)}` : "Sem retomada registrada"}</p></li>)}</ul></section>}
  </div>;
}

function Lancamentos({ jogo, registros }: { jogo: Jogo; registros: RegistrosJogo }) {
  function referencia(id: string) {
    const l = registros.lancamentos.find(item => item.id === id);
    return l ? `${TIPOS_LANCAMENTO[l.tipo]} de ${l.atleta?.nomeCompleto ?? "atleta indisponível"}, ${data(l.registradoEm, jogo.fusoHorario)}` : "lançamento preservado no histórico";
  }
  return <div className={pagina.secoes}>
    <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Desempenho por atleta</h2>{!registros.desempenho.length ? <p className={styles.texto}>Nenhuma métrica disponível para este jogo.</p> : <ul className={styles.lista}>{registros.desempenho.map(p => <li className={styles.item} key={p.participacaoId}><p className={styles.nome}>{p.atleta.nomeCompleto} · camisa {p.numeroCamisa}</p><span className={styles.meta}>{nomeClube(jogo, p.inscricaoId)}</span><MetricasAtleta {...p} /></li>)}</ul>}</section>
    <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Lançamentos e correções</h2>{!registros.lancamentos.length ? <p className={styles.texto}>Nenhuma ocorrência registrada pela arbitragem.</p> : <ul className={styles.lista}>{registros.lancamentos.map((l: Lancamento) => <li className={styles.item} key={l.id}>
      <p className={styles.nome}>{TIPOS_LANCAMENTO[l.tipo]}{l.relatorioDisciplinar ? " com relatório disciplinar" : ""} · {l.atleta?.nomeCompleto ?? "Atleta indisponível"}</p><p className={styles.meta}>{nomeClube(jogo, l.inscricaoId)}{l.numeroCamisa !== null ? ` · camisa ${l.numeroCamisa}` : ""} · {data(l.registradoEm, jogo.fusoHorario)}</p>
      <p className={styles.meta}>{l.substituidoPorId ? "Substituído por correção" : l.anuladoEm ? `Anulado em ${data(l.anuladoEm, jogo.fusoHorario)}` : "Válido"}</p>
      {l.substituiLancamentoId && <p className={styles.texto}>Corrige: {referencia(l.substituiLancamentoId)}.</p>}{l.substituidoPorId && <p className={styles.texto}>Substituto: {referencia(l.substituidoPorId)}.</p>}
    </li>)}</ul>}</section>
  </div>;
}

function Participantes({ jogo, dados }: { jogo: Jogo; dados: Complementos }) {
  const { desempenho, escalacao, credenciamentos } = dados;
  return <div className={pagina.secoes}>
    <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Participação no jogo</h2><p className={pagina.secaoTexto}>Escalação, credenciamento e entrada em quadra são etapas distintas.</p>
      {!desempenho.participacoes.length ? <p className={styles.texto}>Nenhuma participação registrada.</p> : <ul className={styles.lista}>{desempenho.participacoes.map(p => <li className={styles.item} key={p.participacaoId}><p className={styles.nome}>{p.atleta.nomeCompleto}{p.numeroCamisa !== null ? ` · camisa ${p.numeroCamisa}` : ""}</p><p className={styles.meta}>{nomeClube(jogo, p.inscricaoId)}</p><p className={styles.texto}>Escalação: {p.escalado ? "sim" : "não"} · Credenciamento: {p.credenciado ? "sim" : "não"} · Entrada em quadra: {p.entrouEmQuadra ? "sim" : "não"}{p.entradaAnulada ? " (anulada)" : ""}</p>{p.registroAdministrativo && <p className={styles.meta}>Registro administrativo{p.irregularidades.length ? ` · Irregularidades: ${p.irregularidades.map(i => i === "conta_desativada" ? "conta desativada" : i === "carteirinha_invalidada" ? "carteirinha invalidada" : "suspensão").join(", ")}` : ""}</p>}{p.metricas && <MetricasAtleta {...p.metricas} />}</li>)}</ul>}
    </section>
    <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Escalação preliminar</h2>{escalacao.clubes.map(c => <div className={styles.secao} key={c.inscricaoId}><h3 className={styles.subtitulo}>{c.clube.nome}</h3><p className={styles.meta}>Técnico atual: {c.tecnico?.nomeCompleto ?? "Sem técnico"}</p>{!c.escalados.length ? <p className={styles.texto}>Nenhum atleta escalado.</p> : <ul className={styles.lista}>{c.escalados.map(p => <li className={styles.item} key={p.participacaoId}><p className={styles.nome}>{p.atleta.nomeCompleto}</p><p className={styles.meta}>Escolhido por {p.escolhidaPorTecnico?.nomeCompleto ?? "técnico responsável"} em {data(p.escolhidaEm, jogo.fusoHorario)}</p>{!p.vinculoAtual && <p className={controles.nota}>O vínculo com este clube não está mais vigente.</p>}{p.suspensaoPendente && <p className={styles.meta}>Suspensão pendente.</p>}</li>)}</ul>}
      {!!c.alteracoes.length && <details className={styles.historico}><summary>Histórico de alterações da escalação</summary><ul className={styles.lista}>{c.alteracoes.map((a, i) => <li className={styles.item} key={`${a.ocorridoEm}-${i}`}><p className={styles.texto}>{a.tipo === "inclusao" ? "Inclusão" : "Retirada"} de {a.atleta.nomeCompleto}</p><p className={styles.meta}>{a.tecnico.nomeCompleto} · {data(a.ocorridoEm, jogo.fusoHorario)}</p></li>)}</ul></details>}
    </div>)}</section>
    <section className={pagina.secao}><h2 className={pagina.secaoTitulo}>Histórico de credenciamentos</h2>{!credenciamentos.alteracoes.length && !credenciamentos.desfeitas.length && !credenciamentos.participacoes.some(p => p.entradaAnulada) ? <p className={styles.texto}>Nenhuma correção ou estorno registrado.</p> : <ul className={styles.lista}>
      {credenciamentos.participacoes.filter(p => p.entradaAnulada).map(p => <li className={styles.item} key={`entrada-${p.participacaoId}`}><p className={styles.nome}>Entrada anulada · {p.atleta.nomeCompleto}</p><p className={styles.meta}>{data(p.entradaAnulada!.anuladaEm, jogo.fusoHorario)}</p></li>)}
      {credenciamentos.alteracoes.map(a => <li className={styles.item} key={a.id}><p className={styles.nome}>{a.tipo === "correcao_camisa" ? "Correção de camisa" : "Credenciamento desfeito"} · {a.atleta.nomeCompleto}</p><p className={styles.meta}>{nomeClube(jogo, a.inscricaoId)} · {data(a.registradaEm, jogo.fusoHorario)}</p><p className={styles.texto}>Camisa anterior: {a.numeroCamisaAnterior}{a.numeroCamisaNova !== null ? ` · Nova camisa: ${a.numeroCamisaNova}` : ""}.</p></li>)}
      {credenciamentos.desfeitas.map(p => <li className={styles.item} key={`desfeita-${p.participacaoId}`}><p className={styles.nome}>Credenciamento desfeito · {p.atleta.nomeCompleto}</p><p className={styles.meta}>{nomeClube(jogo, p.inscricaoId)} · {data(p.desfeitoEm, jogo.fusoHorario)}</p></li>)}
    </ul>}</section>
  </div>;
}
