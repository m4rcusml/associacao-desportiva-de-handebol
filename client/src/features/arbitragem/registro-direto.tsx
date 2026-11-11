"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { TIPOS_LANCAMENTO, ultimoLancamento, type DadosArbitragem } from "../../lib/arbitragem";
import type { TipoLancamento } from "../../lib/presidente";
import { Dialogo } from "../ui/dialogo";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./arbitragem.module.css";
import type { Participante } from "./operacoes";
import type { Intencao } from "./use-arbitragem";

type Props = { dados: DadosArbitragem; bloqueado: boolean; enviando: boolean; erro: string; pendente: boolean; confirmacaoLancamento: number; executar: (intencao: Intencao) => Promise<boolean>; abrirSumula: () => void };
const MODOS: { tipo: TipoLancamento; rotulo: string; acao: string }[] = [
  { tipo: "gol", rotulo: "Gol", acao: "+ Gol" },
  { tipo: "exclusaoDoisMinutos", rotulo: "2 min", acao: "2 min" },
  { tipo: "cartaoAmarelo", rotulo: "Amarelo", acao: "Amarelo" },
  { tipo: "cartaoVermelho", rotulo: "Vermelho", acao: "Vermelho" },
];

export function RegistroDireto({ dados, bloqueado, enviando, erro, pendente, confirmacaoLancamento, executar, abrirSumula }: Props) {
  const [selecao, setSelecao] = useState<{ tipo: TipoLancamento; confirmacao: number }>({ tipo: "gol", confirmacao: confirmacaoLancamento });
  const modo = selecao.confirmacao === confirmacaoLancamento ? selecao.tipo : "gol";
  const [vermelho, setVermelho] = useState<Participante | null>(null);
  const [relatorio, setRelatorio] = useState<boolean | null>(null);
  const voltar = useRef<HTMLButtonElement>(null);
  const jogo = dados.sessao.jogo;
  const podeRegistrar = jogo.status === "em_andamento" && !jogo.interrompidoEm;
  const ultimo = ultimoLancamento(dados.registros.lancamentos);
  const clubeUltimo = dados.atletas.clubes.find(c => c.inscricaoId === ultimo?.inscricaoId)?.clube.nome;
  const acao = MODOS.find(m => m.tipo === modo)!.acao;

  async function registrar(pessoa: Participante, tipo: TipoLancamento, comRelatorio?: boolean) {
    if (!pessoa.credenciamento || bloqueado || !podeRegistrar) return;
    const salvo = await executar({ caminho: "/lancamentos", corpo: { operacaoId: crypto.randomUUID(), participacaoId: pessoa.credenciamento.participacaoId, tipo, ...(tipo === "cartaoVermelho" ? { relatorioDisciplinar: comRelatorio } : {}) }, sucesso: `${TIPOS_LANCAMENTO[tipo]}: camisa ${pessoa.credenciamento.numeroCamisa}, ${pessoa.atleta.nomeCompleto}, ${pessoa.clube.nome}. Salvo.` });
    setVermelho(null); setRelatorio(null);
    if (salvo) setSelecao({ tipo: "gol", confirmacao: confirmacaoLancamento });
  }

  function tocar(pessoa: Participante) {
    if (modo === "cartaoVermelho") { setVermelho(pessoa); setRelatorio(null); }
    else void registrar(pessoa, modo);
  }

  async function desfazer() {
    if (!ultimo || ultimo.tipo !== "gol" || ultimo.anuladoEm || bloqueado || jogo.status !== "em_andamento") return;
    await executar({ caminho: `/lancamentos/${ultimo.id}/anulacao`, corpo: { operacaoId: crypto.randomUUID() }, sucesso: `Gol da camisa ${ultimo.numeroCamisa}, ${ultimo.atleta?.nomeCompleto ?? "atleta"}, anulado. O registro permanece no histórico.` });
  }

  return <section className={styles.registroDireto} aria-label="Registrar gol ou penalidade">
    <div className={styles.modos} role="group" aria-label="Tipo de registro">
      {MODOS.map(m => <button key={m.tipo} type="button" className={styles.modo} aria-pressed={modo === m.tipo} aria-label={TIPOS_LANCAMENTO[m.tipo]} disabled={bloqueado || !podeRegistrar} onClick={() => setSelecao({ tipo: m.tipo, confirmacao: confirmacaoLancamento })}>
        {m.tipo === "gol" ? <Image src={modo === "gol" ? "/arbitragem/gol-ativo.svg" : "/arbitragem/gol.svg"} alt="" width={18} height={18} /> : m.tipo === "exclusaoDoisMinutos" ? <span className={styles.doisMinutos} aria-hidden="true">2′</span> : <span className={m.tipo === "cartaoAmarelo" ? styles.amarelo : styles.vermelho} aria-hidden="true" />}
        <span>{m.rotulo}</span>
      </button>)}
    </div>
    <p className={styles.instrucao}>{!podeRegistrar ? jogo.interrompidoEm ? "Partida interrompida. Retome para registrar gols, penalidades e entradas." : "Os registros abrem após iniciar o jogo." : modo === "gol" ? "Toque em + Gol na camisa." : modo === "cartaoVermelho" ? "Vermelho: toque na camisa para revisar." : `${modo === "exclusaoDoisMinutos" ? "Exclusão de 2 minutos" : "Cartão amarelo"}: toque na camisa para registrar.`}</p>
    <div className={`${styles.equipesRegistro} ${dados.sessao.arbitragem.visualizacao === "linha" ? styles.visaoLinha : ""}`}>
      {dados.atletas.clubes.map((clube, indice) => {
        const atletas = clube.atletas.filter(a => a.credenciamento).toSorted((a, b) => a.credenciamento!.numeroCamisa! - b.credenciamento!.numeroCamisa!);
        return <section key={clube.inscricaoId} className={indice === 0 ? styles.clubeA : styles.clubeB} aria-label={clube.clube.nome}>
          <h2 className={styles.nomeClube}>{clube.clube.nome}<span>{atletas.length} credenciados</span></h2>
          {atletas.length ? <ul className={styles.camisasRegistro}>{atletas.map(a => {
            const camisa = a.credenciamento!.numeroCamisa;
            const pessoa = { ...a, inscricaoId: clube.inscricaoId, clube: clube.clube };
            return <li key={a.atleta.id}><button type="button" className={styles.camisaAcao} disabled={bloqueado || !podeRegistrar} onClick={() => tocar(pessoa)} aria-label={`${TIPOS_LANCAMENTO[modo]}, camisa ${camisa}, ${a.atleta.nomeCompleto}, ${clube.clube.nome}`}>
              <span className={styles.camisaVisual}>
                <Image className={styles.camisaAmpla} src={`/arbitragem/camisa-${indice === 0 ? "a" : "b"}.svg`} alt="" width={52} height={44} /><Image className={styles.camisaCompacta} src={`/arbitragem/camisa-${indice === 0 ? "a" : "b"}-compacta.svg`} alt="" width={38} height={30} />
                <strong className={String(camisa).length > 3 ? styles.numeroLongo : undefined}>{camisa}</strong>
              </span>
              <span className={styles.nomeCamisa}><span className={styles.nomeCompleto}>{a.atleta.nomeCompleto}</span><span className={styles.nomeAbreviado}>{a.atleta.nomeCompleto.replace(/^(\S)\S*\s+/, "$1. ")}</span></span><span className={styles.acaoCamisa}>{enviando ? "Aguarde…" : acao}</span>
            </button></li>;
          })}</ul> : <p className={controles.ajuda}>Nenhum atleta credenciado. Abra Credenciar para conferir os participantes.</p>}
        </section>;
      })}
    </div>
    <div className={`${styles.ultimoLance} ${ultimo?.anuladoEm ? styles.ultimoAnulado : ""}`}>
      <div>{ultimo ? <><strong>{ultimo.anuladoEm ? `${TIPOS_LANCAMENTO[ultimo.tipo]} ${ultimo.substituidoPorId ? "corrigido" : "anulado"}` : `Último · ${TIPOS_LANCAMENTO[ultimo.tipo]} · ${ultimo.numeroCamisa ?? "—"} · ${ultimo.atleta?.nomeCompleto ?? "Atleta indisponível"}`}</strong><span>{ultimo.anuladoEm ? "O registro permanece no histórico." : `${clubeUltimo ?? "Clube indisponível"} · salvo às ${new Intl.DateTimeFormat("pt-BR", { timeZone: jogo.fusoHorario, hour: "2-digit", minute: "2-digit" }).format(new Date(ultimo.registradoEm))}`}</span></> : <><strong>Nenhum lance registrado</strong><span>Os registros confirmados aparecem aqui.</span></>}</div>
      {ultimo?.tipo === "gol" && !ultimo.anuladoEm && jogo.status === "em_andamento" ? <button type="button" className={controles.discreto} disabled={bloqueado} onClick={() => { void desfazer(); }} aria-label={`Desfazer gol da camisa ${ultimo.numeroCamisa}, ${ultimo.atleta?.nomeCompleto ?? "atleta"}, ${clubeUltimo ?? "clube"}`}>Desfazer</button> : <button type="button" className={controles.discreto} onClick={abrirSumula}>Súmula</button>}
    </div>
    <Dialogo aberto={!!vermelho && !pendente} tituloId="titulo-vermelho-direto" aoFechar={() => setVermelho(null)} focoInicial={voltar} bloqueado={enviando}>
      <div className={styles.dialogo}>
        <h2 id="titulo-vermelho-direto" className={pagina.detalheNome}>Registrar cartão vermelho</h2><p className={controles.ajuda}>Confira a identificação antes de confirmar.</p>
        {vermelho && <div className={styles.resumo}><h3>Camisa {vermelho.credenciamento?.numeroCamisa} · {vermelho.atleta.nomeCompleto}</h3><p>{vermelho.clube.nome}</p></div>}
        <fieldset className={styles.relatorio}><legend>Relatório disciplinar</legend><label><input type="radio" name="relatorio-vermelho" checked={relatorio === false} disabled={bloqueado} onChange={() => setRelatorio(false)} />Sem relatório</label><label><input type="radio" name="relatorio-vermelho" checked={relatorio === true} disabled={bloqueado} onChange={() => setRelatorio(true)} />Com relatório</label></fieldset>
        {relatorio === true && <p className={controles.nota}>Com relatório (cartão azul): gera suspensão automática de 1 jogo após o encerramento. O relatório integra este cartão vermelho.</p>}
        {erro && <p role="alert" className={controles.erro}>{erro}</p>}
        <button type="button" className={styles.confirmarPerigo} disabled={bloqueado || relatorio === null} onClick={() => { if (vermelho && relatorio !== null) void registrar(vermelho, "cartaoVermelho", relatorio); }}>{enviando ? "Enviando…" : relatorio === true ? "Confirmar vermelho + relatório" : "Confirmar cartão vermelho"}</button>
        <button ref={voltar} type="button" className={controles.secundario} disabled={enviando} onClick={() => setVermelho(null)}>Cancelar</button>
      </div>
    </Dialogo>
  </section>;
}
