"use client";

import { useState, type FormEvent, type RefObject } from "react";
import type { CredenciamentosJogo, DetalheJogo, Lancamento, ParticipacaoCredenciamento, RegistrosJogo, ResultadoJogo, SolicitacaoVerificacao, TipoLancamento } from "../../../lib/presidente";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { data, ModalJogo, nomeClube, RESULTADOS, TIPOS_LANCAMENTO, useOperacaoJogo, type AoAlterar } from "./apoio";
import styles from "./jogo.module.css";

type Acao =
  | { tipo: "resultado"; visto: { resultado: ResultadoJogo; vencedorInscricaoId: string | null } }
  | { tipo: "invalidar" | "registrar" }
  | { tipo: "camisa" | "anular-entrada" | "estornar"; participacao: ParticipacaoCredenciamento }
  | { tipo: "corrigir-lancamento" | "anular-lancamento"; lancamento: Lancamento; operacaoId: string };
const TITULOS = {
  resultado: "Corrigir resultado e vencedor", invalidar: "Invalidar jogo definitivamente?", registrar: "Registrar participação real",
  camisa: "Corrigir número da camisa", "anular-entrada": "Anular entrada em quadra?", estornar: "Desfazer credenciamento?",
  "corrigir-lancamento": "Corrigir lançamento", "anular-lancamento": "Anular lançamento?",
};
const IRREGULARIDADES = { conta_desativada: "conta desativada", carteirinha_invalidada: "carteirinha invalidada", suspensao: "suspensão" };

function valido(l: Lancamento) { return !l.anuladoEm && !l.substituidoPorId; }

export function CorrecoesJogo({ jogo, registros, credenciamentos, pessoas, atualizar, focoAlternativo }: {
  jogo: DetalheJogo; registros: RegistrosJogo; credenciamentos: CredenciamentosJogo; pessoas: SolicitacaoVerificacao[];
  atualizar: AoAlterar; focoAlternativo: RefObject<HTMLElement | null>;
}) {
  const [acao, setAcao] = useState<Acao | null>(null);
  const [tipoLancamento, setTipoLancamento] = useState<TipoLancamento>("gol");
  const operacao = useOperacaoJogo(atualizar);
  const participacoes = credenciamentos.participacoes.filter(p => p.credenciadoEm && p.numeroCamisa !== null);
  const atletas = pessoas.filter(p => p.perfil === "atleta" && p.statusVerificacao === "aprovado" && p.carteirinha);

  function abrir(nova: Acao) {
    operacao.limparErro();
    if (nova.tipo === "corrigir-lancamento") setTipoLancamento(nova.lancamento.tipo);
    setAcao(nova);
  }

  function novaIntencao() {
    // O mesmo formulário mantém a operação no reenvio; editar seu conteúdo inicia outra intenção.
    if (acao && "operacaoId" in acao) setAcao({ ...acao, operacaoId: crypto.randomUUID() });
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!acao) return;
    const form = new FormData(evento.currentTarget);
    const base = `/jogos/${jogo.id}`;
    let path: string;
    let body: unknown;
    let mensagem: string;
    switch (acao.tipo) {
      case "resultado":
        path = `${base}/correcao-resultado`;
        body = { atual: acao.visto, novo: { resultado: form.get("resultado"), vencedorInscricaoId: form.get("vencedorInscricaoId") || null } };
        mensagem = "Resultado e vencedor conferidos e atualizados.";
        break;
      case "invalidar": path = `${base}/invalidacao`; body = { motivo: String(form.get("motivo")).trim() }; mensagem = "Jogo invalidado. O histórico e os registros esportivos foram preservados."; break;
      case "registrar":
        path = `${base}/credenciamentos/administrativos`;
        body = { atletaId: form.get("atletaId"), numeroCamisa: Number(form.get("numeroCamisa")), entrouEmQuadra: form.get("entrouEmQuadra") === "sim" };
        mensagem = "Participação administrativa registrada.";
        break;
      case "camisa":
        path = `${base}/credenciamentos/${acao.participacao.atleta.id}/camisa`;
        body = { numeroCamisaAtual: acao.participacao.numeroCamisa, numeroCamisa: Number(form.get("numeroCamisa")) };
        mensagem = "Número da camisa corrigido.";
        break;
      case "anular-entrada": path = `${base}/credenciamentos/${acao.participacao.atleta.id}/entrada/anulacao`; body = {}; mensagem = "Entrada em quadra anulada, com histórico preservado."; break;
      case "estornar": path = `${base}/credenciamentos/${acao.participacao.atleta.id}/estorno`; body = { numeroCamisa: acao.participacao.numeroCamisa }; mensagem = "Credenciamento desfeito, com histórico preservado."; break;
      case "corrigir-lancamento":
        path = `${base}/lancamentos/${acao.lancamento.id}/correcao`;
        body = { operacaoId: acao.operacaoId, tipo: tipoLancamento, participacaoId: form.get("participacaoId"), ...(tipoLancamento === "cartaoVermelho" ? { relatorioDisciplinar: form.get("relatorioDisciplinar") === "sim" } : {}) };
        mensagem = "Lançamento corrigido. Placar, métricas e suspensões afetadas foram recalculados.";
        break;
      case "anular-lancamento": path = `${base}/lancamentos/${acao.lancamento.id}/anulacao`; body = { operacaoId: acao.operacaoId }; mensagem = "Lançamento anulado. Placar, métricas e suspensões afetadas foram recalculados."; break;
    }
    if (await operacao.executar(path, body, mensagem)) setAcao(null);
  }

  if (jogo.status !== "finalizado") return <p className={controles.nota}>{jogo.status === "cancelado" ? "Jogo cancelado. Os registros ficam disponíveis para consulta; não há correções pós-jogo." : "As correções administrativas ficam disponíveis após o encerramento do jogo pela arbitragem."}</p>;

  return <div className={pagina.secoes}>
    <section className={pagina.secao} aria-labelledby="ordem-correcao-titulo">
      <h2 id="ordem-correcao-titulo" className={pagina.secaoTitulo}>Corrigir uma participação registrada por engano</h2>
      <ol className={styles.passos}>
        <li>Se outra pessoa realmente jogou, registre primeiro a participação real dela.</li>
        <li>Corrija os lançamentos para o atleta certo ou anule os que não aconteceram.</li>
        <li>Anule a entrada indevida e desfaça o credenciamento quando não houver entrada nem lançamentos válidos.</li>
        <li>Ajuste a camisa do atleta correto depois de liberar o número.</li>
      </ol>
      <p className={styles.meta}>Se a camisa ainda estiver ocupada, use um número livre ao registrar a participação e corrija-o ao final. Cada alteração só vale após confirmação do servidor.</p>
    </section>
    <section className={pagina.secao} aria-labelledby="correcao-resultado-titulo">
      <h2 id="correcao-resultado-titulo" className={pagina.secaoTitulo}>Resultado e validade</h2>
      <p className={pagina.secaoTexto}>O vencedor é independente do placar. Corrigir o resultado não muda os gols; cada lançamento é corrigido separadamente.</p>
      <p className={styles.texto}>{jogo.resultado ? RESULTADOS[jogo.resultado] : "Resultado não informado"} · Vencedor: {nomeClube(jogo, jogo.vencedorInscricaoId)}</p>
      <div className={styles.acoes}>
        {jogo.resultado && <button type="button" className={controles.secundario} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "resultado", visto: { resultado: jogo.resultado!, vencedorInscricaoId: jogo.vencedorInscricaoId } })}>Corrigir resultado</button>}
        {!jogo.invalidadoEm && <button type="button" className={controles.rejeitar} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "invalidar" })}>Invalidar jogo</button>}
      </div>
      {jogo.invalidadoEm && <p className={`${controles.nota} ${styles.nota}`}>Jogo invalidado em {data(jogo.invalidadoEm, jogo.fusoHorario)}. A invalidação é definitiva e preserva os registros esportivos.</p>}
    </section>

    <section className={pagina.secao} aria-labelledby="correcao-participacao-titulo">
      <div className={pagina.secaoTopo}><h2 id="correcao-participacao-titulo" className={pagina.secaoTitulo}>Participações e credenciamentos</h2>
        {jogo.iniciadoEm && <button type="button" className={controles.primario} disabled={operacao.ocupado || !atletas.length} onClick={() => abrir({ tipo: "registrar" })}>Registrar participação real</button>}
      </div>
      <p className={pagina.secaoTexto}>Corrija o que aconteceu em quadra. Uma participação irregular permanece identificada; ela não se torna regular por este registro.</p>
      {!jogo.iniciadoEm && <p className={`${controles.nota} ${styles.nota}`}>Jogo sem início não recebe participação administrativa.</p>}
      {!participacoes.length ? <p className={styles.texto}>Nenhum credenciamento vigente.</p> : <ul className={styles.lista}>
        {participacoes.map(p => {
          const entradaValida = !!p.entrouEmQuadraEm && !p.entradaAnulada;
          const quantidadeLancamentos = registros.lancamentos.filter(l => l.participacaoId === p.participacaoId && valido(l)).length;
          const temLancamentos = quantidadeLancamentos > 0;
          return <li className={styles.item} key={p.participacaoId}>
            <p className={styles.nome}>{p.atleta.nomeCompleto} · camisa {p.numeroCamisa}</p>
            <span className={styles.meta}>{nomeClube(jogo, p.inscricaoId)} · {entradaValida ? "Entrou em quadra" : p.entradaAnulada ? "Entrada anulada" : "Sem entrada registrada"}</span>
            {p.registroAdministrativo && <span className={styles.meta}>Registro administrativo{p.registroAdministrativo.irregularidades.length ? ` · ${p.registroAdministrativo.irregularidades.map(i => IRREGULARIDADES[i]).join(", ")}` : ""}</span>}
            <p className={styles.meta}>Para desfazer: {entradaValida ? "entrada em quadra ainda válida" : "sem entrada válida"}; {quantidadeLancamentos === 1 ? "1 lançamento válido" : `${quantidadeLancamentos} lançamentos válidos`}. {!entradaValida && !temLancamentos ? "Credenciamento pronto para ser desfeito." : "Resolva as pendências antes de desfazer."}</p>
            <div className={styles.acoes}>
              <button type="button" className={controles.secundario} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "camisa", participacao: p })} aria-label={`Corrigir camisa de ${p.atleta.nomeCompleto}`}>Corrigir camisa</button>
              {entradaValida && <button type="button" className={controles.rejeitar} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "anular-entrada", participacao: p })} aria-label={`Anular entrada de ${p.atleta.nomeCompleto}`}>Anular entrada</button>}
              <button type="button" className={controles.rejeitar} disabled={operacao.ocupado || entradaValida || temLancamentos} onClick={() => abrir({ tipo: "estornar", participacao: p })} aria-label={`Desfazer credenciamento de ${p.atleta.nomeCompleto}`}>Desfazer credenciamento</button>
            </div>
            {(entradaValida || temLancamentos) && <p className={styles.meta}>Para desfazer o credenciamento, primeiro anule a entrada indevida e corrija ou anule os lançamentos válidos deste atleta.</p>}
          </li>;
        })}
      </ul>}
    </section>

    <section className={pagina.secao} aria-labelledby="correcao-lancamentos-titulo">
      <h2 id="correcao-lancamentos-titulo" className={pagina.secaoTitulo}>Gols e penalidades</h2>
      <p className={pagina.secaoTexto}>Cada ocorrência é corrigida individualmente. É possível atribuí-la à participação de um atleta de qualquer um dos dois clubes.</p>
      {!registros.lancamentos.length ? <p className={styles.texto}>Nenhum lançamento registrado.</p> : <ul className={styles.lista}>
        {registros.lancamentos.map(l => <li className={styles.item} key={l.id}>
          <p className={styles.nome}>{TIPOS_LANCAMENTO[l.tipo]}{l.relatorioDisciplinar ? " com relatório disciplinar" : ""} · {l.atleta?.nomeCompleto ?? "Atleta indisponível"}</p>
          <span className={styles.meta}>{nomeClube(jogo, l.inscricaoId)}{l.numeroCamisa !== null ? ` · camisa ${l.numeroCamisa}` : ""} · {data(l.registradoEm, jogo.fusoHorario)}</span>
          <span className={styles.meta}>{l.substituidoPorId ? "Substituído por correção" : l.anuladoEm ? "Anulado" : "Válido"}{l.substituiLancamentoId ? " · Correção de lançamento anterior" : ""}</span>
          {valido(l) && <div className={styles.acoes}>
            <button type="button" className={controles.secundario} disabled={operacao.ocupado || !participacoes.length} onClick={() => abrir({ tipo: "corrigir-lancamento", lancamento: l, operacaoId: crypto.randomUUID() })} aria-label={`Corrigir ${TIPOS_LANCAMENTO[l.tipo]} de ${l.atleta?.nomeCompleto ?? "atleta"}`}>Corrigir lançamento</button>
            <button type="button" className={controles.rejeitar} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "anular-lancamento", lancamento: l, operacaoId: crypto.randomUUID() })} aria-label={`Anular ${TIPOS_LANCAMENTO[l.tipo]} de ${l.atleta?.nomeCompleto ?? "atleta"}`}>Anular lançamento</button>
          </div>}
        </li>)}
      </ul>}
    </section>

    <ModalJogo aberto={!!acao} fechar={() => setAcao(null)} titulo={acao ? TITULOS[acao.tipo] : ""} focoAlternativo={focoAlternativo} ocupado={operacao.ocupado || operacao.incerta}>
      {acao && <form className={styles.formulario} onSubmit={enviar} onChange={novaIntencao}>
        <fieldset className={styles.camposOperacao} disabled={operacao.ocupado || operacao.incerta}>
        {acao.tipo === "resultado" && <>
          <p className={styles.texto}>Resultado visto: {RESULTADOS[acao.visto.resultado]} · vencedor: {nomeClube(jogo, acao.visto.vencedorInscricaoId)}.</p>
          <div className={controles.campo}><label htmlFor="resultado-novo" className={controles.rotulo}>Forma do encerramento</label><select id="resultado-novo" name="resultado" className={controles.entrada} defaultValue={acao.visto.resultado} required>{Object.entries(RESULTADOS).map(([valor, rotulo]) => <option key={valor} value={valor} disabled={valor === "wo" ? !!jogo.iniciadoEm : !jogo.iniciadoEm}>{rotulo}</option>)}</select></div>
          <div className={controles.campo}><label htmlFor="vencedor-novo" className={controles.rotulo}>Vencedor</label><select id="vencedor-novo" name="vencedorInscricaoId" className={controles.entrada} defaultValue={acao.visto.vencedorInscricaoId ?? ""}><option value="">Nenhum vencedor</option><option value={jogo.clubeA.inscricaoId}>{jogo.clubeA.clube.nome}</option><option value={jogo.clubeB.inscricaoId}>{jogo.clubeB.clube.nome}</option></select></div>
          {!!operacao.conflito && jogo.resultado && <button type="button" className={controles.secundario} onClick={() => { setAcao({ tipo: "resultado", visto: { resultado: jogo.resultado!, vencedorInscricaoId: jogo.vencedorInscricaoId } }); operacao.limparErro(); }}>Conferir e usar o resultado atual</button>}
          <p className={controles.nota}>A correção preserva placar, estatísticas e cumprimentos de suspensão.</p>
        </>}
        {acao.tipo === "invalidar" && <>
          <p className={controles.nota}>A invalidação é definitiva. Placar, vencedor, estatísticas e cumprimentos serão preservados; o vencedor pode ser corrigido separadamente.</p>
          <div className={controles.campo}><label htmlFor="invalidacao-motivo" className={controles.rotulo}>Motivo</label><textarea id="invalidacao-motivo" name="motivo" className={controles.entrada} required minLength={1} maxLength={500} rows={3} /></div>
        </>}
        {acao.tipo === "registrar" && <>
          <div className={controles.campo}><label htmlFor="participacao-atleta" className={controles.rotulo}>Atleta que realmente participou</label><select id="participacao-atleta" name="atletaId" className={controles.entrada} required defaultValue=""><option value="" disabled>Selecione o atleta</option>{atletas.map(p => <option key={p.usuarioId} value={p.usuarioId}>{p.nomeCompleto} · {p.clube?.nome ?? "Sem clube atual"}{!p.ativo ? " · Conta desativada" : ""}</option>)}</select></div>
          <div className={controles.campo}><label htmlFor="participacao-camisa" className={controles.rotulo}>Número da camisa neste jogo</label><input id="participacao-camisa" name="numeroCamisa" className={controles.entrada} type="number" min={0} max={2147483647} step={1} required /></div>
          <p className={controles.ajuda}>A camisa não pode estar em uso por outro credenciamento do mesmo clube. Se estiver, registre com um número livre e corrija depois de liberar o número original.</p>
          <label className={styles.checkbox}><input type="checkbox" name="entrouEmQuadra" value="sim" />O atleta entrou em quadra neste jogo</label>
          <p className={controles.nota}>O servidor verifica o vínculo com um dos clubes na hora do início do jogo. Suspensão, conta desativada ou carteirinha invalidada ficam registradas como irregularidades. Isso não regulariza a participação.</p>
        </>}
        {acao.tipo === "camisa" && <>
          <p className={styles.texto}>{acao.participacao.atleta.nomeCompleto} · camisa vista: {acao.participacao.numeroCamisa}.</p>
          <div className={controles.campo}><label htmlFor="camisa-nova" className={controles.rotulo}>Número correto da camisa</label><input id="camisa-nova" name="numeroCamisa" className={controles.entrada} type="number" min={0} max={2147483647} step={1} required /></div>
          {!!operacao.conflito && <button type="button" className={controles.secundario} onClick={() => { const atual = participacoes.find(p => p.participacaoId === acao.participacao.participacaoId); if (atual) { setAcao({ tipo: "camisa", participacao: atual }); operacao.limparErro(); } }}>Conferir e usar a camisa atual</button>}
        </>}
        {acao.tipo === "anular-entrada" && <p className={controles.nota}>Anular a entrada de {acao.participacao.atleta.nomeCompleto}? O registro original e a correção serão preservados. Os lançamentos não serão transferidos nem anulados automaticamente.</p>}
        {acao.tipo === "estornar" && <p className={controles.nota}>Desfazer o credenciamento de {acao.participacao.atleta.nomeCompleto}, camisa {acao.participacao.numeroCamisa}? Essa ação só é permitida sem entrada válida nem lançamentos válidos. O histórico permanece.</p>}
        {(acao.tipo === "corrigir-lancamento" || acao.tipo === "anular-lancamento") && <p className={styles.texto}>Ocorrência original: {TIPOS_LANCAMENTO[acao.lancamento.tipo]} de {acao.lancamento.atleta?.nomeCompleto ?? "atleta indisponível"}, {nomeClube(jogo, acao.lancamento.inscricaoId)}.</p>}
        {acao.tipo === "corrigir-lancamento" && <>
          <div className={controles.campo}><label htmlFor="lancamento-tipo" className={controles.rotulo}>Ocorrência correta</label><select id="lancamento-tipo" name="tipo" className={controles.entrada} value={tipoLancamento} onChange={e => setTipoLancamento(e.target.value as TipoLancamento)}>{Object.entries(TIPOS_LANCAMENTO).map(([valor, rotulo]) => <option value={valor} key={valor}>{rotulo}</option>)}</select></div>
          <div className={controles.campo}><label htmlFor="lancamento-participacao" className={controles.rotulo}>Atleta e clube corretos</label><select id="lancamento-participacao" name="participacaoId" className={controles.entrada} defaultValue={acao.lancamento.participacaoId ?? ""} required><option value="" disabled>Selecione uma participação</option>{participacoes.map(p => <option key={p.participacaoId} value={p.participacaoId}>{p.atleta.nomeCompleto} · camisa {p.numeroCamisa} · {nomeClube(jogo, p.inscricaoId)}</option>)}</select></div>
          {tipoLancamento === "cartaoVermelho" && <label className={styles.checkbox}><input type="checkbox" name="relatorioDisciplinar" value="sim" defaultChecked={acao.lancamento.relatorioDisciplinar ?? false} />Desqualificação com relatório disciplinar (azul)</label>}
          <p className={controles.nota}>Transferir um gol para o adversário altera o placar dos dois clubes. A correção recalcula métricas e suspensões afetadas e preserva o lançamento original.</p>
        </>}
        {acao.tipo === "anular-lancamento" && <p className={controles.nota}>Anule somente se a ocorrência não aconteceu. A anulação recalcula placar, métricas e suspensões afetadas, preservando o registro original.</p>}
        </fieldset>
        {operacao.erro && <p role="alert" className={controles.erro}>{operacao.erro}</p>}
        {!!operacao.conflito && "operacaoId" in acao && <p className={controles.nota}>Feche este diálogo e confira o lançamento vigente antes de iniciar outra correção.</p>}
        <div className={pagina.acoes}>
          <button type="submit" className={acao.tipo === "invalidar" || acao.tipo === "anular-entrada" || acao.tipo === "estornar" || acao.tipo === "anular-lancamento" ? controles.rejeitar : controles.primario} disabled={operacao.ocupado || (!!operacao.conflito && "operacaoId" in acao)}>{operacao.ocupado ? "Salvando…" : acao.tipo === "resultado" ? "Confirmar resultado" : acao.tipo === "invalidar" ? "Confirmar invalidação" : acao.tipo === "registrar" ? "Confirmar participação" : acao.tipo === "camisa" ? "Corrigir camisa" : acao.tipo === "anular-entrada" ? "Confirmar anulação da entrada" : acao.tipo === "estornar" ? "Desfazer credenciamento" : acao.tipo === "corrigir-lancamento" ? "Confirmar correção" : "Confirmar anulação"}</button>
          <button type="button" className={controles.secundario} disabled={operacao.ocupado || operacao.incerta} onClick={() => setAcao(null)}>Voltar</button>
        </div>
      </form>}
    </ModalJogo>
  </div>;
}
