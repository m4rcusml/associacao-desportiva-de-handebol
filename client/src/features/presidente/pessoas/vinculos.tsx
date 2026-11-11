"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import type { Clube, HistoricoVinculos, ReferenciaClube } from "../../../lib/presidente";
import { Confirmacao } from "../../ui/confirmacao";
import { dia } from "../../ui/formatos";
import { conflito, status, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import styles from "./pessoa.module.css";

type Props = { atletaId: string; aprovado: boolean; aoTransferir: (clubeAtual: ReferenciaClube | null) => void };
type Dados = { historico: HistoricoVinculos; clubes: Clube[] };

/** Vínculos do atleta com clubes (do mais recente ao mais antigo) e transferência do atleta aprovado. */
export function Vinculos({ atletaId, aprovado, aoTransferir }: Props) {
  const tratarErro = useErroApi();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [destino, setDestino] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const consulta = useRef(0);
  const envio = useRef(false);

  const carregar = useCallback(() => {
    const versao = ++consulta.current;
    Promise.all([
      api<HistoricoVinculos>(`/atletas/${atletaId}/vinculos`),
      aprovado ? api<Clube[]>("/clubes/visao-geral") : Promise.resolve([]),
    ])
      .then(([historico, clubes]) => { if (versao === consulta.current) { setDados({ historico, clubes }); setErroCarga(""); } })
      .catch(falha => { if (versao === consulta.current) setErroCarga(tratarErro(falha)); });
  }, [atletaId, aprovado, tratarErro]);

  const invalidarConsulta = useCallback(() => { consulta.current++; }, []);
  useEffect(() => { carregar(); return invalidarConsulta; }, [carregar, invalidarConsulta]);

  const atual = dados?.historico.clubeAtual ?? null;
  const opcoes = (dados?.clubes ?? []).filter(c => c.id !== atual?.id);
  const clubeDestino = opcoes.find(c => c.id === destino) ?? null;

  function pedir(evento: FormEvent) {
    evento.preventDefault();
    setAviso("");
    setErro("");
    if (!clubeDestino) { setErro("Escolha o clube de destino."); return; }
    setConfirmando(true);
  }

  async function transferir() {
    if (!atual || !clubeDestino || envio.current) return;
    envio.current = true;
    consulta.current++;
    setEnviando(true);
    setErro("");
    try {
      const { alterado, ...historico } = await api<HistoricoVinculos & { alterado: boolean }>(
        `/atletas/${atletaId}/transferencia`, { clubeAtualId: atual.id, clubeDestinoId: clubeDestino.id });
      setDados(d => (d ? { ...d, historico } : d));
      setAviso(alterado ? `Atleta transferido para ${clubeDestino.nome}.` : `O atleta já estava em ${clubeDestino.nome}; nada mudou.`);
      setDestino("");
      setConfirmando(false);
      aoTransferir(historico.clubeAtual ? { id: historico.clubeAtual.id, nome: historico.clubeAtual.nome } : null);
    } catch (falha) {
      // Conflito (campeonato em andamento, vínculo alterado por outra pessoa): mantém a escolha e relê os vínculos.
      setErro(tratarErro(falha));
      if (conflito(falha) || status(falha) === 404) carregar();
    } finally {
      envio.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className={pagina.secao} aria-labelledby="secao-vinculos">
      <h2 id="secao-vinculos" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Vínculos com clubes</h2>

      {erroCarga && dados && <p className={controles.erro} role="alert">{erroCarga} Os últimos vínculos confirmados foram mantidos.</p>}
      {erroCarga && !dados ? (
        <>
          <p className={controles.erro} role="alert">{erroCarga}</p>
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={() => { setErroCarga(""); setDados(null); carregar(); }}>Tentar novamente</button>
        </>
      ) : !dados ? (
        <p className={pagina.carregando} role="status">Carregando vínculos…</p>
      ) : (
        <>
          {dados.historico.vinculos.length === 0 ? (
            <p className={pagina.secaoTexto}>Sem vínculo registrado. O clube do cadastro é confirmado na aprovação.</p>
          ) : (
            <ol className={styles.eventos}>
              {dados.historico.vinculos.map((v, i) => ({ v, inicial: i === 0 })).reverse().map(({ v, inicial }) => (
                <li key={v.id}>
                  <span className={styles.eventoNome}>
                    {v.clube.nome}{v.clube.cidade ? `, ${v.clube.cidade}` : ""}
                    {v.fim === null && <span className={`${controles.status} ${controles.statusAprovado} ${styles.marca}`}>Atual</span>}
                  </span>
                  <span className={styles.eventoMeta}>
                    Desde <time dateTime={v.inicio}>{dia(v.inicio)}</time>
                    {v.fim && <> até <time dateTime={v.fim}>{dia(v.fim)}</time></>}
                    {inicial ? (v.definidoPorPresidenteId ? ", clube do cadastro, confirmado na aprovação" : ", clube do cadastro, aguardando aprovação") : ", por transferência"}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <p className={pagina.aviso} role="status">{aviso}</p>

          {aprovado && atual && (
            <form className={pagina.formulario} onSubmit={pedir} noValidate>
              <h3 className={pagina.subtitulo}>Transferir para outro clube</h3>
              <p className={pagina.secaoTexto}>
                Não é possível transferir enquanto {atual.nome} participar de campeonato em andamento. O histórico de jogos continua ligado ao clube da época.
              </p>
              <div className={controles.campo}>
                <label className={controles.rotulo} htmlFor="clube-destino">Clube de destino</label>
                <select id="clube-destino" className={controles.entrada} value={destino} onChange={e => { setDestino(e.target.value); setErro(""); }} disabled={enviando}>
                  <option value="">Escolha um clube</option>
                  {opcoes.map(c => <option key={c.id} value={c.id}>{c.nome}{c.cidade ? `, ${c.cidade}` : ""}</option>)}
                </select>
              </div>
              {erro && !confirmando && <p className={controles.erro} role="alert">{erro}</p>}
              <div className={pagina.acoes}>
                <button type="submit" className={controles.primario} disabled={enviando || opcoes.length === 0}>Transferir atleta</button>
              </div>
              {opcoes.length === 0 && <p className={controles.ajuda}>Não há outro clube cadastrado.</p>}
            </form>
          )}
          {aprovado && !atual && <p className={controles.nota}>Atleta sem vínculo atual: não há clube de origem para transferir.</p>}
        </>
      )}

      <Confirmacao
        aberto={confirmando}
        titulo={`Transferir para ${clubeDestino?.nome ?? "outro clube"}?`}
        rotulo="Confirmar transferência"
        enviando={enviando}
        erro={erro}
        aoConfirmar={transferir}
        aoFechar={() => setConfirmando(false)}
      >
        <p className={pagina.confirmacaoTexto}>
          O vínculo com {atual?.nome ?? "o clube atual"} termina agora e começa o vínculo com {clubeDestino?.nome ?? "o novo clube"}. Os registros anteriores continuam com o clube da época.
        </p>
      </Confirmacao>
    </section>
  );
}
