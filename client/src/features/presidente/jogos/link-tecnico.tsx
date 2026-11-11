"use client";

import { useEffect, useRef, useState } from "react";
import controles from "../../ui/controles.module.css";
import styles from "./jogo.module.css";

export function LinkTecnico({ jogoId }: { jogoId: string }) {
  return <LinkCompartilhavel jogoId={jogoId} area="tecnico" />;
}

export function LinkArbitragem({ jogoId }: { jogoId: string }) {
  return <LinkCompartilhavel jogoId={jogoId} area="arbitragem" />;
}

function LinkCompartilhavel({ jogoId, area }: { jogoId: string; area: "tecnico" | "arbitragem" }) {
  const [link, setLink] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [manual, setManual] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (manual) { campo.current?.focus(); campo.current?.select(); }
  }, [manual]);

  async function copiar() {
    const endereco = `${window.location.origin}/${area}/jogos/${jogoId}`;
    setLink(endereco);
    setCopiado(false);
    setManual(false);
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
    } catch { setManual(true); }
  }

  return <section className={styles.compartilhar} aria-label={area === "tecnico" ? "Acesso do técnico ao jogo" : "Link de acesso à arbitragem"}>
    <button type="button" className={controles.secundario} onClick={() => void copiar()}>{area === "tecnico" ? "Copiar link para o técnico" : "Copiar link para a arbitragem"}</button>
    <p className={styles.meta}>{area === "tecnico" ? "O link abre para o técnico atual de um dos clubes, após entrar na conta. Ele não concede acesso por si só." : "Compartilhe este link com a arbitragem. A entrada exige conta designada ou nome e senha do jogo; o link não contém a senha."}</p>
    {link && <div className={controles.campo}><label className={controles.rotulo} htmlFor={`link-${area}`}>Link do jogo para compartilhar</label>
      <input ref={campo} id={`link-${area}`} className={controles.entrada} type="text" value={link} readOnly onFocus={event => event.currentTarget.select()} />
      <p className={controles.ajuda} role="status">{copiado ? "Link copiado." : manual ? "Selecione e copie o link acima." : "Preparando o link…"}</p>
    </div>}
  </section>;
}
