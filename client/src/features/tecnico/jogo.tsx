"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ApiError } from "../../lib/api";
import type { DesempenhoJogo, EscalacaoJogo, Pessoa, StatusJogo } from "../../lib/presidente";
import { horarioJogo, uuidValido } from "../../lib/area-pessoal";
import { lerAtalhos, salvarAtalhos } from "../../lib/tecnico";
import { useAreaPessoal } from "../area-pessoal/shell";
import { useConsulta } from "../area-pessoal/consulta";
import { SituacaoCadastro } from "../area-pessoal/cadastro";
import { EtapasParticipacao, MetricasParticipacao, RESULTADO, STATUS_JOGO } from "../area-pessoal/historico";
import { normalizar } from "../ui/formatos";
import { Iniciais } from "../ui/identificacao";
import controles from "../ui/controles.module.css";
import styles from "../area-pessoal/pessoal.module.css";

const BLOQUEIO: Record<StatusJogo, string> = {
  agendado: "A escolha prévia não credencia nem confirma entrada em quadra. A arbitragem verifica a elegibilidade no jogo.",
  em_andamento: "Partida em andamento. A escalação preliminar foi encerrada no início do jogo. As próximas etapas cabem à arbitragem.",
  finalizado: "Partida finalizada. A escalação está encerrada; os registros ficam disponíveis para consulta.",
  cancelado: "Partida cancelada pelo presidente. A escalação não pode ser alterada; este jogo não terá credenciamento nem contará para suspensões.",
};

function Suspensao({ pendente }: { pendente: boolean }) {
  return pendente ? <p className={styles.suspensao}>Suspensão pendente</p> : null;
}

export function JogoTecnico({ id }: { id: string }) {
  const { sessao, tratarErro, revalidar } = useAreaPessoal();
  const permitido = sessao.usuario.aprovado && !!sessao.usuario.clubeId;
  const valido = uuidValido(id);
  // Os dois hooks iniciam consultas independentes no mesmo ciclo, sem cascata de requisições.
  const escalacao = useConsulta<EscalacaoJogo>(permitido && valido ? `/jogos/${id}/escalacao` : null);
  const desempenho = useConsulta<DesempenhoJogo>(permitido && valido ? `/jogos/${id}/desempenho` : null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [precisaAtualizar, setPrecisaAtualizar] = useState(false);
  const trava = useRef(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const tituloDisponiveis = useRef<HTMLHeadingElement>(null);
  const botoesEscalar = useRef(new Map<string, HTMLButtonElement>());
  const resultados = useRef(new Map<string, HTMLLIElement>());
  const clube = escalacao.dados?.clubes.find(c => c.clube.id === sessao.usuario.clubeId);
  const clubeConfirmado = clube?.clube.id;
  const resumoAtalho = desempenho.dados?.jogo;
  const rotuloAtalho = resumoAtalho ? `${resumoAtalho.campeonato.nome}, ${resumoAtalho.campeonato.edicao}, ${horarioJogo(resumoAtalho.inicioPrevistoEm, resumoAtalho.fusoHorario)} (${resumoAtalho.fusoHorario})` : "";
  useEffect(() => {
    if (clubeConfirmado && valido && rotuloAtalho) salvarAtalhos(sessao.usuario.id, clubeConfirmado, [{ id, rotulo: rotuloAtalho }, ...lerAtalhos(sessao.usuario.id, clubeConfirmado)]);
  }, [clubeConfirmado, id, sessao.usuario.id, valido, rotuloAtalho]);
  async function atualizar() {
    if (trava.current) return;
    const leituras = await Promise.all([escalacao.carregar(), desempenho.carregar()]);
    setPrecisaAtualizar(!leituras.every(Boolean));
  }
  async function alterar(atleta: Pessoa, remover: boolean) {
    if (trava.current) return;
    if (!podeAlterar) { setErro("A escalação não pode ser alterada com os dados atuais. Volte à tela do jogo e atualize os dados."); return; }
    const indice = disponiveis.findIndex(a => a.id === atleta.id);
    const proximos = remover ? [atleta.id, ...disponiveis.map(a => a.id)]
      : [...disponiveis.slice(indice + 1), ...disponiveis.slice(0, indice)].map(a => a.id);
    let confirmada = false;
    trava.current = true; setEnviando(true); setErro(""); setAviso("");
    try {
      const resposta = await api<EscalacaoJogo & { alterado: boolean }>(`/jogos/${id}/escalacao${remover ? `/${atleta.id}` : ""}`, remover ? undefined : { atletaId: atleta.id }, remover ? "DELETE" : "POST");
      confirmada = true;
      escalacao.setDados(resposta); setPrecisaAtualizar(false);
      setAviso(resposta.alterado ? `${atleta.nomeCompleto}: ${remover ? "retirado da escalação" : "escalação confirmada"}.` : "A escalação já estava nesse estado. Dados conferidos pelo servidor.");
      // Falha desta leitura não transforma uma escrita confirmada em falha nem oferece reenviá-la.
      await desempenho.carregar();
    } catch (falha) {
      setErro(tratarErro(falha)); setPrecisaAtualizar(true);
      if (falha instanceof ApiError && falha.status === 409) {
        const leituras = await Promise.all([escalacao.carregar(), desempenho.carregar()]);
        await revalidar().catch(() => {});
        setPrecisaAtualizar(!leituras.every(Boolean));
      }
    } finally {
      trava.current = false;
      // Reabilita os controles antes de mover o foco para o próximo botão filtrado.
      flushSync(() => setEnviando(false));
      if (confirmada) {
        const proximo = proximos.map(atletaId => botoesEscalar.current.get(atletaId)).find(botao => botao && !botao.disabled)
          ?? [...botoesEscalar.current.values()].find(botao => !botao.disabled);
        const resultado = resultados.current.get(`${remover ? "disponivel" : "escalado"}:${atleta.id}`);
        (proximo ?? resultado ?? tituloDisponiveis.current ?? titulo.current)?.focus({ preventScroll: true });
      }
    }
  }
  if (!permitido) return <SituacaoCadastro />;
  if (!valido) return <div className={styles.pilha}><h1 className={styles.titulo}>Jogo não identificado</h1><p className={controles.erro} role="alert">O identificador do jogo deve ser um UUID válido.</p><Link className={styles.link} href="/tecnico">Abrir outro jogo</Link></div>;
  const jogo = escalacao.dados?.jogo;
  const resumo = desempenho.dados?.jogo;
  const placar = desempenho.dados?.placar;
  const carregando = escalacao.carregando || desempenho.carregando;
  const podeAlterar = jogo?.status === "agendado" && !enviando && !carregando && !precisaAtualizar && !escalacao.erro && !desempenho.erro && resumo?.status === "agendado";
  const escolhidos = new Set(clube?.escalados.filter(e => e.vinculoAtual).map(e => e.atleta.id));
  const conhecidos = new Set([...(clube?.atletasDoClube.map(a => a.id) ?? []), ...(clube?.escalados.filter(e => e.vinculoAtual).map(e => e.atleta.id) ?? [])]);
  const termo = normalizar(busca);
  const escalados = clube?.escalados.filter(e => normalizar(e.atleta.nomeCompleto).includes(termo)) ?? [];
  const disponiveis = clube?.atletasDoClube.filter(a => !escolhidos.has(a.id) && normalizar(a.nomeCompleto).includes(termo)) ?? [];
  const status = resumo?.status ?? jogo?.status;
  return <div className={styles.pilha}>
    <h1 ref={titulo} tabIndex={-1} className={styles.titulo}>{status === "agendado" ? "Escalação" : "Jogo e desempenho"}</h1>
    {status && <div className={styles.pilha}>
      <div>
        <p className={styles.texto}>{clube?.clube.nome ?? "Clube"} · {STATUS_JOGO[status]}</p>
        {resumo && <p className={styles.texto}>{resumo.campeonato.nome} · {resumo.campeonato.edicao} · {resumo.campeonato.categoria}</p>}
        <p className={styles.texto}>{horarioJogo(jogo?.inicioPrevistoEm ?? resumo?.inicioPrevistoEm ?? null, jogo?.fusoHorario ?? resumo!.fusoHorario)} ({jogo?.fusoHorario ?? resumo?.fusoHorario}) · {resumo?.local ?? "Local não informado"}</p>
      </div>
      {placar ? <section className={styles.painel} aria-label="Placar oficial"><h2 className={styles.subtitulo}>{placar.clubeA.clube.nome} × {placar.clubeB.clube.nome}</h2><p className={styles.placar} aria-label={`Placar ${placar.placarClubeA} a ${placar.placarClubeB}`}>{placar.placarClubeA} × {placar.placarClubeB}</p></section> : <p className={controles.ajuda}>{status === "agendado" ? "Adversário e placar indisponíveis nesta consulta antes do início." : status === "cancelado" ? "Adversário e placar indisponíveis nesta consulta. Partida cancelada." : "Adversário e placar indisponíveis nesta consulta."}</p>}
      {resumo?.resultado && <p>Resultado: {RESULTADO[resumo.resultado]}.{resumo.vencedorInscricaoId && placar ? ` Vencedor: ${[placar.clubeA, placar.clubeB].find(c => c.inscricaoId === resumo.vencedorInscricaoId)?.clube.nome ?? "não identificado nesta consulta"}.` : ""}</p>}
      {resumo?.interrompido && <p className={controles.nota}>Jogo interrompido.</p>}
      {resumo?.invalidadoEm && <p className={controles.erro}>Resultado invalidado. Estatísticas históricas preservadas.</p>}
      {status !== "agendado" && <p className={controles.nota}>{BLOQUEIO[status]}</p>}
      {jogo && resumo && jogo.status !== resumo.status && <p className={controles.nota}>O estado mudou entre as consultas. Atualize os dados antes de alterar a escalação.</p>}
    </div>}
    <button className={controles.secundario} disabled={carregando || enviando} onClick={() => { void atualizar(); }}>{carregando ? "Atualizando…" : "Atualizar dados do jogo"}</button>
    <span role="status" aria-live="polite">{carregando ? "Consultando dados oficiais…" : ""}</span>
    {escalacao.erro && <p className={controles.erro} role="alert">Escalação: {escalacao.erro} Dados anteriores podem estar desatualizados.</p>}
    {desempenho.erro && <p className={controles.erro} role="alert">Desempenho: {desempenho.erro} Dados anteriores podem estar desatualizados.</p>}
    <div role="status" aria-live="polite">{aviso && <p className={styles.sucesso}>{aviso}</p>}</div>
    {erro && <p className={controles.erro} role="alert">{erro}</p>}
    {precisaAtualizar && <p className={controles.nota}>Atualize os dados antes de tentar outra alteração. Sua última tentativa pode ter sido recebida pelo servidor.</p>}
    {clube && <>
      <div className={styles.duasColunas}>
        <section className={styles.secaoLista} aria-labelledby="titulo-escalados"><h2 id="titulo-escalados" className={styles.subtitulo}>Escalados ({clube.escalados.length})</h2>
          <ul className={styles.lista}>{escalados.map(e => <li className={styles.linhaAtleta} key={e.participacaoId} tabIndex={-1} ref={elemento => { if (elemento) resultados.current.set(`escalado:${e.atleta.id}`, elemento); else resultados.current.delete(`escalado:${e.atleta.id}`); }}>
            <Iniciais nome={e.atleta.nomeCompleto} />
            <div>{e.vinculoAtual ? <Link className={styles.nomeAtleta} href={`/tecnico/atletas/${e.atleta.id}`}>{e.atleta.nomeCompleto}</Link> : <strong>{e.atleta.nomeCompleto}</strong>}
              {e.suspensaoPendente ? <Suspensao pendente /> : <p>Escolha por {e.escolhidaPorTecnico?.nomeCompleto ?? "técnico não informado"}</p>}
            </div>
            {jogo?.status === "agendado" && <button className={controles.secundario} disabled={!podeAlterar} aria-label={`Retirar ${e.atleta.nomeCompleto}`} onClick={() => { void alterar(e.atleta, true); }}>Retirar</button>}
            {!e.vinculoAtual && <p className={styles.transferido}>Vínculo encerrado após a escolha. Não poderá ser credenciado por este clube. Você pode retirar a escolha antiga.</p>}
          </li>)}</ul>
          {!escalados.length && <p className={styles.texto}>{busca ? "Nenhum escalado corresponde à busca." : "Nenhum atleta escalado neste clube."}</p>}
        </section>
        <section className={styles.secaoLista} aria-labelledby="titulo-disponiveis"><h2 id="titulo-disponiveis" ref={tituloDisponiveis} tabIndex={-1} className={styles.subtitulo}>{jogo?.status === "agendado" ? "Disponíveis para escalar" : "Candidatos atuais do clube"}</h2>
          <div className={controles.campo}><label htmlFor="busca-atleta" className={controles.rotulo}>Buscar nome nas duas listas</label><input id="busca-atleta" className={controles.entrada} type="search" placeholder="Nome do atleta" value={busca} onChange={e => setBusca(e.target.value)} /></div>
          <ul className={styles.lista}>{disponiveis.map(a => <li className={styles.linhaAtleta} key={a.id} tabIndex={-1} ref={elemento => { if (elemento) resultados.current.set(`disponivel:${a.id}`, elemento); else resultados.current.delete(`disponivel:${a.id}`); }}>
            <Iniciais nome={a.nomeCompleto} />
            <div><Link className={styles.nomeAtleta} href={`/tecnico/atletas/${a.id}`}>{a.nomeCompleto}</Link>{a.suspensaoPendente ? <Suspensao pendente /> : <p>Conta e carteirinha ativas</p>}</div>
            {jogo?.status === "agendado" && <button ref={elemento => { if (elemento) botoesEscalar.current.set(a.id, elemento); else botoesEscalar.current.delete(a.id); }} className={controles.primario} disabled={!podeAlterar} aria-label={`Escalar ${a.nomeCompleto}`} onClick={() => { void alterar(a, false); }}>{enviando ? "Aguarde…" : "Escalar"}</button>}
          </li>)}</ul>
          {!disponiveis.length && <p className={styles.texto}>{busca ? "Nenhum disponível corresponde à busca." : "Não há candidatos disponíveis fora da escalação nesta consulta."}</p>}
          <details className={styles.ajudaDetalhe}><summary>Não encontrou um atleta?</summary><p className={controles.ajuda}>A lista de disponíveis mostra apenas atletas aprovados, com conta ativa, carteirinha ativa e vínculo atual. Não é o elenco completo. Se alguém estiver ausente, confirme a situação com o presidente.</p><p className={controles.nota}>Suspensão pendente permite escalar, mas a arbitragem bloqueará o credenciamento se o saldo continuar vigente no jogo. Confirme os detalhes com o presidente.</p></details>
          <details className={styles.ajudaDetalhe}><summary>Ver alterações da escalação</summary><ul className={styles.lista}>{clube.alteracoes.map((a, i) => <li className={styles.item} key={`${a.ocorridoEm}:${i}`}>{a.tipo === "inclusao" ? "Inclusão" : "Retirada"} de {a.atleta.nomeCompleto} por {a.tecnico.nomeCompleto}, {horarioJogo(a.ocorridoEm, jogo!.fusoHorario)}.</li>)}</ul>{!clube.alteracoes.length && <p>Nenhuma alteração registrada.</p>}</details>
        </section>
      </div>
      {status === "agendado" && <p className={controles.ajuda}>{BLOQUEIO.agendado} A arbitragem define a camisa no credenciamento.</p>}
    </>}
    {desempenho.dados && <details className={styles.ajudaDetalhe} open={status !== "agendado"}><summary>Participações e desempenho dos dois clubes</summary>
      {!desempenho.dados.participacoes.length && <p className={styles.texto}>Nenhuma participação registrada neste jogo.</p>}
      <ul className={styles.lista}>{desempenho.dados.participacoes.map(p => {
        const nomeClube = placar ? [placar.clubeA, placar.clubeB].find(c => c.inscricaoId === p.inscricaoId)?.clube.nome : clube?.inscricaoId === p.inscricaoId ? clube.clube.nome : "Outro clube (nome indisponível nesta consulta)";
        return <li key={p.participacaoId} className={styles.item}><h3 className={styles.subtitulo}>{p.atleta.nomeCompleto}</h3><p className={controles.ajuda}>{nomeClube}</p><EtapasParticipacao participacao={p} /><MetricasParticipacao metricas={p.metricas} />{conhecidos.has(p.atleta.id) && <Link className={styles.link} href={`/tecnico/atletas/${p.atleta.id}`}>Consultar ficha do atleta</Link>}</li>;
      })}</ul>
    </details>}
    <details className={styles.ajudaDetalhe}><summary>Identificação e navegação</summary><p className={styles.codigo}>Jogo {id}</p><Link className={styles.link} href="/tecnico">Voltar aos jogos</Link></details>
  </div>;
}
