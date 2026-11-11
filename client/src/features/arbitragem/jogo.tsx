"use client";

import Link from "next/link";
import { idJogo } from "../../lib/arbitragem";
import controles from "../ui/controles.module.css";
import pagina from "../ui/pagina.module.css";
import { CabecalhoArbitragem } from "./cabecalho";
import { ReciboEncerramento } from "./ciclo";
import { EntradaArbitragem } from "./entrada";
import { OperacaoJogo } from "./operacao-jogo";
import { useArbitragem } from "./use-arbitragem";
import styles from "./arbitragem.module.css";

export function JogoArbitragem({ id }: { id: string }) {
  return idJogo(id, "http://localhost") === id ? <JogoValido key={id} id={id} /> : <><CabecalhoArbitragem /><div className={`${styles.estreito} ${styles.pilha}`}><h1 className={pagina.titulo}>Identificador inválido</h1><p className={pagina.texto}>Confira o link enviado pela organização.</p><Link href="/arbitragem" className={controles.secundario}>Abrir outro jogo</Link></div></>;
}

function JogoValido({ id }: { id: string }) {
  const controle = useArbitragem(id);
  const { dados, estado } = controle;
  const feedback = (controle.erro || controle.aviso || controle.pendente) ? <div className={styles.comunicado}>
    {controle.erro && <p className={controles.erro} role="alert">{controle.erro}</p>}
    {controle.aviso && <p className={styles.sucesso} role="status">{controle.aviso}</p>}
    {controle.pendente && <div className={styles.pilha}>
      <h2 className={pagina.secaoTitulo}>Envio não confirmado</h2><p className={controles.nota}>A operação pode ter sido gravada. Reenviar conserva o mesmo conteúdo e identificador. Novas ações ficam bloqueadas até resolver ou abandonar esta tentativa.</p>
      <div className={styles.acoes}><button type="button" className={controles.primario} disabled={controle.enviando || (controle.pendente.tipo !== "encerramento" && !controle.sincronizado)} onClick={() => { if (controle.pendente) void controle.executar(controle.pendente, true); }}>{controle.enviando ? "Enviando…" : "Reenviar a mesma operação"}</button><button type="button" className={controles.secundario} disabled={controle.enviando || controle.atualizando} onClick={() => { void controle.atualizar(); }}>Consultar estado no servidor</button><button type="button" className={controles.discreto} disabled={controle.enviando} onClick={controle.abandonar}>Abandonar esta tentativa</button></div>
    </div>}
  </div> : null;

  if (estado === "ativo" && dados && !controle.recibo) return <OperacaoJogo dados={dados} controle={controle} feedback={feedback} />;
  return <><CabecalhoArbitragem /><div className={styles.principal}>{feedback}
    {controle.recibo ? <><ReciboEncerramento recibo={controle.recibo} /><Link className={controles.secundario} href="/arbitragem">Sair do recibo</Link></>
      : estado === "consultando" ? <p role="status" className={pagina.carregando}>Conferindo acesso a este jogo…</p>
        : estado === "encerrado" ? <div className={`${styles.estreito} ${styles.pilha}`}><h1 className={pagina.titulo}>Seu acesso terminou</h1><p className={controles.nota}>{controle.motivo}</p><p className={controles.ajuda}>Os dados privados do jogo deixam de aparecer nesta tela.</p>{controle.pendente?.tipo === "encerramento" && <p className={pagina.texto}>O encerramento pode ter sido gravado. Reenvie a mesma operação acima para recuperar a confirmação oficial.</p>}{!controle.pendente && <button type="button" className={controles.primario} onClick={controle.prepararEntrada} disabled={controle.enviando}>Voltar à entrada</button>}<Link href="/arbitragem" className={controles.secundario}>Abrir outro jogo</Link></div>
          : <><EntradaArbitragem jogoId={id} enviando={controle.enviando} entrar={controle.entrar} /><div className={styles.estreito}>{controle.motivo && <p className={controles.ajuda}>{controle.motivo}</p>}<button type="button" className={controles.discreto} disabled={controle.enviando || controle.atualizando} onClick={() => { void controle.atualizar(true); }}>{controle.atualizando ? "Consultando…" : "Conferir acesso novamente"}</button></div></>}
  </div></>;
}
