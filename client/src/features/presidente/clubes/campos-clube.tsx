"use client";

import type { RefObject } from "react";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";

export type ValoresClube = { nome: string; cidade: string };

/** Mesmos limites do backend (`clubes.ts`): nome de 2 a 120 caracteres; cidade opcional, de 2 a 120. */
export function lerCamposClube(valores: ValoresClube): { nome: string; cidade: string | null } | { erro: string } {
  const nome = valores.nome.trim();
  const cidade = valores.cidade.trim();
  if (nome.length < 2 || nome.length > 120) return { erro: "Informe o nome do clube, com 2 a 120 caracteres." };
  if (cidade && (cidade.length < 2 || cidade.length > 120)) return { erro: "A cidade deve ter de 2 a 120 caracteres, ou fique em branco." };
  return { nome, cidade: cidade || null };
}

type Props = {
  valores: ValoresClube;
  aoMudar: (valores: ValoresClube) => void;
  prefixo: string;
  desativado: boolean;
  refNome?: RefObject<HTMLInputElement | null>;
};

export function CamposClube({ valores, aoMudar, prefixo, desativado, refNome }: Props) {
  return (
    <div className={pagina.camposLinha}>
      <div className={controles.campo}>
        <label className={controles.rotulo} htmlFor={`${prefixo}-nome`}>Nome do clube</label>
        <input
          ref={refNome}
          id={`${prefixo}-nome`}
          className={controles.entrada}
          value={valores.nome}
          onChange={e => aoMudar({ ...valores, nome: e.target.value })}
          maxLength={120}
          autoComplete="off"
          required
          disabled={desativado}
        />
      </div>
      <div className={controles.campo}>
        <label className={controles.rotulo} htmlFor={`${prefixo}-cidade`}>Cidade (opcional)</label>
        <input
          id={`${prefixo}-cidade`}
          className={controles.entrada}
          value={valores.cidade}
          onChange={e => aoMudar({ ...valores, cidade: e.target.value })}
          maxLength={120}
          autoComplete="address-level2"
          disabled={desativado}
        />
      </div>
    </div>
  );
}
