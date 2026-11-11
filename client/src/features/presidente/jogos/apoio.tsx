"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import type { DetalheJogo, TipoLancamento } from "../../../lib/presidente";
import { Dialogo } from "../../ui/dialogo";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import styles from "./jogo.module.css";

export const TIPOS_LANCAMENTO: Record<TipoLancamento, string> = {
  gol: "Gol", cartaoAmarelo: "Cartão amarelo", exclusaoDoisMinutos: "Exclusão de dois minutos", cartaoVermelho: "Cartão vermelho",
};
export const RESULTADOS = { normal: "Normal", interrompido: "Interrompido definitivamente", abandono: "Abandono", wo: "W.O." } as const;
export const STATUS_JOGO = { agendado: "Agendado", em_andamento: "Em andamento", finalizado: "Finalizado", cancelado: "Cancelado" } as const;

export function data(iso: string | null, fuso = "America/Sao_Paulo") {
  return iso ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: fuso }).format(new Date(iso)) : "Sem registro";
}

export function nomeClube(jogo: DetalheJogo, inscricaoId: string | null) {
  return inscricaoId === jogo.clubeA.inscricaoId ? jogo.clubeA.clube.nome : inscricaoId === jogo.clubeB.inscricaoId ? jogo.clubeB.clube.nome : "Nenhum clube";
}

export type AoAlterar = (mensagem?: string) => Promise<void>;

export function useOperacaoJogo(atualizar: AoAlterar) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [conflito, setConflito] = useState<unknown>(null);
  const [incerta, setIncerta] = useState(false);
  const enviando = useRef(false);
  const tentativa = useRef<{ path: string; body: unknown; mensagem: string; metodo: "POST" | "DELETE" } | null>(null);

  async function executar(path: string, body: unknown, mensagem: string, metodo: "POST" | "DELETE" = "POST") {
    if (enviando.current) return false;
    enviando.current = true;
    setOcupado(true);
    setErro("");
    setConflito(null);
    const pedido = tentativa.current ?? { path, body, mensagem, metodo };
    try {
      await api(pedido.path, pedido.body, pedido.metodo);
      tentativa.current = null;
      setIncerta(false);
      try { await atualizar(pedido.mensagem); }
      catch { setErro("A alteração foi registrada. Não foi possível atualizar a consulta; atualize o jogo sem repetir a operação."); }
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) router.replace("/login");
      const ehConflito = error instanceof ApiError && error.status === 409;
      const temOperacaoId = pedido.body !== null && typeof pedido.body === "object" && "operacaoId" in pedido.body;
      const respostaIncerta = temOperacaoId && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500 || (error.status >= 200 && error.status < 400));
      tentativa.current = respostaIncerta ? pedido : null;
      setIncerta(respostaIncerta);
      setErro(`${error instanceof Error ? error.message : "Não foi possível concluir a operação."}${respostaIncerta ? " A resposta é incerta. Reenvie a mesma operação; o identificador e o conteúdo foram preservados." : ehConflito ? " Os dados foram consultados novamente. Confira o estado atual antes de decidir." : ""}`);
      if (ehConflito) {
        setConflito(error.data ?? true);
        await atualizar().catch(() => undefined);
      }
      return false;
    } finally {
      enviando.current = false;
      setOcupado(false);
    }
  }

  return { executar, ocupado, erro, conflito, incerta, limparErro: () => { if (!tentativa.current) { setErro(""); setConflito(null); } } };
}

export function ModalJogo({ aberto, fechar, titulo, children, focoAlternativo, ocupado = false }: {
  aberto: boolean; fechar: () => void; titulo: string; children: ReactNode; focoAlternativo: RefObject<HTMLElement | null>; ocupado?: boolean;
}) {
  const botaoFechar = useRef<HTMLButtonElement>(null);
  return <Dialogo aberto={aberto} aoFechar={fechar} tituloId="jogo-acao-titulo" focoInicial={botaoFechar} focoAlternativo={focoAlternativo} bloqueado={ocupado}>
    <div className={pagina.detalhe}>
      <div className={pagina.detalheTopo}>
        <h2 id="jogo-acao-titulo" className={pagina.detalheNome}>{titulo}</h2>
        <button ref={botaoFechar} type="button" className={controles.secundario} onClick={fechar} disabled={ocupado}>Fechar</button>
      </div>
      {children}
    </div>
  </Dialogo>;
}

export function MetricasAtleta({ gols, cartoesAmarelos, exclusoesDoisMinutos, cartoesVermelhos }: {
  gols: number; cartoesAmarelos: number; exclusoesDoisMinutos: number; cartoesVermelhos: number;
}) {
  return <span className={styles.metricas}>{gols} gols · {cartoesAmarelos} amarelos · {exclusoesDoisMinutos} exclusões de 2 min · {cartoesVermelhos} vermelhos</span>;
}
