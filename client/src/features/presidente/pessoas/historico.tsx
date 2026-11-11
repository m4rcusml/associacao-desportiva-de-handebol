"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import type { HistoricoAtleta, IrregularidadeParticipacao, JogoHistoricoAtleta, Metricas, ResultadoJogo, StatusJogo } from "../../../lib/presidente";
import { contar, dia } from "../../ui/formatos";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import styles from "./pessoa.module.css";

const NOME_STATUS_JOGO: Record<StatusJogo, string> = { agendado: "Agendado", em_andamento: "Em andamento", finalizado: "Finalizado", cancelado: "Cancelado" };
const NOME_RESULTADO: Partial<Record<ResultadoJogo, string>> = { interrompido: "interrompido", abandono: "abandono", wo: "W.O." };
const NOME_IRREGULARIDADE: Record<IrregularidadeParticipacao, string> = {
  conta_desativada: "conta desativada",
  carteirinha_invalidada: "carteirinha invalidada",
  suspensao: "suspensão",
};

function descreverMetricas(m: Metricas) {
  const partes = [
    m.gols ? contar(m.gols, "gol", "gols") : "",
    m.cartoesAmarelos ? contar(m.cartoesAmarelos, "cartão amarelo", "cartões amarelos") : "",
    m.exclusoesDoisMinutos ? contar(m.exclusoesDoisMinutos, "exclusão de 2 minutos", "exclusões de 2 minutos") : "",
    m.cartoesVermelhos ? contar(m.cartoesVermelhos, "cartão vermelho", "cartões vermelhos") : "",
  ].filter(Boolean);
  return partes.length ? partes.join(", ") : "Sem gols ou punições";
}

/** A API devolve `entrouEmQuadra: false` depois da anulação; por isso `entradaAnulada` é testada primeiro. */
export function etapaQuadra(j: Pick<JogoHistoricoAtleta, "entrouEmQuadra" | "entradaAnulada">) {
  if (j.entradaAnulada) return "entrada em quadra anulada";
  return j.entrouEmQuadra ? "entrou em quadra" : "";
}

function etapas(j: JogoHistoricoAtleta) {
  const lista = [j.escalado ? "escalado" : "", j.credenciado ? "credenciado" : "", etapaQuadra(j)];
  if (j.registroAdministrativo) lista.push("registro administrativo");
  return lista.filter(Boolean).join(", ") || "sem participação registrada";
}

/** Histórico esportivo do atleta: totais aprovados (participações e métricas) e cada jogo, com o clube da época. */
export function Historico({ atletaId, revisao }: { atletaId: string; revisao: number }) {
  const tratarErro = useErroApi();
  const [historico, setHistorico] = useState<HistoricoAtleta | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(() => {
    api<HistoricoAtleta>(`/atletas/${atletaId}/historico`)
      .then(h => { setHistorico(h); setErro(""); })
      .catch(falha => setErro(tratarErro(falha)));
  }, [atletaId, tratarErro]);

  useEffect(carregar, [carregar, revisao]);

  return (
    <section className={pagina.secao} aria-labelledby="secao-historico">
      <h2 id="secao-historico" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Histórico esportivo</h2>
      {erro ? (
        <>
          <p className={controles.erro} role="alert">{erro}</p>
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={() => { setErro(""); setHistorico(null); carregar(); }}>Tentar novamente</button>
        </>
      ) : !historico ? (
        <p className={pagina.carregando} role="status">Carregando histórico…</p>
      ) : (
        <>
          <dl className={pagina.metricas}>
            <div><dt>Escalações</dt><dd>{historico.totais.participacoes.escaladas}</dd></div>
            <div><dt>Credenciamentos</dt><dd>{historico.totais.participacoes.credenciadas}</dd></div>
            <div><dt>Entradas em quadra</dt><dd>{historico.totais.participacoes.comEntradaEmQuadra}</dd></div>
            <div><dt>Gols</dt><dd>{historico.totais.gols}</dd></div>
            <div><dt>Cartões amarelos</dt><dd>{historico.totais.cartoesAmarelos}</dd></div>
            <div><dt>Exclusões de 2 min</dt><dd>{historico.totais.exclusoesDoisMinutos}</dd></div>
            <div><dt>Cartões vermelhos</dt><dd>{historico.totais.cartoesVermelhos}</dd></div>
          </dl>
          <p className={pagina.secaoTexto}>Os totais somam os jogos com credenciamento, inclusive invalidados, sem lançamentos anulados.</p>

          <h3 className={pagina.subtitulo}>{contar(historico.jogos.length, "jogo", "jogos")}</h3>
          {historico.jogos.length === 0 ? (
            <p className={pagina.secaoTexto}>O atleta ainda não foi escalado nem credenciado em jogos.</p>
          ) : (
            <ol className={styles.jogos}>
              {historico.jogos.map(j => {
                const quando = j.jogo.iniciadoEm ?? j.jogo.inicioPrevistoEm;
                return (
                <li key={j.participacaoId} className={styles.jogo}>
                  <div className={styles.jogoTopo}>
                    <span className={styles.eventoNome}>{j.clube.clube.nome} × {j.adversario.clube.nome}</span>
                    <span className={styles.placar} aria-label={j.placar ? `Placar ${j.placar.clube} a ${j.placar.adversario}` : "Sem placar"}>
                      {j.placar ? `${j.placar.clube} × ${j.placar.adversario}` : "–"}
                    </span>
                  </div>
                  <span className={styles.eventoMeta}>
                    {j.jogo.campeonato.nome} {j.jogo.campeonato.edicao}, {j.jogo.campeonato.categoria}.{" "}
                    {NOME_STATUS_JOGO[j.jogo.status]}
                    {j.jogo.resultado && NOME_RESULTADO[j.jogo.resultado] ? ` (${NOME_RESULTADO[j.jogo.resultado]})` : ""}
                    {quando ? <>, <time dateTime={quando}>{dia(quando, j.jogo.fusoHorario)}</time></> : ""}
                    {j.numeroCamisa !== null ? `, camisa ${j.numeroCamisa}` : ""}.
                  </span>
                  <span className={styles.eventoMeta}>
                    {etapas(j).replace(/^./, c => c.toUpperCase())}. {j.metricas ? descreverMetricas(j.metricas) : "Sem métricas: não credenciado"}.
                  </span>
                  {(j.jogo.invalidadoEm || j.irregularidades.length > 0) && (
                    <span className={`${styles.eventoMeta} ${controles.textoAlerta}`}>
                      {[j.jogo.invalidadoEm ? "Jogo invalidado" : "", j.irregularidades.length ? `Irregularidade: ${j.irregularidades.map(i => NOME_IRREGULARIDADE[i]).join(", ")}` : ""].filter(Boolean).join(". ")}.
                    </span>
                  )}
                </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
