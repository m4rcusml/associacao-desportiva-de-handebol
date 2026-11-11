"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { Recibo, SessaoArbitragem } from "../../lib/arbitragem";
import type { Placar, ResultadoJogo, SenhaArbitragem, Sessao } from "../../lib/presidente";
import { Confirmacao } from "../ui/confirmacao";
import { Dialogo } from "../ui/dialogo";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import styles from "./arbitragem.module.css";
import type { Intencao } from "./use-arbitragem";

export const RESULTADOS: Record<ResultadoJogo, string> = { normal: "Normal", interrompido: "Interrompido definitivamente", abandono: "Abandono", wo: "W.O." };
type Props = { sessao: SessaoArbitragem; placar: Placar | null; bloqueado: boolean; enviando: boolean; erro: string; executar: (intencao: Intencao) => Promise<boolean>; suspenso?: boolean };
export function CicloJogo({ sessao, placar, bloqueado, enviando, erro, executar, suspenso }: Props) {
  const [acao, setAcao] = useState<"inicio" | "interrupcao" | "retomada" | "saida" | null>(null);
  const [encerrar, setEncerrar] = useState(false);
  const jogo = sessao.jogo;
  const textos = { inicio: ["Iniciar jogo?", "Iniciar jogo", "O jogo passará a estar em andamento. Revise os credenciamentos antes de começar."], interrupcao: ["Interromper a partida?", "Interromper", "Novos gols, penalidades e entradas em quadra ficarão bloqueados. Credenciamentos e correções continuarão disponíveis."], retomada: ["Retomar a partida?", "Retomar", "Gols, penalidades e entradas em quadra voltarão a ficar disponíveis."], saida: ["Sair deste jogo?", "Sair do jogo", "O acesso da arbitragem será encerrado somente neste dispositivo. Sua conta pessoal e outros jogos permanecem acessíveis."] } as const;
  async function confirmar() {
    if (!acao) return;
    if (await executar({ caminho: `/${acao}`, corpo: {}, sucesso: `${textos[acao][1]}: confirmado.`, ...(acao === "saida" ? { tipo: "saida" as const } : {}) })) setAcao(null);
  }
  return <>
    <div className={styles.acoes} aria-label="Ações do jogo">
      {jogo.status === "agendado" ? <button className={controles.primario} disabled={bloqueado} onClick={() => setAcao("inicio")}>Iniciar jogo</button>
        : <button className={controles.secundario} disabled={bloqueado} onClick={() => setAcao(jogo.interrompidoEm ? "retomada" : "interrupcao")}>{jogo.interrompidoEm ? "Retomar partida" : "Interromper partida"}</button>}
      <button className={controles.rejeitar} disabled={bloqueado} onClick={() => setEncerrar(true)}>{jogo.status === "agendado" ? "Encerrar por W.O." : "Encerrar jogo"}</button>
      <button className={controles.secundario} disabled={bloqueado} onClick={() => setAcao("saida")}>Sair deste jogo</button>
    </div>
    <Confirmacao aberto={!!acao && !suspenso} titulo={acao ? textos[acao][0] : "Confirmar"} rotulo={acao ? textos[acao][1] : "Confirmar"} enviando={enviando} erro={erro} aoConfirmar={() => { if (!bloqueado) void confirmar(); }} aoFechar={() => setAcao(null)}>{acao && textos[acao][2]}</Confirmacao>
    <Encerramento aberto={encerrar && !suspenso} fechar={() => setEncerrar(false)} {...{ sessao, placar, bloqueado, enviando, erro, executar }} />
  </>;
}
function Encerramento({ aberto, fechar, ...props }: Props & { aberto: boolean; fechar: () => void }) {
  const [resultado, setResultado] = useState<ResultadoJogo>(props.sessao.jogo.status === "agendado" ? "wo" : "normal");
  const [vencedor, setVencedor] = useState("");
  const [revisando, setRevisando] = useState(false);
  const voltar = useRef<HTMLButtonElement>(null);
  const jogo = props.sessao.jogo;
  const forma = jogo.status === "agendado" ? "wo" : resultado === "wo" ? "normal" : resultado;
  const nomeVencedor = vencedor === jogo.clubeA.inscricaoId ? jogo.clubeA.clube.nome : vencedor === jogo.clubeB.inscricaoId ? jogo.clubeB.clube.nome : "Nenhum vencedor";
  function cancelar() { setRevisando(false); fechar(); }
  async function confirmar() {
    if (await props.executar({ caminho: "/encerramento", corpo: { resultado: forma, vencedorInscricaoId: vencedor || null }, sucesso: "Jogo encerrado.", tipo: "encerramento" })) cancelar();
  }
  return <Dialogo aberto={aberto} aoFechar={cancelar} tituloId="titulo-encerramento" focoInicial={voltar} bloqueado={props.enviando}><div className={styles.dialogo}>
    <h2 id="titulo-encerramento" className={pagina.detalheNome}>{revisando ? "Confirmar encerramento?" : "Revisar encerramento"}</h2>
    {props.placar ? <div className={styles.resumo} aria-label="Placar oficial atual"><p className={controles.ajuda}>Placar oficial atual</p><p><strong>{props.placar.clubeA.clube.nome}: {props.placar.placarClubeA}</strong></p><p><strong>{props.placar.clubeB.clube.nome}: {props.placar.placarClubeB}</strong></p></div> : <p className={controles.ajuda}>Placar oficial ainda não disponível.</p>}
    <p className={controles.nota}>O encerramento retira o acesso de todos os dispositivos. Confira camisas e lançamentos agora; depois, somente o presidente poderá corrigir os registros.</p>
    {revisando ? <><div className={styles.resumo}><p>Resultado: <strong>{RESULTADOS[forma]}</strong></p><p>Vencedor: <strong>{nomeVencedor}</strong></p></div><button className={controles.rejeitar} disabled={props.bloqueado} onClick={() => { void confirmar(); }}>{props.enviando ? "Enviando…" : "Encerrar definitivamente"}</button></>
      : <><label className={controles.campo}><span className={controles.rotulo}>Forma do encerramento</span><select className={controles.entrada} value={forma} disabled={props.bloqueado || jogo.status === "agendado"} onChange={e => setResultado(e.target.value as ResultadoJogo)}>{(jogo.status === "agendado" ? ["wo"] : ["normal", "interrompido", "abandono"]).map(r => <option key={r} value={r}>{RESULTADOS[r as ResultadoJogo]}</option>)}</select></label>
        <label className={controles.campo}><span className={controles.rotulo}>Vencedor declarado</span><select className={controles.entrada} value={vencedor} disabled={props.bloqueado} onChange={e => setVencedor(e.target.value)}><option value="">Nenhum vencedor</option><option value={jogo.clubeA.inscricaoId}>{jogo.clubeA.clube.nome}</option><option value={jogo.clubeB.inscricaoId}>{jogo.clubeB.clube.nome}</option></select><span className={controles.ajuda}>O vencedor é informado separadamente do placar dos lançamentos.</span></label>
        <button className={controles.primario} disabled={props.bloqueado} onClick={() => { setRevisando(true); voltar.current?.focus(); }}>Revisar resultado</button></>}
    {props.erro && <p className={controles.erro} role="alert">{props.erro}</p>}
    <button ref={voltar} className={controles.secundario} disabled={props.enviando} onClick={() => revisando ? setRevisando(false) : cancelar()}>Voltar</button>
  </div></Dialogo>;
}

export function ReciboEncerramento({ recibo }: { recibo: Recibo }) {
  const { jogo, placar } = recibo;
  return <section className={`${pagina.secao} ${styles.pilha}`} aria-labelledby="titulo-recibo"><h1 id="titulo-recibo" className={pagina.titulo}>Jogo encerrado</h1><p className={pagina.texto}>Confirmação recebida do servidor. Este acesso à arbitragem terminou.</p>
    {placar && <div className={styles.placar}><div className={styles.equipe}>{placar.clubeA.clube.nome}<strong className={styles.pontos}>{placar.placarClubeA}</strong></div><span className={styles.separador}>×</span><div className={styles.equipe}>{placar.clubeB.clube.nome}<strong className={styles.pontos}>{placar.placarClubeB}</strong></div></div>}
    <dl className={pagina.ficha}><div><dt>Resultado</dt><dd>{RESULTADOS[jogo.resultado]}</dd></div><div><dt>Vencedor</dt><dd>{jogo.vencedor?.clube.nome ?? "Nenhum vencedor"}</dd></div><div><dt>Jogo</dt><dd>{jogo.id}</dd></div></dl><p className={controles.ajuda}>O recibo fica apenas nesta tela. Correções posteriores devem ser solicitadas ao presidente.</p></section>;
}

export function SenhaDesignada({ bloqueado, enviando, erro, gerir, revalidar }: { bloqueado: boolean; enviando: boolean; erro: string; gerir: (trocar: boolean) => Promise<SenhaArbitragem | null>; revalidar: () => Promise<boolean> }) {
  const [senha, setSenha] = useState<SenhaArbitragem | null>(null);
  const [trocar, setTrocar] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [contaConfirmada, setContaConfirmada] = useState(false);
  const voltar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let atual = true;
    api<Sessao>("/sessao").then(conta => {
      if (atual) setContaConfirmada(conta.usuario.aprovado && ["atleta", "tecnico"].includes(conta.usuario.perfil));
    }).catch(() => { if (atual) { setContaConfirmada(false); void revalidar(); } });
    return () => { atual = false; };
  }, [revalidar]);
  async function consultar(renovar: boolean) {
    setSenha(null);
    const resposta = await gerir(renovar);
    if (resposta) { setSenha(resposta); setTrocar(false); }
  }
  function fechar() { setSenha(null); setTrocar(false); setAberto(false); }
  if (!contaConfirmada) return null;
  return <><button className={controles.secundario} disabled={bloqueado} onClick={() => setAberto(true)}>Senha compartilhada</button>
    <Dialogo aberto={aberto} aoFechar={fechar} tituloId="titulo-senha-jogo" focoInicial={voltar} bloqueado={enviando}><div className={styles.dialogo}>
      <h2 id="titulo-senha-jogo" className={pagina.detalheNome}>Senha compartilhada</h2><p className={pagina.texto}>Disponível pela sua conta designada. A conta será confirmada antes da consulta ou troca.</p>
      {trocar ? <><p className={controles.nota}>Trocar a senha encerra imediatamente todos os acessos por senha. As sessões por designação permanecem. Avise quem precisa continuar no jogo.</p><button className={controles.rejeitar} disabled={bloqueado} onClick={() => { void consultar(true); }}>Confirmar troca da senha</button></>
        : <><button className={controles.primario} disabled={bloqueado} onClick={() => { void consultar(false); }}>Consultar senha atual</button>{senha && <div className={styles.resumo}><p className={controles.ajuda}>Compartilhe somente com a equipe de arbitragem.</p><p className={styles.senha}>{senha.senha}</p><button className={controles.secundario} onClick={() => setSenha(null)} disabled={enviando}>Ocultar senha</button></div>}<button className={controles.rejeitar} disabled={bloqueado} onClick={() => { setSenha(null); setTrocar(true); voltar.current?.focus(); }}>Trocar senha</button></>}
      {erro && <p className={controles.erro} role="alert">{erro}</p>}<button ref={voltar} className={controles.secundario} disabled={enviando} onClick={() => trocar ? setTrocar(false) : fechar()}>Voltar</button>
    </div></Dialogo></>;
}
