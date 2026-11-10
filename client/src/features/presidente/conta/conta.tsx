"use client";

import { useState } from "react";
import pagina from "../../ui/pagina.module.css";
import { useSessaoPresidente } from "../shell";
import { GestaoPresidentes } from "./gestao-presidentes";
import { Identificacao } from "./identificacao";
import { NovoPresidente } from "./novo-presidente";
import { gravarReferencias, lerReferencias, type ReferenciaPresidente } from "./referencias-locais";

/** Própria conta do presidente e gestão de outros presidentes. Só renderiza no navegador, após a sessão. */
export function Conta() {
  const { sessao } = useSessaoPresidente();
  const presidenteId = sessao.usuario.id;
  // Esta área só monta depois de a sessão ser consultada no navegador, então o armazenamento local já existe.
  const [referencias, setReferencias] = useState<ReferenciaPresidente[]>(() => lerReferencias(presidenteId));
  const [guardadas, setGuardadas] = useState(true);

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
          <h1 className={pagina.titulo}>Conta</h1>
          <p className={pagina.texto}>Seu nome, sua sessão e as contas de outros presidentes.</p>
        </div>
      </div>
      <div className={`${pagina.secoes} ${pagina.bloco}`}>
        <Identificacao />
        <NovoPresidente aoCriar={aoCriar} />
        <GestaoPresidentes referencias={referencias} guardadas={guardadas} aoEsquecer={id => atualizar(referencias.filter(r => r.id !== id))} />
      </div>
    </>
  );
}
