"use client";

import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { IMPEDIMENTOS, TIPOS_LANCAMENTO, type DadosArbitragem, type LeituraQr, type Visualizacao } from "../../lib/arbitragem";
import { horarioJogo } from "../../lib/area-pessoal";
import { Dialogo } from "../ui/dialogo";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import { AtletaDialogo, LancamentoDialogo, type Participante } from "./operacoes";
import { CameraQr } from "./camera-qr";
import { CicloJogo, SenhaDesignada } from "./ciclo";
import { CabecalhoArbitragem } from "./cabecalho";
import { RegistroDireto } from "./registro-direto";
import type { Intencao, useArbitragem } from "./use-arbitragem";
import styles from "./arbitragem.module.css";

type Controle = ReturnType<typeof useArbitragem>;
type Aba = "registro" | "atletas" | "sumula" | "opcoes";

export function OperacaoJogo({ dados, controle, feedback }: { dados: DadosArbitragem; controle: Controle; feedback: ReactNode }) {
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<Aba>(dados.sessao.jogo.status === "agendado" ? "atletas" : "registro");
  const [clubeAtivo, setClubeAtivo] = useState(dados.atletas.clubes[0]?.inscricaoId ?? "");
  const [filtro, setFiltro] = useState<"todos" | "conferir" | "escalados" | "credenciados">("todos");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [registroId, setRegistroId] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [qr, setQr] = useState<{ token: string; leitura: LeituraQr } | null>(null);
  const [conferirQr, setConferirQr] = useState(false);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [tokenSelecionado, setTokenSelecionado] = useState<string | undefined>();
  const [leituraSelecionada, setLeituraSelecionada] = useState<LeituraQr | undefined>();
  const voltarQr = useRef<HTMLButtonElement>(null);
  const conteudo = useRef<HTMLHeadingElement>(null);
  const jogo = dados.sessao.jogo;
  const modo = dados.sessao.arbitragem.visualizacao ?? "banco";
  const pessoas: Participante[] = dados.atletas.clubes.flatMap(c => c.atletas.map(a => ({ ...a, inscricaoId: c.inscricaoId, clube: c.clube })));
  const pessoa = pessoas.find(p => p.atleta.id === selecionado) ?? (qr && selecionado === qr.leitura.atleta.id && qr.leitura.clube ? { atleta: qr.leitura.atleta, escalado: false, credenciamento: qr.leitura.credenciamento, impedimento: qr.leitura.impedimento, ...qr.leitura.clube } : null);
  const registro = dados.registros.lancamentos.find(l => l.id === registroId) ?? null;
  const propOperacoes = { dados, bloqueado: controle.bloqueado, enviando: controle.enviando, erro: controle.erro, executar: controle.executar, fotoSemAcesso: controle.fotoSemAcesso };
  function fecharAtleta() { setSelecionado(null); setTokenSelecionado(undefined); setLeituraSelecionada(undefined); setQr(null); }
  function selecionar(p: Participante) { setSelecionado(p.atleta.id); setTokenSelecionado(undefined); setLeituraSelecionada(undefined); }
  async function lerQr(token: string) {
    setCamera(false);
    const leitura = await controle.ler<LeituraQr>("/leitura-qr", { tokenQr: token });
    if (leitura) { setQr({ token, leitura }); setConferirQr(true); }
  }
  function usarLeitura() {
    if (!qr?.leitura.clube) return;
    setSelecionado(qr.leitura.atleta.id); setTokenSelecionado(qr.token); setLeituraSelecionada(qr.leitura); setConferirQr(false);
  }
  async function alterarModo(visualizacao: Visualizacao) {
    if (modo === visualizacao) return;
    await controle.executar({ caminho: "/visualizacao", metodo: "PUT", corpo: { visualizacao }, sucesso: "Visualização alterada. Todas as ações continuam disponíveis." });
  }
  async function executarCiclo(intencao: Intencao) {
    const salvo = await controle.executar(intencao);
    if (salvo && intencao.caminho === "/inicio") setAba("registro");
    return salvo;
  }
  function navegar(destino: Aba) { setAba(destino); requestAnimationFrame(() => conteudo.current?.focus()); }
  const placar = dados.registros.placar;
  const lancamentos = dados.registros.lancamentos.filter(l => mostrarHistorico || !l.anuladoEm).toReversed();
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const status = jogo.status === "agendado" ? "Antes do início" : jogo.interrompidoEm ? "Partida interrompida" : "Em andamento";
  const titulo = { registro: "Registro do jogo", atletas: jogo.status === "agendado" ? "Conferir os atletas" : "Atletas do jogo", sumula: "Súmula do jogo", opcoes: "Opções do jogo" }[aba];

  return <>
    <CabecalhoArbitragem titulo={modo === "banco" ? "Mesa do jogo" : "Arbitragem"} conexao={controle.sincronizado ? "Conectado" : "Conferir conexão"}>
      <div className={styles.acoesCabecalho}><button type="button" className={controles.secundario} onClick={() => navegar("atletas")}>Credenciar</button><button type="button" className={controles.secundario} onClick={() => navegar("opcoes")}>Opções</button></div>
    </CabecalhoArbitragem>
    <div className={styles.principal}>
      {feedback}
      <div className={styles.placarCompacto} aria-label={`Placar oficial. ${jogo.clubeA.clube.nome}: ${placar?.placarClubeA ?? "disponível após início"}. ${jogo.clubeB.clube.nome}: ${placar?.placarClubeB ?? "disponível após início"}.`}>
        <strong className={styles.nomePlacarA}>{jogo.clubeA.clube.nome}</strong><div className={styles.numerosPlacar}><strong>{placar?.placarClubeA ?? "—"}</strong><span>×</span><strong>{placar?.placarClubeB ?? "—"}</strong></div><strong className={styles.nomePlacarB}>{jogo.clubeB.clube.nome}</strong>
      </div>
      <h1 ref={conteudo} tabIndex={-1} className={aba === "registro" ? styles.somenteLeitor : pagina.titulo}>{titulo}</h1>
      {(!controle.sincronizado || jogo.interrompidoEm) && <div className={styles.comunicado}><p className={controles.nota}>{jogo.interrompidoEm ? "Partida interrompida. Novos gols, penalidades e entradas aguardam a retomada. Credenciamento, camisas, estornos elegíveis e correções continuam disponíveis." : `${controle.conexao} As ações ficam bloqueadas até conferir os dados no servidor. Não há modo offline.`}</p><button type="button" className={controles.secundario} disabled={controle.enviando || controle.atualizando} onClick={() => { void controle.atualizar(); }}>{controle.atualizando ? "Atualizando…" : "Atualizar dados"}</button></div>}
      {aba === "registro" && <RegistroDireto dados={dados} bloqueado={controle.bloqueado} enviando={controle.enviando} erro={controle.erro} pendente={!!controle.pendente} confirmacaoLancamento={controle.confirmacaoLancamento} executar={controle.executar} abrirSumula={() => navegar("sumula")} />}
      {aba === "atletas" && <section className={styles.operacao}>
        <p className={controles.ajuda}>Escalação é a escolha do técnico. Credenciamento é a conferência da arbitragem. Entrada registrada indica que o atleta entrou ao menos uma vez, sem informar presença atual em quadra.</p>
        <button type="button" className={controles.primario} disabled={controle.bloqueado} onClick={() => setCamera(true)}>Ler QR da carteirinha</button><p className={controles.ajuda}>Sem câmera? Selecione o atleta na lista.</p>
        <div className={styles.seletorClubes} role="group" aria-label="Clube para conferir">{dados.atletas.clubes.map(c => <button type="button" key={c.inscricaoId} className={controles.opcao} aria-pressed={clubeAtivo === c.inscricaoId} onClick={() => setClubeAtivo(c.inscricaoId)}>{c.clube.nome}</button>)}</div>
        <label className={controles.campo}><span className={controles.rotulo}>Buscar atleta ou camisa</span><input type="search" className={controles.entrada} placeholder="Nome ou número" value={busca} onChange={e => setBusca(e.target.value)} /></label>
        <div className={styles.acoes} role="group" aria-label="Filtrar atletas">{([["todos", "Todos"], ["conferir", "A conferir"], ["escalados", "Escalados"], ["credenciados", "Credenciados"]] as const).map(([valor, nome]) => <button type="button" key={valor} className={controles.opcao} aria-pressed={filtro === valor} onClick={() => setFiltro(valor)}>{nome}</button>)}</div>
        {dados.atletas.clubes.filter(c => c.inscricaoId === clubeAtivo).map(c => {
          const visiveis = c.atletas.filter(a => (filtro !== "escalados" || a.escalado) && (filtro !== "credenciados" || a.credenciamento) && (filtro !== "conferir" || !a.credenciamento) && (!termo || a.atleta.nomeCompleto.toLocaleLowerCase("pt-BR").includes(termo) || String(a.credenciamento?.numeroCamisa ?? "").includes(termo)));
          return <div key={c.inscricaoId}><p className={controles.ajuda}>{c.atletas.filter(a => a.credenciamento).length} credenciados · {c.atletas.filter(a => a.credenciamento?.entrouEmQuadraEm).length} com entrada registrada</p>
            {visiveis.length ? <ul className={styles.listaAtletas}>{visiveis.map(a => <li key={a.atleta.id}><button type="button" className={styles.atleta} disabled={controle.enviando || !!controle.pendente} onClick={() => selecionar({ ...a, inscricaoId: c.inscricaoId, clube: c.clube })} aria-label={`${a.atleta.nomeCompleto}, ${a.credenciamento ? `camisa ${a.credenciamento.numeroCamisa}` : "não credenciado"}, ${c.clube.nome}`}>
              <span className={styles.numeroLista}>{a.credenciamento?.numeroCamisa ?? "—"}</span><span className={styles.identidade}><strong>{a.atleta.nomeCompleto}</strong><span className={styles.etapas}>{a.credenciamento ? `Credenciado · ${a.credenciamento.entrouEmQuadraEm ? "entrada registrada" : "entrada não registrada"}` : a.escalado ? "Escalado · falta credenciar" : "Não escalado · conferir elegibilidade"}</span>{a.impedimento && <span className={controles.textoAlerta}>{IMPEDIMENTOS[a.impedimento]}</span>}</span><Image src="/arbitragem/chevron.svg" alt="" width={20} height={20} />
            </button></li>)}</ul> : <p className={pagina.texto}>Nenhum atleta neste filtro.</p>}
          </div>;
        })}
        {jogo.status === "agendado" && <CicloJogo sessao={dados.sessao} placar={placar} bloqueado={controle.bloqueado} enviando={controle.enviando} erro={controle.erro} executar={executarCiclo} suspenso={!!controle.pendente} />}
      </section>}
      {aba === "sumula" && <section className={styles.operacao}>
        <div className={styles.faixa}><p className={controles.ajuda}>Mais recentes primeiro. O original permanece no histórico.</p><label className={styles.checkbox}><input type="checkbox" checked={mostrarHistorico} onChange={e => setMostrarHistorico(e.target.checked)} />Incluir anulados e substituídos</label></div>
        <button type="button" className={controles.secundario} disabled={controle.enviando || controle.atualizando} onClick={() => { void controle.atualizar(); }}>{controle.atualizando ? "Atualizando…" : "Atualizar súmula"}</button>
        {lancamentos.length ? <ul className={styles.lista}>{lancamentos.map(l => <li key={l.id} className={`${styles.registro} ${l.anuladoEm ? styles.anulado : ""}`}><p><strong>{TIPOS_LANCAMENTO[l.tipo]}</strong>{l.tipo === "cartaoVermelho" ? (l.relatorioDisciplinar ? " · Com relatório disciplinar (azul)" : " · Sem relatório disciplinar") : ""} · {l.anuladoEm ? l.substituidoPorId ? "Substituído" : "Anulado" : "Vigente"}</p><p>{l.atleta?.nomeCompleto ?? "Atleta indisponível"} · Camisa {l.numeroCamisa ?? "—"} · {dados.atletas.clubes.find(c => c.inscricaoId === l.inscricaoId)?.clube.nome ?? "Clube indisponível"}</p><p className={controles.ajuda}>{horarioJogo(l.registradoEm, jogo.fusoHorario)}{l.substituiLancamentoId ? " · Correção de um lançamento anterior" : ""}</p>{l.substituidoPorId && <p className={controles.ajuda}>Substituto: {l.substituidoPorId}</p>}{!l.anuladoEm && <button type="button" className={controles.secundario} disabled={controle.bloqueado} onClick={() => setRegistroId(l.id)}>Corrigir ou anular</button>}</li>)}</ul> : <p className={pagina.texto}>{jogo.status === "agendado" ? "O registro de gols e penalidades abre ao iniciar o jogo." : "Nenhum lançamento neste filtro."}</p>}
      </section>}
      {aba === "opcoes" && <section className={styles.operacao}>
        <p className={controles.ajuda}>{dados.sessao.arbitragem.nomeCompleto} · {dados.sessao.sessao.metodoEntrada === "senha" ? "Acesso por senha" : "Conta designada"}. Este acesso vale somente para este jogo.</p>
        <div className={styles.acoes} role="group" aria-label="Visualização"><button type="button" className={controles.opcao} aria-pressed={modo === "banco"} disabled={controle.bloqueado} onClick={() => { void alterarModo("banco"); }}>Mesa</button><button type="button" className={controles.opcao} aria-pressed={modo === "linha"} disabled={controle.bloqueado} onClick={() => { void alterarModo("linha"); }}>Linha</button></div><p className={controles.ajuda}>As mesmas ações estão disponíveis nas duas visualizações.</p>
        <CicloJogo sessao={dados.sessao} placar={placar} bloqueado={controle.bloqueado} enviando={controle.enviando} erro={controle.erro} executar={executarCiclo} suspenso={!!controle.pendente} />
        {dados.sessao.sessao.metodoEntrada === "designacao" && dados.sessao.podeGerirSenhaPelaConta && <SenhaDesignada bloqueado={controle.bloqueado} enviando={controle.enviando} erro={controle.erro} gerir={controle.gerirSenha} revalidar={controle.atualizar} />}
        <button type="button" className={controles.secundario} disabled={controle.enviando || controle.atualizando} onClick={() => { void controle.atualizar(); }}>{controle.atualizando ? "Atualizando…" : "Atualizar dados do jogo"}</button>
      </section>}
      <footer className={styles.contextoJogo}><p>{status} · {jogo.local ?? "Local não informado"}</p><p>{horarioJogo(jogo.inicioPrevistoEm, jogo.fusoHorario)} ({jogo.fusoHorario})</p></footer>
      <nav className={styles.navegacao} aria-label="Áreas da arbitragem">{([["registro", "Jogo"], ["atletas", "Credenciar"], ["sumula", "Súmula"], ["opcoes", "Opções"]] as const).map(([destino, rotulo]) => <button key={destino} type="button" aria-current={aba === destino ? "page" : undefined} onClick={() => navegar(destino)}>{rotulo}</button>)}</nav>
    </div>
    <CameraQr ativo={camera && !controle.bloqueado} aoLer={token => { void lerQr(token); }} aoCancelar={() => setCamera(false)} />
    <Dialogo aberto={conferirQr && !!qr} aoFechar={() => { setConferirQr(false); if (!selecionado) setQr(null); }} tituloId="titulo-leitura-qr" focoInicial={voltarQr} bloqueado={controle.enviando}><div className={styles.dialogo}><h2 id="titulo-leitura-qr" className={pagina.detalheNome}>Carteirinha identificada</h2>{qr && <><div className={styles.resumo}><h3>{qr.leitura.atleta.nomeCompleto}</h3><p>{qr.leitura.clube?.clube.nome ?? "Sem clube deste jogo"}</p><p>Carteirinha {qr.leitura.carteirinha.codigo}: {qr.leitura.carteirinha.status === "ativa" ? "ativa" : "invalidada"}</p>{qr.leitura.credenciamento && <p>Já credenciado · Camisa {qr.leitura.credenciamento.numeroCamisa}</p>}</div><p className={controles.ajuda}>A leitura somente identifica. Confira o atleta e a camisa antes de confirmar o credenciamento.</p>{qr.leitura.impedimento && <p className={controles.nota}>{IMPEDIMENTOS[qr.leitura.impedimento]}</p>}<button type="button" className={controles.primario} disabled={controle.bloqueado || !qr.leitura.clube || (!!qr.leitura.impedimento && !qr.leitura.credenciamento)} onClick={usarLeitura}>{qr.leitura.credenciamento ? "Conferir credenciamento existente" : "Informar camisa e revisar"}</button></>}<button ref={voltarQr} type="button" className={controles.secundario} disabled={controle.enviando} onClick={() => { setConferirQr(false); setQr(null); }}>Voltar</button></div></Dialogo>
    <AtletaDialogo pessoa={!controle.pendente ? pessoa : null} tokenQr={tokenSelecionado} leitura={leituraSelecionada} {...propOperacoes} fechar={fecharAtleta} />
    <LancamentoDialogo lancamento={!controle.pendente ? registro : null} {...propOperacoes} fechar={() => setRegistroId(null)} />
  </>;
}
