"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { consultarSolicitacoes, type SolicitacaoVerificacao, type StatusVerificacao } from "../../../lib/presidente";
import { contar, data, normalizar } from "../../ui/formatos";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { CLASSE_STATUS, NOME_PERFIL, NOME_STATUS } from "./nomes";

type Perfil = SolicitacaoVerificacao["perfil"];
type FiltroPerfil = Perfil | "todos";
type FiltroStatus = StatusVerificacao | "todos";
type FiltroConta = "todas" | "ativas" | "desativadas";
const SEM_CLUBE = "sem-clube";
const TODOS_CLUBES = "todos";

const OPCOES_PERFIL: readonly { valor: FiltroPerfil; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "atleta", rotulo: "Atletas" },
  { valor: "tecnico", rotulo: "Técnicos" },
];
const OPCOES_STATUS: readonly { valor: FiltroStatus; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "aprovado", rotulo: "Aprovados" },
  { valor: "pendente", rotulo: "Pendentes" },
  { valor: "rejeitado", rotulo: "Rejeitados" },
];
const OPCOES_CONTA: readonly { valor: FiltroConta; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "ativas", rotulo: "Ativas" },
  { valor: "desativadas", rotulo: "Desativadas" },
];

/** Atletas e técnicos conhecidos pela API (não há listagem geral de contas), com busca e filtros. */
export function Pessoas() {
  const tratarErro = useErroApi();
  const [pessoas, setPessoas] = useState<SolicitacaoVerificacao[] | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [busca, setBusca] = useState("");
  const [perfil, setPerfil] = useState<FiltroPerfil>("todos");
  const [status, setStatus] = useState<FiltroStatus>("todos");
  const [conta, setConta] = useState<FiltroConta>("todas");
  const [clube, setClube] = useState(TODOS_CLUBES);

  const carregar = useCallback(() => {
    consultarSolicitacoes()
      .then(lista => { setPessoas([...lista].sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR"))); setErroCarga(""); })
      .catch(erro => setErroCarga(tratarErro(erro)));
  }, [tratarErro]);

  useEffect(carregar, [carregar]);

  function atualizar() {
    setPessoas(null);
    setErroCarga("");
    carregar();
  }

  function limparFiltros() {
    setBusca("");
    setPerfil("todos");
    setStatus("todos");
    setConta("todas");
    setClube(TODOS_CLUBES);
  }

  const lista = pessoas ?? [];
  const clubes = [...new Map(lista.flatMap(p => (p.clube ? [[p.clube.id, p.clube.nome] as const] : []))).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const termo = normalizar(busca);
  const visiveis = lista.filter(p =>
    (perfil === "todos" || p.perfil === perfil)
    && (status === "todos" || p.statusVerificacao === status)
    && (conta === "todas" || p.ativo === (conta === "ativas"))
    && (clube === TODOS_CLUBES || (clube === SEM_CLUBE ? p.clube === null : p.clube?.id === clube))
    && (!termo || normalizar(p.nomeCompleto).includes(termo)));
  const filtrando = Boolean(termo) || perfil !== "todos" || status !== "todos" || conta !== "todas" || clube !== TODOS_CLUBES;

  return (
    <>
      <div className={pagina.topo}>
        <div>
          <h1 className={pagina.titulo}>Pessoas</h1>
          <p className={pagina.texto}>Atletas e técnicos com cadastro. Abra uma pessoa para ver conta, carteirinha, foto, vínculos e histórico.</p>
        </div>
        <button type="button" className={controles.secundario} onClick={atualizar} disabled={pessoas === null && !erroCarga}>
          Atualizar lista
        </button>
      </div>

      <div className={pagina.controles}>
        <div className={pagina.campos}>
          <div className={controles.campo}>
            <label className={controles.rotulo} htmlFor="busca-pessoas">Buscar por nome</label>
            <input id="busca-pessoas" className={controles.entrada} type="search" value={busca} onChange={e => setBusca(e.target.value)} autoComplete="off" />
          </div>
          <div className={controles.campo}>
            <label className={controles.rotulo} htmlFor="filtro-clube">Clube</label>
            <select id="filtro-clube" className={controles.entrada} value={clube} onChange={e => setClube(e.target.value)}>
              <option value={TODOS_CLUBES}>Todos os clubes</option>
              <option value={SEM_CLUBE}>Sem clube</option>
              {clubes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
          </div>
        </div>
        <div className={pagina.filtros}>
          <div className={controles.grupo} role="group" aria-label="Perfil">
            {OPCOES_PERFIL.map(o => (
              <button key={o.valor} type="button" className={controles.opcao} aria-pressed={perfil === o.valor} onClick={() => setPerfil(o.valor)}>{o.rotulo}</button>
            ))}
          </div>
          <div className={controles.grupo} role="group" aria-label="Verificação">
            {OPCOES_STATUS.map(o => (
              <button key={o.valor} type="button" className={controles.opcao} aria-pressed={status === o.valor} onClick={() => setStatus(o.valor)}>{o.rotulo}</button>
            ))}
          </div>
          <div className={controles.grupo} role="group" aria-label="Conta">
            {OPCOES_CONTA.map(o => (
              <button key={o.valor} type="button" className={controles.opcao} aria-pressed={conta === o.valor} onClick={() => setConta(o.valor)}>
                {o.valor === "todas" ? "Contas: todas" : o.rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {erroCarga ? (
        <div className={`${pagina.vazio} ${pagina.bloco}`}>
          <p className={controles.erro} role="alert">{erroCarga}</p>
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={atualizar}>Tentar novamente</button>
        </div>
      ) : pessoas === null ? (
        <p className={`${pagina.carregando} ${pagina.bloco}`} role="status">Carregando pessoas…</p>
      ) : (
        <>
          <h2 className={`${pagina.resultado} ${pagina.bloco}`} aria-live="polite">{contar(visiveis.length, "pessoa", "pessoas")}</h2>
          {visiveis.length === 0 ? (
            <div className={pagina.vazio}>
              {pessoas.length === 0 ? (
                <p className={pagina.vazioTexto}>Nenhum atleta ou técnico se cadastrou até agora.</p>
              ) : (
                <>
                  <p className={pagina.vazioTexto}>Nenhuma pessoa corresponde à busca e aos filtros escolhidos.</p>
                  {filtrando && <button type="button" className={controles.secundario} onClick={limparFiltros}>Limpar busca e filtros</button>}
                </>
              )}
            </div>
          ) : (
            <ul className={pagina.lista}>
              {visiveis.map(p => (
                <li key={p.usuarioId}>
                  <Link href={`/presidente/pessoas/${p.usuarioId}`} className={pagina.linha}>
                    <span className={pagina.linhaNome}>{p.nomeCompleto}</span>
                    <span className={pagina.linhaMeta}>
                      {NOME_PERFIL[p.perfil]}, {p.clube?.nome ?? "sem clube"}
                      {!p.ativo && <strong className={controles.textoAlerta}>, conta desativada</strong>}
                    </span>
                    <span className={pagina.linhaData}>
                      {p.verificadoEm ? <>Decidido em <time dateTime={p.verificadoEm}>{data(p.verificadoEm)}</time></>
                        : p.verificacaoSolicitadaEm ? <>Solicitado em <time dateTime={p.verificacaoSolicitadaEm}>{data(p.verificacaoSolicitadaEm)}</time></>
                          : "Sem solicitação registrada"}
                    </span>
                    <span className={`${controles.status} ${pagina.linhaStatus} ${CLASSE_STATUS[p.statusVerificacao]}`}>{NOME_STATUS[p.statusVerificacao]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
