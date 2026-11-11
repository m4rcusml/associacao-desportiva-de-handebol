"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { apiUrl } from "../../lib/api";
import { IMPEDIMENTOS, numeroCamisa, podeEstornar, TIPOS_LANCAMENTO, type AtletaJogo, type DadosArbitragem, type LeituraQr } from "../../lib/arbitragem";
import type { ClubeNoJogo, Lancamento, TipoLancamento } from "../../lib/presidente";
import { Dialogo } from "../ui/dialogo";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./arbitragem.module.css";
import type { Intencao } from "./use-arbitragem";

export type Participante = AtletaJogo & ClubeNoJogo;
type Comando = { intencao: Intencao; titulo: string; texto: string; camisa?: number };
type OperacaoProps = { dados: DadosArbitragem; bloqueado: boolean; enviando: boolean; erro: string; executar: (intencao: Intencao) => Promise<boolean>; fechar: () => void; fotoSemAcesso: (status: number) => void };
export function FotoJogo({ jogoId, atletaId, nome, fotoSemAcesso }: { jogoId: string; atletaId: string; nome: string; fotoSemAcesso: (status: number) => void }) {
  const imagem = useRef<HTMLImageElement>(null);
  const [estado, setEstado] = useState("Consultando foto…");
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    fetch(`${apiUrl}/arbitragem/jogos/${jogoId}/atletas/${atletaId}/foto`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async r => {
      if (!r.ok) { if (!controller.signal.aborted && [401, 403].includes(r.status)) fotoSemAcesso(r.status); throw new Error("Foto indisponível"); }
      const blob = await r.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      if (imagem.current) imagem.current.src = url;
      setEstado("");
    }).catch(() => { if (!controller.signal.aborted) setEstado("Foto indisponível. Confira a identificação do atleta."); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [jogoId, atletaId, fotoSemAcesso]);
  // Imagem privada obtida como Blob com cookie temporário, sem serviço de otimização público.
  // eslint-disable-next-line @next/next/no-img-element
  return <div className={styles.foto}><img ref={imagem} alt={`Foto de ${nome}`} hidden={!!estado} />{estado && <span className={controles.ajuda}>{estado}</span>}</div>;
}

function ResumoPessoa({ pessoa, camisa }: { pessoa: Participante; camisa?: number | null }) {
  return <div className={styles.resumo}><h3>{pessoa.atleta.nomeCompleto}</h3><p>{pessoa.clube.nome}</p><p>Camisa <strong>{camisa ?? pessoa.credenciamento?.numeroCamisa ?? "a informar"}</strong></p></div>;
}

function FichaAtleta({ pessoa, tokenQr, leitura, focoVoltar, ...props }: OperacaoProps & { pessoa: Participante; tokenQr?: string; leitura?: LeituraQr; focoVoltar: RefObject<HTMLButtonElement | null> }) {
  const [camisa, setCamisa] = useState("");
  const [tipo, setTipo] = useState<TipoLancamento>("gol");
  const [relatorio, setRelatorio] = useState(false);
  const [acao, setAcao] = useState<"credenciar" | "camisa" | "lancamento">(pessoa.credenciamento ? "lancamento" : "credenciar");
  const [revisao, setRevisao] = useState<Comando | null>(null);
  const p = pessoa.credenciamento;
  const jogo = props.dados.sessao.jogo;
  const podeRegistrar = jogo.status === "em_andamento" && !jogo.interrompidoEm;
  const camisaNova = numeroCamisa(camisa);
  const numeroRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (revisao) focoVoltar.current?.focus(); }, [revisao, focoVoltar]);
  function revisar(e: FormEvent) {
    e.preventDefault();
    if (props.bloqueado) return;
    if (acao === "lancamento" && p && podeRegistrar) {
      setRevisao({ titulo: `Registrar ${TIPOS_LANCAMENTO[tipo].toLowerCase()}?`, texto: tipo === "cartaoVermelho" ? (relatorio ? "Desqualificação com relatório disciplinar (azul)." : "Desqualificação sem relatório disciplinar.") : "Será registrado um lançamento para este atleta.", intencao: { caminho: "/lancamentos", corpo: { operacaoId: crypto.randomUUID(), participacaoId: p.participacaoId, tipo, ...(tipo === "cartaoVermelho" ? { relatorioDisciplinar: relatorio } : {}) }, sucesso: `${TIPOS_LANCAMENTO[tipo]} registrado.` } });
    } else if (camisaNova !== null) {
      if (acao === "credenciar" && !p && !pessoa.impedimento) setRevisao({ titulo: "Confirmar credenciamento?", texto: `Credenciar com a camisa ${camisaNova}. A entrada em quadra será registrada separadamente.`, camisa: camisaNova, intencao: { caminho: "/credenciamentos", corpo: { ...(tokenQr ? { tokenQr } : { atletaId: pessoa.atleta.id }), numeroCamisa: camisaNova }, sucesso: "Atleta credenciado." } });
      if (acao === "camisa" && p && camisaNova !== p.numeroCamisa) setRevisao({ titulo: "Corrigir a camisa?", texto: `Trocar a camisa ${p.numeroCamisa} pela ${camisaNova}. O histórico será preservado.`, camisa: camisaNova, intencao: { caminho: `/credenciamentos/${p.atleta.id}/camisa`, corpo: { numeroCamisaAtual: p.numeroCamisa, numeroCamisa: camisaNova }, sucesso: "Camisa corrigida." } });
    }
  }
  async function confirmar() {
    if (!revisao) return;
    if (await props.executar(revisao.intencao)) props.fechar();
    else setRevisao(null);
  }
  return <div className={styles.dialogo}>
    <h2 id="titulo-atleta" className={pagina.detalheNome}>{revisao?.titulo ?? "Conferir atleta"}</h2>
    <ResumoPessoa pessoa={pessoa} camisa={revisao?.camisa} />
    {revisao ? <><p className={pagina.texto}>{revisao.texto}</p>{props.erro && <p className={controles.erro} role="alert">{props.erro}</p>}<div className={styles.acoes}><button className={controles.primario} disabled={props.bloqueado} onClick={() => { void confirmar(); }}>{props.enviando ? "Enviando…" : "Confirmar"}</button><button ref={focoVoltar} className={controles.secundario} disabled={props.enviando} onClick={() => setRevisao(null)}>Voltar</button></div></>
      : <>
        {(pessoa.escalado || p) && <FotoJogo jogoId={jogo.id} atletaId={pessoa.atleta.id} nome={pessoa.atleta.nomeCompleto} fotoSemAcesso={props.fotoSemAcesso} />}
        {leitura && <p className={controles.ajuda}>Carteirinha {leitura.carteirinha.codigo}: {leitura.carteirinha.status === "ativa" ? "ativa" : "invalidada"}. A leitura identificou o atleta e não fez credenciamento.</p>}
        <div className={styles.etapas}><span className={pessoa.escalado ? styles.feito : undefined}>{pessoa.escalado ? "Escalado" : "Não escalado"}</span><span className={p ? styles.feito : undefined}>{p ? "Credenciado" : "Não credenciado"}</span><span className={p?.entrouEmQuadraEm ? styles.feito : undefined}>{p?.entrouEmQuadraEm ? "Entrada registrada" : "Entrada não registrada"}</span></div>
        {pessoa.impedimento && <p className={controles.nota}>{IMPEDIMENTOS[pessoa.impedimento]}</p>}
        {p ? <div className={styles.acoes}><button className={controles.opcao} aria-pressed={acao === "lancamento"} disabled={props.bloqueado || !podeRegistrar} onClick={() => setAcao("lancamento")}>Gol ou penalidade</button><button className={controles.opcao} aria-pressed={acao === "camisa"} disabled={props.bloqueado} onClick={() => { setAcao("camisa"); setCamisa(""); }}>Corrigir camisa</button></div> : null}
        {(acao !== "lancamento" || podeRegistrar) && <form onSubmit={revisar} className={styles.formulario}>
          {acao === "lancamento" ? <><label className={controles.campo}><span className={controles.rotulo}>Ocorrência</span><select className={controles.entrada} value={tipo} disabled={props.bloqueado} onChange={e => { setTipo(e.target.value as TipoLancamento); setRelatorio(false); }}>{Object.entries(TIPOS_LANCAMENTO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
            {tipo === "cartaoVermelho" && <label className={styles.checkbox}><input type="checkbox" checked={relatorio} onChange={e => setRelatorio(e.target.checked)} disabled={props.bloqueado} />Com relatório disciplinar (azul)</label>}
            <p className={controles.ajuda}>O atleta credenciado pode receber lançamentos mesmo com a entrada em quadra ainda não marcada.</p></>
            : <label className={controles.campo}><span className={controles.rotulo}>{acao === "camisa" ? "Nova camisa" : "Número da camisa"}</span><input ref={numeroRef} className={controles.entrada} type="text" inputMode="numeric" pattern="[0-9]+" required maxLength={10} value={camisa} disabled={props.bloqueado || !!pessoa.impedimento} onChange={e => setCamisa(e.target.value)} /><span className={controles.ajuda}>Inteiro de 0 a 2147483647. Cada camisa é única no clube neste jogo.</span></label>}
          <button className={controles.primario} disabled={props.bloqueado || (acao === "lancamento" ? !p || !podeRegistrar : camisaNova === null || (acao === "credenciar" && !!pessoa.impedimento) || (acao === "camisa" && camisaNova === p?.numeroCamisa))}>Revisar {acao === "credenciar" ? "credenciamento" : acao === "camisa" ? "camisa" : "ocorrência"}</button>
        </form>}
        {!podeRegistrar && p && <p className={controles.nota}>{jogo.interrompidoEm ? "Partida interrompida: novos lançamentos e entradas em quadra estão bloqueados. As correções permanecem disponíveis." : "Gols, penalidades e entrada em quadra ficam disponíveis depois do início."}</p>}
        {p && <div className={styles.acoes}>
          {!p.entrouEmQuadraEm && <button className={controles.secundario} disabled={props.bloqueado || !podeRegistrar} onClick={() => setRevisao({ titulo: "Confirmar entrada em quadra?", texto: "Registrar que este atleta entrou em quadra. A marcação é feita uma única vez.", intencao: { caminho: `/credenciamentos/${p.atleta.id}/entrada`, corpo: {}, sucesso: "Entrada em quadra registrada." } })}>Registrar entrada em quadra</button>}
          <button className={controles.rejeitar} disabled={props.bloqueado || !podeEstornar(p, props.dados.registros.lancamentos)} onClick={() => setRevisao({ titulo: "Desfazer credenciamento?", texto: "Somente sem entrada em quadra e sem qualquer lançamento, inclusive anulado. A escalação do técnico será preservada.", intencao: { caminho: `/credenciamentos/${p.atleta.id}/estorno`, corpo: { numeroCamisa: p.numeroCamisa }, sucesso: "Credenciamento desfeito." } })}>Desfazer credenciamento</button>
        </div>}
        {props.erro && <p className={controles.erro} role="alert">{props.erro}</p>}<button ref={focoVoltar} className={controles.secundario} onClick={props.fechar} disabled={props.enviando}>Voltar à lista</button>
      </>}
  </div>;
}

export function AtletaDialogo({ pessoa, tokenQr, leitura, ...props }: OperacaoProps & { pessoa: Participante | null; tokenQr?: string; leitura?: LeituraQr }) {
  const voltar = useRef<HTMLButtonElement>(null);
  return <Dialogo aberto={!!pessoa} tituloId="titulo-atleta" aoFechar={props.fechar} focoInicial={voltar} bloqueado={props.enviando}>
    {pessoa && <FichaAtleta key={`${pessoa.atleta.id}:${tokenQr ?? "manual"}`} {...props} pessoa={pessoa} tokenQr={tokenQr} leitura={leitura} focoVoltar={voltar} />}
  </Dialogo>;
}

function FichaLancamento({ lancamento, focoVoltar, ...props }: OperacaoProps & { lancamento: Lancamento; focoVoltar: RefObject<HTMLButtonElement | null> }) {
  const participacoes = props.dados.atletas.clubes.flatMap(c => c.atletas.flatMap(a => a.credenciamento ? [{ ...a.credenciamento, clube: c.clube }] : []));
  const [participacaoId, setParticipacaoId] = useState(lancamento.participacaoId ?? "");
  const [tipo, setTipo] = useState(lancamento.tipo);
  const [relatorio, setRelatorio] = useState(lancamento.relatorioDisciplinar ?? false);
  const [revisao, setRevisao] = useState<Comando | null>(null);
  const escolhido = participacoes.find(p => p.participacaoId === participacaoId);
  useEffect(() => { if (revisao) focoVoltar.current?.focus(); }, [revisao, focoVoltar]);
  async function confirmar() {
    if (!revisao) return;
    if (await props.executar(revisao.intencao)) props.fechar(); else setRevisao(null);
  }
  function revisar(e: FormEvent) {
    e.preventDefault();
    if (!escolhido || props.bloqueado || lancamento.anuladoEm) return;
    setRevisao({ titulo: "Confirmar correção?", texto: `${TIPOS_LANCAMENTO[tipo]} para ${escolhido.atleta.nomeCompleto}, camisa ${escolhido.numeroCamisa}, ${escolhido.clube.nome}.${tipo === "cartaoVermelho" ? (relatorio ? " Com relatório disciplinar (azul)." : " Sem relatório disciplinar.") : ""} O original ficará anulado no histórico.`, intencao: { caminho: `/lancamentos/${lancamento.id}/correcao`, corpo: { operacaoId: crypto.randomUUID(), tipo, participacaoId, ...(tipo === "cartaoVermelho" ? { relatorioDisciplinar: relatorio } : {}) }, sucesso: "Lançamento corrigido." } });
  }
  return <div className={styles.dialogo}><h2 id="titulo-lancamento" className={pagina.detalheNome}>{revisao?.titulo ?? "Corrigir lançamento"}</h2>
    <div className={styles.resumo}><p>Original: <strong>{TIPOS_LANCAMENTO[lancamento.tipo]}</strong></p><p>{lancamento.atleta?.nomeCompleto ?? "Atleta indisponível"}, camisa {lancamento.numeroCamisa ?? "—"}</p><p>{props.dados.atletas.clubes.find(c => c.inscricaoId === lancamento.inscricaoId)?.clube.nome ?? "Clube indisponível"}</p><p>{lancamento.anuladoEm ? "Anulado" : "Vigente"}</p></div>
    {revisao ? <><p className={pagina.texto}>{revisao.texto}</p><div className={styles.acoes}><button className={controles.primario} disabled={props.bloqueado || !!lancamento.anuladoEm} onClick={() => { void confirmar(); }}>{props.enviando ? "Enviando…" : "Confirmar"}</button><button ref={focoVoltar} className={controles.secundario} disabled={props.enviando} onClick={() => setRevisao(null)}>Voltar</button></div></>
      : <><form className={styles.formulario} onSubmit={revisar}>
        <label className={controles.campo}><span className={controles.rotulo}>Atleta correto</span><select className={controles.entrada} value={participacaoId} onChange={e => setParticipacaoId(e.target.value)} disabled={props.bloqueado || !!lancamento.anuladoEm} required><option value="">Selecione um credenciado</option>{participacoes.map(p => <option key={p.participacaoId} value={p.participacaoId}>{p.numeroCamisa} — {p.atleta.nomeCompleto} — {p.clube.nome}</option>)}</select></label>
        <label className={controles.campo}><span className={controles.rotulo}>Ocorrência correta</span><select className={controles.entrada} value={tipo} onChange={e => { setTipo(e.target.value as TipoLancamento); setRelatorio(false); }} disabled={props.bloqueado || !!lancamento.anuladoEm}>{Object.entries(TIPOS_LANCAMENTO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
        {tipo === "cartaoVermelho" && <label className={styles.checkbox}><input type="checkbox" checked={relatorio} onChange={e => setRelatorio(e.target.checked)} disabled={props.bloqueado || !!lancamento.anuladoEm} />Com relatório disciplinar (azul)</label>}
        <button className={controles.primario} disabled={props.bloqueado || !!lancamento.anuladoEm || !escolhido}>Revisar correção</button></form>
        <button className={controles.rejeitar} disabled={props.bloqueado || !!lancamento.anuladoEm} onClick={() => setRevisao({ titulo: "Anular lançamento?", texto: "Este registro sairá do placar e do desempenho, permanecendo visível no histórico.", intencao: { caminho: `/lancamentos/${lancamento.id}/anulacao`, corpo: { operacaoId: crypto.randomUUID() }, sucesso: "Lançamento anulado." } })}>Anular lançamento</button>
        <button ref={focoVoltar} className={controles.secundario} disabled={props.enviando} onClick={props.fechar}>Voltar à súmula</button></>}
    {props.erro && <p className={controles.erro} role="alert">{props.erro}</p>}
  </div>;
}
export function LancamentoDialogo({ lancamento, ...props }: OperacaoProps & { lancamento: Lancamento | null }) {
  const voltar = useRef<HTMLButtonElement>(null);
  return <Dialogo aberto={!!lancamento} tituloId="titulo-lancamento" aoFechar={props.fechar} focoInicial={voltar} bloqueado={props.enviando}>
    {lancamento && <FichaLancamento key={lancamento.id} {...props} lancamento={lancamento} focoVoltar={voltar} />}
  </Dialogo>;
}
