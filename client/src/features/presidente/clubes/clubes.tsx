"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { consultarSolicitacoes, type Clube, type SolicitacaoVerificacao } from "../../../lib/presidente";
import { contar, normalizar } from "../../ui/formatos";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { CamposClube, lerCamposClube, type ValoresClube } from "./campos-clube";

type Dados = { clubes: Clube[]; pessoas: SolicitacaoVerificacao[] };
const VAZIO: ValoresClube = { nome: "", cidade: "" };

/** Clubes com técnico atual e tamanho do elenco aprovado; criação de clube. Não há exclusão de clubes. */
export function Clubes() {
  const router = useRouter();
  const tratarErro = useErroApi();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [valores, setValores] = useState<ValoresClube>(VAZIO);
  const [erroCriacao, setErroCriacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const botaoNovo = useRef<HTMLButtonElement>(null);
  const campoNome = useRef<HTMLInputElement>(null);

  const carregar = useCallback(() => {
    Promise.all([api<Clube[]>("/clubes/visao-geral"), consultarSolicitacoes()])
      .then(([clubes, pessoas]) => { setDados({ clubes, pessoas }); setErroCarga(""); })
      .catch(erro => setErroCarga(tratarErro(erro)));
  }, [tratarErro]);

  useEffect(carregar, [carregar]);

  function atualizar() {
    setDados(null);
    setErroCarga("");
    carregar();
  }

  function abrirCriacao() {
    setCriando(true);
    setErroCriacao("");
    // O campo só existe depois da renderização.
    requestAnimationFrame(() => campoNome.current?.focus());
  }

  function fecharCriacao() {
    setCriando(false);
    setValores(VAZIO);
    setErroCriacao("");
    requestAnimationFrame(() => botaoNovo.current?.focus());
  }

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    const lido = lerCamposClube(valores);
    if ("erro" in lido) { setErroCriacao(lido.erro); return; }
    setEnviando(true);
    setErroCriacao("");
    try {
      const clube = await api<Clube>("/clubes", { nome: lido.nome, ...(lido.cidade ? { cidade: lido.cidade } : {}) });
      router.push(`/presidente/clubes/${clube.id}?criado=1`);
    } catch (erro) {
      setErroCriacao(tratarErro(erro));
      setEnviando(false);
    }
  }

  const elenco = new Map<string, number>();
  for (const p of dados?.pessoas ?? []) {
    if (p.perfil === "atleta" && p.statusVerificacao === "aprovado" && p.clube) elenco.set(p.clube.id, (elenco.get(p.clube.id) ?? 0) + 1);
  }
  const termo = normalizar(busca);
  const visiveis = (dados?.clubes ?? []).filter(c => !termo
    || normalizar(c.nome).includes(termo) || normalizar(c.cidade ?? "").includes(termo) || normalizar(c.tecnico?.nomeCompleto ?? "").includes(termo));

  return (
    <>
      <div className={pagina.topo}>
        <div>
          <h1 className={pagina.titulo}>Clubes</h1>
          <p className={pagina.texto}>Abra um clube para editar nome e cidade, cuidar do técnico e ver o elenco.</p>
        </div>
        <div className={pagina.acoes}>
          {!criando && <button ref={botaoNovo} type="button" className={controles.primario} onClick={abrirCriacao}>Novo clube</button>}
          <button type="button" className={controles.secundario} onClick={atualizar} disabled={dados === null && !erroCarga}>Atualizar lista</button>
        </div>
      </div>

      {criando && (
        <section className={`${pagina.secao} ${pagina.erroDecisao}`} aria-labelledby="titulo-novo-clube">
          <h2 id="titulo-novo-clube" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Novo clube</h2>
          <form className={pagina.formulario} onSubmit={criar} noValidate>
            <CamposClube valores={valores} aoMudar={setValores} prefixo="novo-clube" desativado={enviando} refNome={campoNome} />
            {erroCriacao && <p className={controles.erro} role="alert">{erroCriacao}</p>}
            <div className={pagina.acoes}>
              <button type="submit" className={controles.primario} disabled={enviando}>{enviando ? "Criando…" : "Criar clube"}</button>
              <button type="button" className={controles.secundario} onClick={fecharCriacao} disabled={enviando}>Cancelar</button>
            </div>
          </form>
        </section>
      )}

      <div className={controles.campo}>
        <label className={controles.rotulo} htmlFor="busca-clubes">Buscar por clube, cidade ou técnico</label>
        <input id="busca-clubes" className={controles.entrada} type="search" value={busca} onChange={e => setBusca(e.target.value)} autoComplete="off" />
      </div>

      {erroCarga ? (
        <div className={`${pagina.vazio} ${pagina.bloco}`}>
          <p className={controles.erro} role="alert">{erroCarga}</p>
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={atualizar}>Tentar novamente</button>
        </div>
      ) : dados === null ? (
        <p className={`${pagina.carregando} ${pagina.bloco}`} role="status">Carregando clubes…</p>
      ) : (
        <>
          <h2 className={`${pagina.resultado} ${pagina.bloco}`} aria-live="polite">{contar(visiveis.length, "clube", "clubes")}</h2>
          {visiveis.length === 0 ? (
            <div className={pagina.vazio}>
              {dados.clubes.length === 0 ? (
                <p className={pagina.vazioTexto}>Nenhum clube cadastrado. Crie o primeiro com “Novo clube”.</p>
              ) : (
                <>
                  <p className={pagina.vazioTexto}>Nenhum clube corresponde à busca.</p>
                  <button type="button" className={controles.secundario} onClick={() => setBusca("")}>Limpar busca</button>
                </>
              )}
            </div>
          ) : (
            <ul className={pagina.lista}>
              {visiveis.map(c => {
                const atletas = elenco.get(c.id) ?? 0;
                return (
                  <li key={c.id}>
                    <Link href={`/presidente/clubes/${c.id}`} className={pagina.linha}>
                      <span className={pagina.linhaNome}>{c.nome}</span>
                      <span className={pagina.linhaMeta}>
                        {c.cidade ?? "Cidade não informada"}, {c.tecnico ? `técnico ${c.tecnico.nomeCompleto}` : "sem técnico"}
                        {c.tecnico && !c.tecnico.ativo && <strong className={controles.textoAlerta}> (conta desativada)</strong>}
                      </span>
                      <span className={pagina.linhaData}>{contar(atletas, "atleta aprovado", "atletas aprovados")}</span>
                      <span className={`${controles.status} ${pagina.linhaStatus} ${c.tecnico ? controles.statusAprovado : controles.statusPendente}`}>
                        {c.tecnico ? "Com técnico" : "Sem técnico"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
