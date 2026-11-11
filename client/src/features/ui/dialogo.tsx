"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type SyntheticEvent, type RefObject } from "react";
import styles from "./dialogo.module.css";

type Props = {
  aberto: boolean;
  /** Chamado em todo fechamento (botão, Escape ou `aberto` passando a false). */
  aoFechar: () => void;
  /** id do título do conteúdo, para `aria-labelledby`. */
  tituloId: string;
  /** Elemento que recebe o foco ao abrir, já com o conteúdo montado. */
  focoInicial?: RefObject<HTMLElement | null>;
  /** Destino do foco ao fechar quando o elemento que abriu o diálogo saiu da página. */
  focoAlternativo?: RefObject<HTMLElement | null>;
  /** Enquanto true (ex.: envio em andamento), Escape e o cancelamento nativo não fecham o diálogo. O pai ainda fecha via `aberto`. */
  bloqueado?: boolean;
  children: ReactNode;
};

/**
 * Diálogo modal nativo: folha inferior no celular e janela central em telas largas. Abre depois de o
 * conteúdo montar, trata Escape explicitamente e devolve o foco a quem abriu (ou ao destino alternativo).
 */
export function Dialogo({ aberto, aoFechar, tituloId, focoInicial, focoAlternativo, bloqueado = false, children }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const origem = useRef<HTMLElement | null>(null);
  // Mantém a versão mais recente do callback sem reexecutar o efeito de abertura.
  const aoFecharAtual = useRef(aoFechar);
  useEffect(() => { aoFecharAtual.current = aoFechar; });

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (aberto && !elemento.open) {
      origem.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      elemento.showModal();
      focoInicial?.current?.focus();
    } else if (!aberto && elemento.open) {
      elemento.close();
    }
  }, [aberto, focoInicial]);

  function aoFecharNativo() {
    const destino = origem.current;
    origem.current = null;
    if (destino?.isConnected) destino.focus();
    else focoAlternativo?.current?.focus();
    aoFecharAtual.current();
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDialogElement>) {
    if (evento.key !== "Escape") return;
    evento.preventDefault();
    if (!bloqueado) dialogo.current?.close();
  }

  // Cancelamento nativo (Escape ou gesto de voltar do sistema) passa pelo mesmo bloqueio.
  function aoCancelar(evento: SyntheticEvent<HTMLDialogElement>) {
    evento.preventDefault();
    if (!bloqueado) dialogo.current?.close();
  }

  return (
    <dialog ref={dialogo} className={styles.dialogo} aria-labelledby={tituloId} onClose={aoFecharNativo} onCancel={aoCancelar} onKeyDown={aoTeclar}>
      {aberto && children}
    </dialog>
  );
}
