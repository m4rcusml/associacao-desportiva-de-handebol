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
import { EmblemaClube } from "../visual";
import visual from "../visual.module.css";

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
  const consulta = useRef(0);
  const envio = useRef(false);

  const carregar = useCallback(() => {
    const versao = ++consulta.current;
    Promise.all([api<Clube[]>("/clubes/visao-geral"), consultarSolicitacoes()])
      .then(([clubes, pessoas]) => { if (versao === consulta.current) { setDados({ clubes, pessoas }); setErroCarga(""); } })
      .catch(erro => { if (versao === consulta.current) setErroCarga(tratarErro(erro)); });
  }, [tratarErro]);

  const invalidarConsulta = useCallback(() => { consulta.current++; }, []);
  useEffect(() => { carregar(); return invalidarConsulta; }, [carregar, invalidarConsulta]);

  function atualizar() {
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
    if (envio.current) return;
    const lido = lerCamposClube(valores);
    if ("erro" in lido) { setErroCriacao(lido.erro); return; }
    envio.current = true;
    setEnviando(true);
    setErroCriacao("");
    try {
      const clube = await api<Clube>("/clubes", { nome: lido.nome, ...(lido.cidade ? { cidade: lido.cidade } : {}) });
      router.push(`/presidente/clubes/${clube.id}?criado=1`);
    } catch (erro) {
      setErroCriacao(tratarErro(erro));
      setEnviando(false);
      envio.current = false;
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
          <p className={pagina.texto}>Elencos e técnicos responsáveis.</p>
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

      {erroCarga && dados !== null && <p className={controles.erro} role="alert">{erroCarga} A lista anterior foi mantida.</p>}
      {erroCarga && dados === null ? (
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
            <ul className={visual.lista}>
              {visiveis.map(c => {
                const atletas = elenco.get(c.id) ?? 0;
                return (
                  <li key={c.id}>
                    <Link href={`/presidente/clubes/${c.id}`} className={visual.linha}>
                      <EmblemaClube nome={c.nome} />
                      <span><span className={visual.nome}>{c.nome}</span>
                      <span className={visual.meta}>
                        {c.cidade ?? "Cidade não informada"}, {c.tecnico ? `técnico ${c.tecnico.nomeCompleto}` : "sem técnico"}
                        {c.tecnico && !c.tecnico.ativo && <strong className={controles.textoAlerta}> (conta desativada)</strong>}
                      </span>
                      <span className={visual.meta}>{contar(atletas, "atleta aprovado", "atletas aprovados")}</span></span><span className={visual.abrir}>{c.tecnico ? "Abrir clube" : "Atribuir técnico"}</span>
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
