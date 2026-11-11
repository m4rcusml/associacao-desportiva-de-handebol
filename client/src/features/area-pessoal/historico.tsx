"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { HistoricoAtleta, Metricas, SituacaoParticipacao, StatusJogo, ResultadoJogo } from "../../lib/presidente";
import { horarioJogo, uuidValido } from "../../lib/area-pessoal";
import { contar, dia } from "../ui/formatos";
import { Dialogo } from "../ui/dialogo";
import { useAreaPessoal } from "./shell";
import { EstadoConsulta, useConsulta } from "./consulta";
import { FotoPrivada } from "./foto";
import { SituacaoCadastro } from "./cadastro";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./pessoal.module.css";

export const STATUS_JOGO: Record<StatusJogo, string> = { agendado: "Agendado", em_andamento: "Em andamento", finalizado: "Finalizado", cancelado: "Cancelado" };
export const RESULTADO: Record<ResultadoJogo, string> = { normal: "Normal", interrompido: "Interrompido", abandono: "Abandono", wo: "W.O." };
const IRREGULARIDADES = { conta_desativada: "conta desativada", carteirinha_invalidada: "carteirinha invalidada", suspensao: "suspensão" };

export function EtapasParticipacao({ participacao: p }: { participacao: SituacaoParticipacao }) {
  return <div className={styles.pilha}>
    <div className={styles.etapas}>
      <span>{p.escalado ? "Escalado" : "Não escalado"}</span>
      <span>{p.credenciado ? `Credenciado${p.numeroCamisa !== null ? `, camisa ${p.numeroCamisa}` : ""}` : "Não credenciado"}</span>
      <span>{p.entradaAnulada ? "Entrada em quadra anulada" : p.entrouEmQuadra ? "Entrou em quadra" : "Sem entrada em quadra"}</span>
    </div>
    {p.registroAdministrativo && <p className={controles.nota}>Participação registrada administrativamente após o jogo.{p.irregularidades.length ? ` Impedimentos registrados: ${p.irregularidades.map(i => IRREGULARIDADES[i]).join(", ")}.` : ""}</p>}
  </div>;
}

export function MetricasParticipacao({ metricas }: { metricas: Metricas | null }) {
  if (!metricas) return <p className={controles.ajuda}>Métricas indisponíveis: participação sem credenciamento.</p>;
  return <dl className={styles.sumula}>
    <div><dt>Gols</dt><dd>{metricas.gols}</dd></div>
    <div><dt>Amarelos</dt><dd>{metricas.cartoesAmarelos}</dd></div>
    <div><dt>Exclusões de 2 min</dt><dd>{metricas.exclusoesDoisMinutos}</dd></div>
    <div><dt>Vermelhos</dt><dd>{metricas.cartoesVermelhos}</dd></div>
  </dl>;
}

export function HistoricoPessoal({ atletaId, ficha = false }: { atletaId: string; ficha?: boolean }) {
  const { sessao } = useAreaPessoal();
  const podeConsultar = sessao.usuario.aprovado && (sessao.usuario.perfil === "atleta" || !!sessao.usuario.clubeId);
  const consulta = useConsulta<HistoricoAtleta>(podeConsultar && uuidValido(atletaId) ? `/atletas/${atletaId}/historico` : null);
  const [mostrarFoto, setMostrarFoto] = useState(false);
  const [status, setStatus] = useState<StatusJogo | "todos">("todos");
  const [etapa, setEtapa] = useState("todas");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const tituloDialogo = useId();
  if (!podeConsultar) return <SituacaoCadastro />;
  if (!uuidValido(atletaId)) return <p className={controles.erro} role="alert">Identificador de atleta inválido. Informe um UUID válido.</p>;
  const historico = consulta.dados;
  const aberta = historico?.jogos.find(p => p.participacaoId === abertaId);
  const visiveis = historico?.jogos.filter(p => (status === "todos" || p.jogo.status === status)
    && (etapa === "todas" || (etapa === "escalado" && p.escalado) || (etapa === "credenciado" && p.credenciado) || (etapa === "entrou" && p.entrouEmQuadra && !p.entradaAnulada)));
  return <div className={styles.pilha}>
    <h1 className={styles.titulo}>{ficha ? historico?.atleta.nomeCompleto ?? "Ficha do atleta" : "Meu histórico"}</h1>
    <p className={styles.texto}>{ficha ? "Histórico disponível somente para atletas atualmente vinculados ao seu clube." : "Seu clube e sua participação em cada jogo."}</p>
    {ficha && consulta.erro && <p className={controles.nota}>Se o atleta foi transferido, o acesso ao histórico e à foto pelo técnico anterior deixa de ser permitido. Consulte o presidente se o vínculo estiver incorreto.</p>}
    {historico && <>
      {ficha && <section className={styles.painel}>
        <h2 className={styles.subtitulo}>Identificação</h2><p className={styles.texto}>Clube atual: {historico.atleta.clubeAtual?.nome ?? "Sem clube informado"}.</p>
        {!consulta.erro && historico.atleta.clubeAtual?.id === sessao.usuario.clubeId && <>{mostrarFoto ? <FotoPrivada atletaId={atletaId} nome={historico.atleta.nomeCompleto} /> : <button className={controles.secundario} onClick={() => setMostrarFoto(true)}>Consultar foto</button>}</>}
      </section>}
      <dl className={styles.resumoTotais} aria-label="Resumo dos totais esportivos">
        <div><dt>jogos em quadra</dt><dd>{historico.totais.participacoes.comEntradaEmQuadra}</dd></div>
        <div><dt>gols</dt><dd>{historico.totais.gols}</dd></div>
        <div><dt>amarelos</dt><dd>{historico.totais.cartoesAmarelos}</dd></div>
      </dl>
      <details className={styles.ajudaDetalhe}><summary>Ver todos os totais</summary>
        <dl className={styles.sumula}>
          <div><dt>Escalações</dt><dd>{historico.totais.participacoes.escaladas}</dd></div>
          <div><dt>Credenciamentos</dt><dd>{historico.totais.participacoes.credenciadas}</dd></div>
          <div><dt>Entradas em quadra</dt><dd>{historico.totais.participacoes.comEntradaEmQuadra}</dd></div>
        </dl>
        <MetricasParticipacao metricas={historico.totais} />
        <p className={controles.ajuda}>Totais de participações credenciadas, inclusive em jogos invalidados, com apenas lançamentos válidos. Escalações são contadas separadamente. Entrada registrada não indica presença atual em quadra.</p>
      </details>
      <details className={styles.ajudaDetalhe}><summary>Filtrar histórico</summary><div className={styles.filtros}>
        <div className={controles.campo}><label className={controles.rotulo} htmlFor="historico-status">Situação do jogo</label><select className={controles.entrada} id="historico-status" value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="todos">Todos os jogos</option>{Object.entries(STATUS_JOGO).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></div>
        <div className={controles.campo}><label className={controles.rotulo} htmlFor="historico-etapa">Participação</label><select className={controles.entrada} id="historico-etapa" value={etapa} onChange={e => setEtapa(e.target.value)}><option value="todas">Todas as participações</option><option value="escalado">Escalado</option><option value="credenciado">Credenciado</option><option value="entrou">Entrou em quadra</option></select></div>
      </div></details>
      {!visiveis?.length && <p className={styles.texto}>{historico.jogos.length ? "Nenhuma participação corresponde aos filtros." : "Nenhuma participação registrada ainda. Uma partida aparecerá aqui quando houver escalação ou credenciamento."}</p>}
      <ol className={styles.historicoGrade} aria-label={contar(visiveis?.length ?? 0, "participação", "participações")}>{visiveis?.map(p => <li className={styles.cardHistorico} key={p.participacaoId}>
        <div className={styles.linha}><p className={controles.ajuda}>{dia(p.jogo.iniciadoEm ?? p.jogo.inicioPrevistoEm, p.jogo.fusoHorario)}</p><span className={`${controles.status} ${p.jogo.status === "cancelado" ? controles.statusRejeitado : controles.statusAprovado}`}>{STATUS_JOGO[p.jogo.status]}</span></div>
        <p className={controles.ajuda}>{p.jogo.campeonato.nome} · {p.jogo.campeonato.edicao} · {p.jogo.campeonato.categoria}</p>
        <h3>{p.clube.clube.nome} × {p.adversario.clube.nome}</h3>
        <p className={styles.placar}>{p.placar ? `${p.placar.clube} × ${p.placar.adversario}` : "Sem placar"}</p>
        <p className={styles.texto}>{p.entradaAnulada ? "Entrada em quadra anulada" : p.entrouEmQuadra ? "Entrou em quadra" : p.credenciado ? "Credenciado, sem entrada em quadra" : "Escalado, sem credenciamento"}{p.metricas ? ` · ${p.metricas.gols} gols · ${p.metricas.cartoesAmarelos} amarelos` : " · Métricas indisponíveis"}</p>
        {p.jogo.invalidadoEm && <p className={controles.erro}>Resultado invalidado; estatísticas preservadas.</p>}
        <button className={controles.discreto} onClick={() => setAbertaId(p.participacaoId)} aria-label={`Ver ${ficha ? "participação" : "minha participação"} em ${p.clube.clube.nome} × ${p.adversario.clube.nome}`}>{ficha ? "Ver participação" : "Ver minha participação"}</button>
      </li>)}</ol>
    </>}
    <EstadoConsulta {...consulta} atualizar={() => { void consulta.carregar(); }} />
    <Dialogo aberto={!!aberta} aoFechar={() => setAbertaId(null)} tituloId={tituloDialogo} focoInicial={fechar}>
      {aberta && <div className={`${pagina.detalhe} ${styles.pilha}`}>
        <h2 id={tituloDialogo} className={styles.titulo}>{aberta.clube.clube.nome} × {aberta.adversario.clube.nome}</h2>
        <p className={styles.texto}>{aberta.jogo.campeonato.nome}, {aberta.jogo.campeonato.edicao}, {aberta.jogo.campeonato.categoria}.</p>
        <p>{horarioJogo(aberta.jogo.iniciadoEm ?? aberta.jogo.inicioPrevistoEm, aberta.jogo.fusoHorario)} ({aberta.jogo.fusoHorario}). {aberta.jogo.local ?? "Local não informado"}.</p>
        <p><strong>{STATUS_JOGO[aberta.jogo.status]}</strong>{aberta.jogo.resultado ? `, resultado ${RESULTADO[aberta.jogo.resultado]}` : ""}.</p>
        <p className={styles.placar}>{aberta.placar ? `${aberta.placar.clube} × ${aberta.placar.adversario}` : "Sem placar"}</p>
        <p>Clube representado neste jogo: <strong>{aberta.clube.clube.nome}</strong>.</p>
        {aberta.jogo.interrompido && <p className={controles.nota}>Jogo interrompido.</p>}
        {aberta.jogo.invalidadoEm && <p className={controles.erro}>Resultado invalidado. As estatísticas históricas foram preservadas.</p>}
        <EtapasParticipacao participacao={aberta} /><MetricasParticipacao metricas={aberta.metricas} />
        <p className={controles.ajuda}>Escalação, credenciamento e entrada são etapas distintas. Entrada registrada não significa presença atual em quadra.</p>
        {ficha && aberta.clube.clube.id === sessao.usuario.clubeId && <Link className={styles.link} href={`/tecnico/jogos/${aberta.jogo.id}`}>Consultar jogo do meu clube</Link>}
        <button ref={fechar} className={controles.secundario} onClick={() => setAbertaId(null)}>Fechar participação</button>
      </div>}
    </Dialogo>
  </div>;
}

export function MeuHistorico() {
  const { sessao } = useAreaPessoal();
  return <HistoricoPessoal atletaId={sessao.usuario.id} />;
}
