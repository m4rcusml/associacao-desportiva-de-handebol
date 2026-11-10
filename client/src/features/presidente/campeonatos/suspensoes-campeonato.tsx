"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { api } from "../../../lib/api";
import { consultarSolicitacoes, type SituacaoSuspensao, type SolicitacaoVerificacao, type StatusCampeonato, type Suspensao } from "../../../lib/presidente";
import { Dialogo } from "../../ui/dialogo";
import { conflito, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import styles from "../../ui/pagina.module.css";
import { instante } from "./formatos";

const SITUACOES: Record<SituacaoSuspensao, string> = {
  vigente: "Vigente", cumprida: "Cumprida", revogada: "Revogada", saldo_encerrado: "Saldo encerrado", anulada: "Anulada",
};
type Acao = { tipo: "aplicar" } | { tipo: "detalhe" | "reduzir" | "revogar"; id: string };
type Props = { campeonatoId: string; statusCampeonato: StatusCampeonato; suspensoes: Suspensao[]; aoAtualizar: () => Promise<void> };

export function SuspensoesCampeonato({ campeonatoId, statusCampeonato, suspensoes, aoAtualizar }: Props) {
  const tratarErro = useErroApi();
  const [atletaFiltro, setAtletaFiltro] = useState("todos");
  const [situacaoFiltro, setSituacaoFiltro] = useState<SituacaoSuspensao | "todas">("todas");
  const [origemFiltro, setOrigemFiltro] = useState<"todas" | "manual" | "automatica">("todas");
  const [acao, setAcao] = useState<Acao | null>(null);
  const [atletas, setAtletas] = useState<SolicitacaoVerificacao[] | null>(null);
  const [carregandoAtletas, setCarregandoAtletas] = useState(false);
  const [erroAcao, setErroAcao] = useState("");
  const [erroLista, setErroLista] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const envio = useRef(false);
  const fechar = useRef<HTMLButtonElement>(null);
  const tituloSecao = useRef<HTMLHeadingElement>(null);

  const podeAplicar = statusCampeonato === "planejado" || statusCampeonato === "em_andamento";
  const alvo = acao && acao.tipo !== "aplicar" ? suspensoes.find(s => s.id === acao.id) ?? null : null;
  const podeDecidir = alvo?.situacao === "vigente";
  const atletasComSuspensao = [...new Map(suspensoes.map(s => [s.atleta.id, s.atleta])).values()].sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR"));
  const visiveis = suspensoes.filter(s => (atletaFiltro === "todos" || s.atleta.id === atletaFiltro)
    && (situacaoFiltro === "todas" || s.situacao === situacaoFiltro) && (origemFiltro === "todas" || s.origem === origemFiltro));

  async function carregarAtletas() {
    setCarregandoAtletas(true);
    setErroAcao("");
    try {
      const aprovados = (await consultarSolicitacoes()).filter(s => s.perfil === "atleta" && s.statusVerificacao === "aprovado");
      setAtletas(aprovados.sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR")));
    } catch (falha) { setErroAcao(tratarErro(falha)); }
    finally { setCarregandoAtletas(false); }
  }

  function abrirAplicacao() {
    setAcao({ tipo: "aplicar" });
    setAtletas(null);
    void carregarAtletas();
  }

  function abrirDetalhe(id: string) { setErroAcao(""); setAcao({ tipo: "detalhe", id }); }

  function voltarAoDetalhe() {
    if (!alvo) return;
    flushSync(() => { setAcao({ tipo: "detalhe", id: alvo.id }); setErroAcao(""); });
    fechar.current?.focus();
  }

  async function atualizar() {
    try { await aoAtualizar(); setErroLista(""); }
    catch (falha) { setErroLista(tratarErro(falha)); }
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!acao || acao.tipo === "detalhe" || envio.current) return;
    const formulario = new FormData(evento.currentTarget);
    const tipo = acao.tipo;
    let caminho = `/campeonatos/${campeonatoId}/suspensoes`;
    let corpo: object;
    if (tipo === "aplicar") {
      corpo = { atletaId: String(formulario.get("atletaId")), quantidadeJogos: Number(formulario.get("quantidadeJogos")), motivo: String(formulario.get("motivo")).trim() };
    } else {
      caminho += `/${acao.id}/${tipo}`;
      const justificativa = String(formulario.get("justificativa")).trim();
      corpo = tipo === "reduzir" ? { novaQuantidade: Number(formulario.get("novaQuantidade")), justificativa } : { justificativa };
    }
    envio.current = true;
    setEnviando(true);
    setErroAcao("");
    try {
      await api<unknown>(caminho, corpo);
      setAviso({ aplicar: "Suspensão aplicada.", reduzir: "Suspensão reduzida. A punição original e os cumprimentos foram preservados.", revogar: "Suspensão revogada. O histórico foi preservado." }[tipo]);
      // Uma decisão confirmada não deve ser reenviada se apenas a atualização da lista falhar.
      try { await aoAtualizar(); setErroLista(""); }
      catch (falha) { setErroLista(`A decisão foi registrada. ${tratarErro(falha)} Atualize a lista para consultar o estado atual.`); }
      setAcao(null);
    } catch (falha) {
      setErroAcao(tratarErro(falha));
      if (conflito(falha)) await atualizar();
    } finally { envio.current = false; setEnviando(false); }
  }

  return <section id="suspensoes" className={styles.secao} aria-labelledby="suspensoes-titulo">
    <div className={styles.secaoTopo}><h2 ref={tituloSecao} tabIndex={-1} id="suspensoes-titulo" className={styles.secaoTitulo}>Suspensões</h2><div className={styles.acoes}><button className={controles.secundario} type="button" onClick={() => void atualizar()} disabled={enviando}>Atualizar suspensões</button>{podeAplicar && <button className={controles.primario} type="button" onClick={abrirAplicacao} disabled={enviando}>Aplicar suspensão</button>}</div></div>
    <p className={styles.secaoTexto}>Consulte punições manuais e automáticas, jogos cumpridos e decisões anteriores. Os cumprimentos são registrados ao encerrar os jogos.</p>
    <div className={styles.campos}>
      <div className={controles.campo}><label className={controles.rotulo} htmlFor="suspensoes-atleta">Atleta</label><select id="suspensoes-atleta" className={controles.entrada} value={atletaFiltro} onChange={e => setAtletaFiltro(e.target.value)}><option value="todos">Todos os atletas</option>{atletasComSuspensao.map(a => <option key={a.id} value={a.id}>{a.nomeCompleto}</option>)}</select></div>
      <div className={controles.campo}><label className={controles.rotulo} htmlFor="suspensoes-situacao">Situação</label><select id="suspensoes-situacao" className={controles.entrada} value={situacaoFiltro} onChange={e => setSituacaoFiltro(e.target.value as SituacaoSuspensao | "todas")}><option value="todas">Todas as situações</option>{Object.entries(SITUACOES).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}</select></div>
      <div className={controles.campo}><label className={controles.rotulo} htmlFor="suspensoes-origem">Origem</label><select id="suspensoes-origem" className={controles.entrada} value={origemFiltro} onChange={e => setOrigemFiltro(e.target.value as "todas" | "manual" | "automatica")}><option value="todas">Todas as origens</option><option value="manual">Manual</option><option value="automatica">Automática</option></select></div>
    </div>
    <p className={styles.aviso} role="status">{aviso}</p>
    {erroLista && <p className={controles.erro} role="alert">{erroLista}</p>}
    <h3 className={styles.resultado}>{visiveis.length === 1 ? "1 suspensão" : `${visiveis.length} suspensões`}</h3>
    {visiveis.length ? <ul className={styles.lista}>{visiveis.map(s => <li key={s.id}><button className={styles.linha} type="button" onClick={() => abrirDetalhe(s.id)} aria-haspopup="dialog" disabled={enviando}><span className={styles.linhaNome}>{s.atleta.nomeCompleto}</span><span className={styles.linhaMeta}>{s.origem === "manual" ? "Manual" : "Automática"} · {s.quantidadeAtual} {s.quantidadeAtual === 1 ? "jogo no total" : "jogos no total"} · {s.jogosCumpridos} {s.jogosCumpridos === 1 ? "cumprido" : "cumpridos"} · {s.jogosRestantes} {s.jogosRestantes === 1 ? "restante" : "restantes"}</span><span className={styles.linhaData}>{instante(s.aplicadaEm)}</span><span className={`${styles.linhaStatus} ${controles.status} ${s.situacao === "vigente" ? controles.statusPendente : s.situacao === "cumprida" ? controles.statusAprovado : controles.statusRejeitado}`}>{SITUACOES[s.situacao]}</span></button></li>)}</ul> : <div className={styles.vazio}><p className={styles.vazioTexto}>{suspensoes.length ? "Nenhuma suspensão corresponde aos filtros escolhidos." : "Nenhuma suspensão registrada neste campeonato."}</p>{suspensoes.length > 0 && <button className={controles.secundario} type="button" onClick={() => { setAtletaFiltro("todos"); setSituacaoFiltro("todas"); setOrigemFiltro("todas"); }}>Limpar filtros de suspensões</button>}</div>}

    <Dialogo aberto={acao !== null} bloqueado={enviando} aoFechar={() => setAcao(null)} tituloId="suspensao-dialogo-titulo" focoInicial={fechar} focoAlternativo={tituloSecao}>
      <div className={styles.detalhe}>
        <div className={styles.detalheTopo}><h2 id="suspensao-dialogo-titulo" className={styles.detalheNome}>{acao?.tipo === "aplicar" ? "Aplicar suspensão" : acao?.tipo === "reduzir" ? "Reduzir suspensão" : acao?.tipo === "revogar" ? "Revogar suspensão" : "Detalhes da suspensão"}</h2><button ref={fechar} className={styles.fechar} type="button" onClick={() => setAcao(null)} disabled={enviando}>Fechar</button></div>
        {acao?.tipo === "aplicar" ? <>
          <p className={styles.secaoTexto}>A suspensão pode ser aplicada a qualquer atleta aprovado, inclusive com conta desativada ou clube fora deste campeonato. Quem já estava credenciado em um jogo permanece nesse jogo.</p>
          {carregandoAtletas && <p role="status" className={styles.carregando}>Carregando atletas aprovados…</p>}
          {!carregandoAtletas && atletas === null && <><p className={controles.erro} role="alert">{erroAcao || "Não foi possível carregar os atletas."}</p><button type="button" className={controles.secundario} onClick={() => void carregarAtletas()}>Tentar carregar atletas novamente</button></>}
          {atletas !== null && <form className={styles.formulario} onSubmit={enviar}>
            <div className={controles.campo}><label htmlFor="suspensao-novo-atleta" className={controles.rotulo}>Atleta</label><select id="suspensao-novo-atleta" name="atletaId" className={controles.entrada} required defaultValue="" disabled={enviando || carregandoAtletas}><option value="" disabled>Selecione um atleta aprovado</option>{atletas.map(a => <option key={a.usuarioId} value={a.usuarioId}>{a.nomeCompleto} — {a.clube?.nome ?? "Sem clube"}{a.ativo ? "" : " (conta desativada)"}</option>)}</select></div>
            {atletas.length === 0 && <p className={controles.nota}>Não há atletas aprovados disponíveis. Analise os cadastros antes de aplicar uma suspensão.</p>}
            <div className={controles.campo}><label htmlFor="suspensao-quantidade" className={controles.rotulo}>Quantidade de jogos</label><input id="suspensao-quantidade" name="quantidadeJogos" type="number" inputMode="numeric" min={1} max={2147483647} step={1} required className={controles.entrada} disabled={enviando} /></div>
            <div className={controles.campo}><label htmlFor="suspensao-motivo" className={controles.rotulo}>Motivo</label><textarea id="suspensao-motivo" name="motivo" className={controles.entrada} rows={3} required maxLength={500} disabled={enviando} /></div>
            {!podeAplicar && <p className={controles.nota}>O campeonato foi encerrado ou cancelado e não recebe novas suspensões.</p>}
            {erroAcao && <p className={controles.erro} role="alert">{erroAcao}</p>}<button type="submit" className={controles.rejeitar} disabled={enviando || carregandoAtletas || !podeAplicar || atletas.length === 0}>{enviando ? "Aplicando…" : "Aplicar suspensão"}</button>
          </form>}
        </> : alvo && <>
          <h3 className={styles.subtitulo}>{alvo.atleta.nomeCompleto}</h3>
          {acao?.tipo === "detalhe" ? <>
            <dl className={styles.ficha}>
              <div><dt>Situação</dt><dd>{SITUACOES[alvo.situacao]}</dd></div><div><dt>Origem</dt><dd>{alvo.origem === "manual" ? "Manual" : "Automática — desqualificação com relatório disciplinar"}</dd></div>
              <div><dt>Punição original</dt><dd>{alvo.quantidadeJogos} jogo(s)</dd></div><div><dt>Total atual</dt><dd>{alvo.quantidadeAtual} jogo(s)</dd></div><div><dt>Cumpridos</dt><dd>{alvo.jogosCumpridos} jogo(s)</dd></div><div><dt>Restantes</dt><dd>{alvo.jogosRestantes} jogo(s)</dd></div>
              <div><dt>Motivo</dt><dd>{alvo.motivo}</dd></div><div><dt>Aplicação</dt><dd>{instante(alvo.aplicadaEm)} · {alvo.aplicadaPor?.nomeCompleto ?? "Regra automática"}</dd></div>
            </dl>
            {alvo.jogoOrigemId && <p className={styles.secaoTexto}><Link href={`/presidente/campeonatos/${campeonatoId}/jogos/${alvo.jogoOrigemId}`}>Consultar jogo de origem da suspensão</Link></p>}
            {podeDecidir && <div className={styles.acoes}><button type="button" className={controles.primario} onClick={() => { setErroAcao(""); setAcao({ tipo: "reduzir", id: alvo.id }); }}>Reduzir suspensão</button><button type="button" className={controles.rejeitar} onClick={() => { setErroAcao(""); setAcao({ tipo: "revogar", id: alvo.id }); }}>Revogar suspensão</button></div>}
            <h3 className={styles.subtitulo}>Jogos cumpridos</h3>
            {alvo.cumprimentos.length ? <ul className={styles.lista}>{alvo.cumprimentos.map((c, indice) => <li key={c.jogoId} className={styles.linhaAcoes}><div><Link href={`/presidente/campeonatos/${campeonatoId}/jogos/${c.jogoId}`}>Consultar {indice + 1}º jogo cumprido</Link><span className={styles.linhaMeta}>Registrado em {instante(c.registradoEm)}</span></div></li>)}</ul> : <p className={styles.texto}>Nenhum jogo registrado como cumprimento.</p>}
            <h3 className={styles.subtitulo}>Reduções anteriores</h3>
            {alvo.reducoes.length ? <ul className={styles.lista}>{alvo.reducoes.map(r => <li key={r.id} className={styles.linhaAcoes}><div><strong>{r.quantidadeAnterior} → {r.novaQuantidade} jogo(s)</strong><span className={styles.linhaMeta}>{r.justificativa ?? "Redução herdada de decisão anterior"}</span><span className={styles.linhaData}>{instante(r.reduzidaEm)} · {r.reduzidaPor?.nomeCompleto ?? "Decisão herdada"}</span></div></li>)}</ul> : <p className={styles.texto}>Nenhuma redução registrada.</p>}
            {alvo.revogadaEm && <><h3 className={styles.subtitulo}>Revogação</h3><p className={styles.texto}>{alvo.justificativaRevogacao ?? "Justificativa não registrada"} · {alvo.revogadaPor?.nomeCompleto ?? "Presidente"} · {instante(alvo.revogadaEm)}</p></>}
            {alvo.saldoEncerradoEm && <p className={controles.nota}>Saldo encerrado com o campeonato em {instante(alvo.saldoEncerradoEm)}. O saldo não é transferido a outro campeonato.</p>}
            {alvo.anuladaEm && <p className={controles.nota}>Suspensão automática anulada após correção de sua ocorrência de origem, em {instante(alvo.anuladaEm)}. Os jogos cumpridos foram preservados.</p>}
          </> : <form className={styles.formulario} onSubmit={enviar}>
            <p className={styles.confirmacaoTexto}>{acao?.tipo === "reduzir" ? `O total vigente é de ${alvo.quantidadeAtual} jogo(s), com ${alvo.jogosCumpridos} cumprido(s). Defina o novo total, não a quantidade a descontar.` : "A revogação libera o saldo restante, preservando a punição original, reduções e jogos já cumpridos. Ela não será reativada por recálculo automático."}</p>
            {acao?.tipo === "reduzir" && <div className={controles.campo}><label htmlFor="suspensao-novo-total" className={controles.rotulo}>Novo total de jogos</label><input autoFocus id="suspensao-novo-total" name="novaQuantidade" type="number" inputMode="numeric" min={0} max={Math.max(0, alvo.quantidadeAtual - 1)} step={1} required className={controles.entrada} disabled={enviando || !podeDecidir} /><p className={controles.ajuda}>De 0 a {Math.max(0, alvo.quantidadeAtual - 1)}. O saldo será o novo total menos os cumprimentos, nunca negativo.</p></div>}
            <div className={controles.campo}><label htmlFor="suspensao-justificativa" className={controles.rotulo}>Justificativa</label><textarea id="suspensao-justificativa" name="justificativa" autoFocus={acao?.tipo === "revogar"} rows={3} required maxLength={500} className={controles.entrada} disabled={enviando || !podeDecidir} /></div>
            {!podeDecidir && <p className={controles.nota}>Esta suspensão já não está vigente. Consulte a situação atual antes de tomar outra decisão.</p>}{erroAcao && <p className={controles.erro} role="alert">{erroAcao}</p>}
            <div className={styles.acoes}><button type="submit" className={acao?.tipo === "revogar" ? controles.rejeitar : controles.primario} disabled={enviando || !podeDecidir}>{enviando ? "Enviando…" : acao?.tipo === "reduzir" ? "Confirmar redução" : "Confirmar revogação"}</button><button type="button" className={controles.secundario} onClick={voltarAoDetalhe} disabled={enviando}>Voltar aos detalhes</button></div>
          </form>}
        </>}
      </div>
    </Dialogo>
  </section>;
}
