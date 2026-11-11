"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import type { Campeonato, DetalheCampeonato, StatusCampeonato } from "../../../lib/presidente";
import { Dialogo } from "../../ui/dialogo";
import { conflito, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import styles from "../../ui/pagina.module.css";
import { dataCivil, normalizar, NOME_STATUS_CAMPEONATO } from "./formatos";
import { IconePresidente } from "../visual";
import visual from "../visual.module.css";

export function ListaCampeonatos() {
  const router = useRouter();
  const tratarErro = useErroApi();
  const [campeonatos, setCampeonatos] = useState<Campeonato[] | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<StatusCampeonato | "todos">("todos");
  const [criando, setCriando] = useState(false);
  const [erroCriacao, setErroCriacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const envio = useRef(false);
  const fechar = useRef<HTMLButtonElement>(null);
  const consulta = useRef(0);

  const carregar = useCallback(() => {
    const versao = ++consulta.current;
    return api<Campeonato[]>("/campeonatos")
      .then(lista => { if (versao === consulta.current) { setCampeonatos(lista); setErro(""); } })
      .catch(falha => { if (versao === consulta.current) setErro(tratarErro(falha)); });
  }, [tratarErro]);
  const invalidarConsulta = useCallback(() => { consulta.current++; }, []);
  useEffect(() => { void carregar(); return invalidarConsulta; }, [carregar, invalidarConsulta]);

  const termo = normalizar(busca);
  const visiveis = (campeonatos ?? []).filter(c => (status === "todos" || c.status === status)
    && (!termo || normalizar(`${c.nome} ${c.edicao} ${c.categoria}`).includes(termo)));

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (envio.current) return;
    const dados = new FormData(evento.currentTarget);
    const inicio = String(dados.get("inicio") ?? "");
    const fim = String(dados.get("fim") ?? "");
    if (inicio && fim && fim < inicio) {
      setErroCriacao("A data final não pode anteceder a data inicial.");
      return;
    }
    envio.current = true;
    setEnviando(true);
    setErroCriacao("");
    try {
      const criado = await api<DetalheCampeonato>("/campeonatos", {
        nome: String(dados.get("nome")).trim(), edicao: String(dados.get("edicao")).trim(), categoria: String(dados.get("categoria")).trim(),
        ...(inicio ? { inicio } : {}), ...(fim ? { fim } : {}),
      });
      setCriando(false);
      router.push(`/presidente/campeonatos/${criado.id}`);
    } catch (falha) {
      setErroCriacao(tratarErro(falha));
      if (conflito(falha)) await carregar();
    } finally { envio.current = false; setEnviando(false); }
  }

  return <>
    <div className={styles.topo}>
      <div><h1 className={styles.titulo}>Campeonatos</h1><p className={styles.texto}>Jogos, clubes inscritos e disciplina.</p></div>
      <div className={styles.acoes}>
        <button className={controles.secundario} type="button" onClick={() => { setErro(""); void carregar(); }} disabled={enviando}>Atualizar</button>
        <button className={controles.primario} type="button" onClick={() => { setErroCriacao(""); setCriando(true); }} disabled={enviando}>Novo campeonato</button>
      </div>
    </div>
    <div className={controles.campo}><label className={controles.rotulo} htmlFor="busca-campeonato">Buscar campeonato</label><input id="busca-campeonato" className={controles.entrada} type="search" placeholder="Nome, edição ou categoria" value={busca} onChange={e => setBusca(e.target.value)} /></div>
    <div className={visual.seletor} role="group" aria-label="Situação dos campeonatos"><button type="button" className={controles.opcao} aria-pressed={status === "em_andamento"} onClick={() => setStatus("em_andamento")}>Em andamento</button><button type="button" className={controles.opcao} aria-pressed={status === "planejado"} onClick={() => setStatus("planejado")}>Planejados</button><button type="button" className={controles.opcao} aria-pressed={status === "todos"} onClick={() => setStatus("todos")}>Todos</button></div>
    <details className={visual.maisFiltros}><summary>Outras situações</summary><div className={controles.campo}><label className={controles.rotulo} htmlFor="status-campeonato">Situação</label><select id="status-campeonato" className={controles.entrada} value={status} onChange={e => setStatus(e.target.value as StatusCampeonato | "todos")}><option value="todos">Todas as situações</option>{Object.entries(NOME_STATUS_CAMPEONATO).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></div></details>
    {erro && <p className={controles.erro} role="alert">{erro}</p>}
    {campeonatos === null && !erro && <p className={styles.carregando} role="status">Carregando campeonatos…</p>}
    {campeonatos !== null && <>
      <h2 className={styles.resultado}>{visiveis.length === 1 ? "1 campeonato" : `${visiveis.length} campeonatos`}</h2>
      {visiveis.length ? <ul className={visual.lista}>{visiveis.map(c => <li key={c.id}><Link className={visual.linha} href={`/presidente/campeonatos/${c.id}`}>
        <span className={visual.emblema}><IconePresidente tipo="trofeu" /></span><span><span className={visual.nome}>{c.nome}</span><span className={visual.meta}>Edição {c.edicao} · {c.categoria} · {c.inscricoes} {c.inscricoes === 1 ? "clube inscrito" : "clubes inscritos"}</span>
        <span className={visual.meta}>{c.inicio ? `Início: ${dataCivil(c.inicio)}` : "Início não informado"}</span><span className={`${visual.chip} ${controles.status} ${c.status === "planejado" ? controles.statusPendente : c.status === "cancelado" ? controles.statusRejeitado : controles.statusAprovado}`}>{NOME_STATUS_CAMPEONATO[c.status]}</span></span><span className={visual.abrir}>Abrir</span>
      </Link></li>)}</ul> : <div className={styles.vazio}><p className={styles.vazioTexto}>{campeonatos.length ? "Nenhum campeonato corresponde à busca e à situação escolhidas." : "Ainda não há campeonatos cadastrados. Crie o primeiro para inscrever clubes e agendar jogos."}</p>{campeonatos.length > 0 && <button className={controles.secundario} type="button" onClick={() => { setBusca(""); setStatus("todos"); }}>Limpar filtros</button>}</div>}
    </>}
    <Dialogo aberto={criando} bloqueado={enviando} aoFechar={() => setCriando(false)} tituloId="novo-campeonato-titulo" focoInicial={fechar}>
      <div className={styles.detalhe}><div className={styles.detalheTopo}><h2 id="novo-campeonato-titulo" className={styles.detalheNome}>Criar campeonato</h2><button ref={fechar} type="button" className={styles.fechar} onClick={() => setCriando(false)} disabled={enviando}>Fechar</button></div>
        <p className={styles.secaoTexto}>O campeonato começa planejado. As datas são informativas; o início é confirmado por você.</p>
        <form className={styles.formulario} onSubmit={criar}>
          <div className={controles.campo}><label htmlFor="novo-campeonato-nome" className={controles.rotulo}>Nome</label><input id="novo-campeonato-nome" name="nome" className={controles.entrada} required minLength={2} maxLength={120} disabled={enviando} /></div>
          <div className={controles.campo}><label htmlFor="novo-campeonato-edicao" className={controles.rotulo}>Edição</label><input id="novo-campeonato-edicao" name="edicao" className={controles.entrada} required maxLength={60} placeholder="Ex.: 2026" disabled={enviando} /></div>
          <div className={controles.campo}><label htmlFor="novo-campeonato-categoria" className={controles.rotulo}>Categoria</label><input id="novo-campeonato-categoria" name="categoria" className={controles.entrada} required maxLength={60} disabled={enviando} /></div>
          <div className={styles.camposLinha}><div className={controles.campo}><label htmlFor="novo-campeonato-inicio" className={controles.rotulo}>Início (opcional)</label><input id="novo-campeonato-inicio" name="inicio" type="date" className={controles.entrada} disabled={enviando} /></div><div className={controles.campo}><label htmlFor="novo-campeonato-fim" className={controles.rotulo}>Fim (opcional)</label><input id="novo-campeonato-fim" name="fim" type="date" className={controles.entrada} disabled={enviando} /></div></div>
          {erroCriacao && <p role="alert" className={controles.erro}>{erroCriacao}</p>}
          <button type="submit" className={controles.primario} disabled={enviando}>{enviando ? "Criando…" : "Criar campeonato"}</button>
        </form>
      </div>
    </Dialogo>
  </>;
}
