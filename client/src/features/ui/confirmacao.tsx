"use client";

import { useId, useRef, type ReactNode, type RefObject } from "react";
import { Dialogo } from "./dialogo";
import controles from "./controles.module.css";
import pagina from "./pagina.module.css";

type Props = {
  aberto: boolean;
  /** Pergunta curta, usada como título do diálogo. */
  titulo: string;
  /** Consequências da ação, em texto ou elementos. */
  children?: ReactNode;
  /** Rótulo do botão que confirma, com o verbo da ação ("Desativar conta"). */
  rotulo: string;
  /** `perigo` para ações que retiram acesso ou invalidam; `aprovar` para concessões; padrão `primario`. */
  tom?: "perigo" | "aprovar" | "primario";
  enviando?: boolean;
  /** Erro da última tentativa, exibido dentro do diálogo. */
  erro?: string;
  aoConfirmar: () => void;
  aoFechar: () => void;
  /** Destino do foco ao fechar quando o botão que abriu a confirmação saiu da página. */
  focoAlternativo?: RefObject<HTMLElement | null>;
};

const CLASSE_TOM = { perigo: controles.rejeitar, aprovar: controles.aprovar, primario: controles.primario } as const;

/**
 * Confirmação modal de uma ação. O foco começa em "Voltar" (escolha segura) e volta a quem abriu o diálogo
 * ao fechar. Enquanto envia, "Voltar" e Escape ficam
 * indisponíveis (`bloqueado`), para o resultado ou o erro não ficarem escondidos; o chamador fecha após sucesso.
 */
export function Confirmacao({ aberto, titulo, children, rotulo, tom = "primario", enviando = false, erro, aoConfirmar, aoFechar, focoAlternativo }: Props) {
  const tituloId = useId();
  const voltar = useRef<HTMLButtonElement>(null);

  return (
    <Dialogo aberto={aberto} aoFechar={aoFechar} tituloId={tituloId} focoInicial={voltar} focoAlternativo={focoAlternativo} bloqueado={enviando}>
      <div className={pagina.detalhe}>
        <h2 id={tituloId} className={pagina.detalheNome}>{titulo}</h2>
        {children && <div className={`${pagina.confirmacao} ${pagina.erroDecisao}`}>{children}</div>}
        {erro && <p className={`${controles.erro} ${pagina.erroDecisao}`} role="alert">{erro}</p>}
        <div className={`${pagina.acoes} ${pagina.acoesFinais}`}>
          <button type="button" className={CLASSE_TOM[tom]} onClick={aoConfirmar} disabled={enviando}>
            {enviando ? "Enviando…" : rotulo}
          </button>
          <button ref={voltar} type="button" className={controles.secundario} onClick={aoFechar} disabled={enviando}>Voltar</button>
        </div>
      </div>
    </Dialogo>
  );
}
