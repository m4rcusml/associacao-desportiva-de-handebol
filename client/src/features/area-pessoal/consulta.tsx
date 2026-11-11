"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useAreaPessoal } from "./shell";
import controles from "../ui/controles.module.css";
import styles from "./pessoal.module.css";

/** Preserva leituras em falhas transitórias; retira dados negados/ausentes e ignora respostas antigas. */
export function useConsulta<T>(caminho: string | null) {
  const { tratarErro } = useAreaPessoal();
  const [estado, setEstado] = useState<{ caminho: string | null; dados: T | null; erro: string; carregando: boolean }>({ caminho, dados: null, erro: "", carregando: !!caminho });
  // Uma mudança de rota oculta imediatamente o resultado da consulta anterior.
  const atual = estado.caminho === caminho ? estado : { caminho, dados: null, erro: "", carregando: !!caminho };
  const versao = useRef(0);
  const consultar = useCallback(() => {
    if (!caminho) return Promise.resolve(false);
    const atual = ++versao.current;
    return api<T>(caminho).then(resposta => {
      if (atual === versao.current) setEstado({ caminho, dados: resposta, erro: "", carregando: false });
      return atual === versao.current;
    }).catch(falha => {
      if (atual === versao.current) {
        const limpar = falha instanceof ApiError && [401, 403, 404].includes(falha.status);
        const erro = tratarErro(falha);
        setEstado(anterior => ({ caminho, dados: !limpar && anterior.caminho === caminho ? anterior.dados : null, erro, carregando: false }));
      }
      return false;
    });
  }, [caminho, tratarErro]);
  const cancelar = useCallback(() => { versao.current++; }, []);
  const carregar = useCallback(() => {
    setEstado(anterior => ({ caminho, dados: anterior.caminho === caminho ? anterior.dados : null, erro: "", carregando: !!caminho }));
    return consultar();
  }, [caminho, consultar]);
  const setDados = useCallback((dados: T | null) => {
    versao.current++;
    setEstado({ caminho, dados, erro: "", carregando: false });
  }, [caminho]);
  useEffect(() => {
    void consultar();
    return cancelar;
  }, [consultar, cancelar]);
  return { dados: atual.dados, erro: atual.erro, carregando: atual.carregando, carregar, setDados };
}

export function EstadoConsulta({ erro, carregando, atualizar, rotulo = "Atualizar" }: { erro: string; carregando: boolean; atualizar: () => void; rotulo?: string }) {
  return <div className={styles.estado}>
    {erro && <p className={controles.erro} role="alert">{erro} Os dados anteriores, quando exibidos, podem estar desatualizados.</p>}
    <button type="button" className={controles.discreto} onClick={atualizar} disabled={carregando}>{carregando ? "Atualizando…" : rotulo}</button>
    <span className={controles.ajuda} role="status">{carregando ? "Consultando o servidor…" : ""}</span>
  </div>;
}
