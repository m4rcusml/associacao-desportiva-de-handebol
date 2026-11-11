"use client";

import { useRef, useState } from "react";
import pagina from "../../ui/pagina.module.css";
import controles from "../../ui/controles.module.css";
import { Iniciais } from "../../ui/identificacao";
import { useErroApi } from "../../ui/use-erro-api";
import { AtalhoPresidente } from "../visual";
import visual from "../visual.module.css";
import { useSessaoPresidente } from "../shell";
import { GestaoPresidentes } from "./gestao-presidentes";
import { Identificacao } from "./identificacao";
import { NovoPresidente } from "./novo-presidente";
import { gravarReferencias, lerReferencias, type ReferenciaPresidente } from "./referencias-locais";

/** Própria conta do presidente e gestão de outros presidentes. Só renderiza no navegador, após a sessão. */
export function Conta() {
  const { sessao, sair } = useSessaoPresidente();
  const tratarErro = useErroApi();
  const presidenteId = sessao.usuario.id;
  // Esta área só monta depois de a sessão ser consultada no navegador, então o armazenamento local já existe.
  const [referencias, setReferencias] = useState<ReferenciaPresidente[]>(() => lerReferencias(presidenteId));
  const [guardadas, setGuardadas] = useState(true);
  const [area, setArea] = useState<"nome" | "novo" | "gestao" | null>(null);
  const [erroSaida, setErroSaida] = useState("");
  const [saindo, setSaindo] = useState(false);
  const saidaEmCurso = useRef(false);

  async function sairDaConta() {
    if (saidaEmCurso.current) return;
    saidaEmCurso.current = true;
    setSaindo(true);
    setErroSaida("");
    try { await sair(); }
    catch (erro) { setErroSaida(tratarErro(erro)); setSaindo(false); saidaEmCurso.current = false; }
  }

  function atualizar(proximas: ReferenciaPresidente[]) {
    setReferencias(proximas);
    const ok = gravarReferencias(presidenteId, proximas);
    setGuardadas(ok);
    return ok;
  }

  function aoCriar(nova: ReferenciaPresidente) {
    const id = nova.id.toLowerCase();
    return atualizar([{ id, nomeCompleto: nova.nomeCompleto }, ...referencias.filter(r => r.id !== id)]);
  }

  return (
    <>
      <div className={pagina.topo}>
        <div>
          <h1 className={pagina.titulo}>Sua conta</h1>
          <p className={pagina.texto}>Acesso e administração da associação.</p>
        </div>
      </div>
      <div className={`${visual.conta} ${visual.identificacao}`}><Iniciais nome={sessao.usuario.nomeCompleto} grande /><div><h2>{sessao.usuario.nomeCompleto}</h2><p className={visual.meta}>Presidente · conta atual</p></div></div>
      {!area && <>
        <div className={`${visual.atalhos} ${visual.atalhosConta}`}>
          <AtalhoPresidente titulo="Editar seu nome" detalhe="Sua identificação na associação" icone="editar" aoAbrir={() => setArea("nome")} />
          <AtalhoPresidente titulo="Criar outro presidente" detalhe="Nome, e-mail e senha inicial" icone="pessoas" aoAbrir={() => setArea("novo")} />
          <AtalhoPresidente titulo="Gerir outros presidentes" detalhe="Referências salvas neste navegador" icone="pessoa" aoAbrir={() => setArea("gestao")} />
        </div>
        <p className={visual.aviso}>A lista de referências não confirma se uma conta está ativa.</p>
        {erroSaida && <p className={controles.erro} role="alert">{erroSaida}</p>}
        <button type="button" className={controles.secundario} onClick={() => void sairDaConta()} disabled={saindo}>{saindo ? "Saindo…" : "Sair da conta"}</button>
      </>}
      {area && <div className={`${visual.contexto} ${visual.conteudo}`}>
        <button type="button" className={controles.secundario} onClick={() => setArea(null)}>Voltar à conta</button>
        {area === "nome" && <Identificacao />}
        {area === "novo" && <NovoPresidente aoCriar={aoCriar} />}
        {area === "gestao" && <GestaoPresidentes referencias={referencias} guardadas={guardadas} aoEsquecer={id => atualizar(referencias.filter(r => r.id !== id))} />}
      </div>}
    </>
  );
}
