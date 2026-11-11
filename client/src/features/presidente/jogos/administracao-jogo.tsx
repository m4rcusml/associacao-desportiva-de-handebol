"use client";

import { useState, type FormEvent, type RefObject } from "react";
import { api } from "../../../lib/api";
import type { ArbitragemDesignada, DetalheJogo, SenhaArbitragem, SolicitacaoVerificacao } from "../../../lib/presidente";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { data, ModalJogo, useOperacaoJogo, type AoAlterar } from "./apoio";
import styles from "./jogo.module.css";
import { LinkArbitragem } from "./link-tecnico";

type Acao = { tipo: "designar" | "adiar" | "cancelar" | "trocar-senha" } | { tipo: "remover"; arbitragem: ArbitragemDesignada };
const TITULOS = { designar: "Designar arbitragem", adiar: "Adiar jogo", cancelar: "Cancelar jogo?", "trocar-senha": "Trocar a senha da arbitragem?", remover: "Retirar designação?" };

export function AdministracaoJogo({ jogo, pessoas, atualizar, focoAlternativo }: {
  jogo: DetalheJogo; pessoas: SolicitacaoVerificacao[]; atualizar: AoAlterar; focoAlternativo: RefObject<HTMLElement | null>;
}) {
  const [acao, setAcao] = useState<Acao | null>(null);
  const [metodo, setMetodo] = useState("conta");
  const [semData, setSemData] = useState(false);
  const [senha, setSenha] = useState<SenhaArbitragem | null>(null);
  const [carregandoSenha, setCarregandoSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState("");
  const tratarErro = useErroApi();
  const operacao = useOperacaoJogo(atualizar);
  const podeDesignar = jogo.status === "agendado" || jogo.status === "em_andamento";
  const candidatos = pessoas.filter(p => p.ativo && p.statusVerificacao === "aprovado"
    && p.clube?.id !== jogo.clubeA.clube.id && p.clube?.id !== jogo.clubeB.clube.id
    && !jogo.arbitragens.some(a => a.usuario?.id === p.usuarioId));

  function abrir(nova: Acao) {
    operacao.limparErro();
    setMetodo(candidatos.length ? "conta" : "externo");
    setSemData(!jogo.inicioPrevistoLocal);
    setAcao(nova);
  }

  async function mostrarSenha() {
    if (carregandoSenha) return;
    setCarregandoSenha(true);
    setErroSenha("");
    try { setSenha(await api<SenhaArbitragem>(`/jogos/${jogo.id}/arbitragem/senha`)); }
    catch (error) { setErroSenha(tratarErro(error)); }
    finally { setCarregandoSenha(false); }
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!acao) return;
    const form = new FormData(evento.currentTarget);
    const base = `/jogos/${jogo.id}`;
    let path: string;
    let body: unknown = {};
    let mensagem: string;
    let metodoHttp: "POST" | "DELETE" = "POST";
    switch (acao.tipo) {
      case "designar":
        path = `${base}/arbitragens`;
        body = metodo === "conta" ? { usuarioId: form.get("usuarioId") } : { nomeCompleto: String(form.get("nomeCompleto")).trim() };
        mensagem = "Arbitragem designada.";
        break;
      case "remover":
        path = `${base}/arbitragens/${acao.arbitragem.id}`;
        body = undefined;
        metodoHttp = "DELETE";
        mensagem = "Designação retirada.";
        break;
      case "adiar":
        path = `${base}/adiamento`;
        body = { inicioPrevisto: semData ? null : form.get("inicioPrevisto"), fusoHorario: String(form.get("fusoHorario")).trim(), ...(String(form.get("local")).trim() ? { local: String(form.get("local")).trim() } : {}) };
        mensagem = "Jogo adiado. Os acessos temporários foram encerrados.";
        break;
      case "cancelar": path = `${base}/cancelamento`; mensagem = "Jogo cancelado. Os acessos temporários foram encerrados."; break;
      case "trocar-senha": path = `${base}/arbitragem/senha/troca`; mensagem = "Senha trocada. Os acessos pela senha anterior foram encerrados."; break;
    }
    if (await operacao.executar(path, body, mensagem, metodoHttp)) {
      if (acao.tipo === "adiar" || acao.tipo === "cancelar" || acao.tipo === "trocar-senha") setSenha(null);
      setAcao(null);
    }
  }

  return <>
    <section className={pagina.secao} aria-labelledby="arbitragem-titulo">
      <div className={pagina.secaoTopo}>
        <h2 id="arbitragem-titulo" className={pagina.secaoTitulo}>Arbitragem</h2>
        {podeDesignar && <button type="button" className={jogo.status === "em_andamento" ? controles.secundario : controles.primario} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "designar" })}>Designar arbitragem</button>}
      </div>
      {jogo.arbitragens.length === 0 ? <p className={pagina.secaoTexto}>Nenhuma pessoa designada para a arbitragem.</p> : <ul className={styles.lista}>
        {jogo.arbitragens.map(a => <li className={styles.item} key={a.id}>
          <p className={styles.nome}>{a.usuario?.nomeCompleto ?? a.nomeCompleto ?? "Nome indisponível"}</p>
          <span className={styles.meta}>{a.tipo === "cadastrado" ? "Conta cadastrada" : a.tipo === "externo" ? "Pessoa sem cadastro" : "Entrada por senha"}{a.visualizacao ? ` · ${a.visualizacao === "banco" ? "Mesa" : "Linha"}` : ""}</span>
          <span className={styles.meta}>{a.acessouEm ? `Acessou em ${data(a.acessouEm, jogo.fusoHorario)}` : "Ainda não acessou"}</span>
          {podeDesignar && a.tipo !== "entrada_por_senha" && <div className={styles.acoes}><button type="button" className={controles.rejeitar} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "remover", arbitragem: a })}>Retirar designação</button></div>}
        </li>)}
      </ul>}
      {podeDesignar && <>
        <LinkArbitragem jogoId={jogo.id} />
        <h3 className={pagina.subtitulo}>Acesso por senha do jogo</h3>
        <p className={pagina.secaoTexto}>A primeira consulta gera a senha. Compartilhe somente com os responsáveis pela arbitragem.</p>
        <div className={styles.acoes}>
          {senha ? <button type="button" className={controles.secundario} onClick={() => setSenha(null)}>Ocultar senha</button> : <button type="button" className={controles.secundario} disabled={carregandoSenha || operacao.ocupado} onClick={mostrarSenha}>{carregandoSenha ? "Consultando senha…" : "Mostrar senha"}</button>}
          <button type="button" className={controles.rejeitar} disabled={operacao.ocupado || carregandoSenha} onClick={() => abrir({ tipo: "trocar-senha" })}>Trocar senha</button>
        </div>
        {senha && <p className={styles.senha} aria-label="Senha do jogo">{senha.senha}</p>}
        {erroSenha && <p role="alert" className={`${controles.erro} ${styles.erro}`}>{erroSenha}</p>}
        <p className={`${controles.nota} ${styles.nota}`}>Entradas por senha não têm retirada individual. Trocar a senha encerra todas elas e preserva os acessos por designação.</p>
      </>}
    </section>

    {jogo.status === "agendado" && <section className={`${pagina.secao} ${styles.secao}`} aria-labelledby="agenda-titulo">
      <h2 id="agenda-titulo" className={pagina.secaoTitulo}>Agenda do jogo</h2>
      <p className={pagina.secaoTexto}>O adiamento preserva a escalação e os credenciamentos. Adiar ou cancelar encerra os acessos temporários abertos.</p>
      <div className={styles.acoes}>
        <button type="button" className={controles.secundario} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "adiar" })}>Adiar jogo</button>
        <button type="button" className={controles.rejeitar} disabled={operacao.ocupado} onClick={() => abrir({ tipo: "cancelar" })}>Cancelar jogo</button>
      </div>
    </section>}

    <ModalJogo aberto={!!acao} fechar={() => setAcao(null)} titulo={acao ? TITULOS[acao.tipo] : ""} focoAlternativo={focoAlternativo} ocupado={operacao.ocupado}>
      {acao && <form className={styles.formulario} onSubmit={enviar}>
        {acao.tipo === "designar" && <>
          <div className={controles.campo}><label className={controles.rotulo} htmlFor="designacao-metodo">Pessoa da arbitragem</label><select id="designacao-metodo" className={controles.entrada} value={metodo} onChange={e => setMetodo(e.target.value)}><option value="conta">Conta cadastrada</option><option value="externo">Pessoa sem cadastro</option></select></div>
          {metodo === "conta" ? <div className={controles.campo}><label className={controles.rotulo} htmlFor="designacao-conta">Atleta ou técnico</label><select id="designacao-conta" name="usuarioId" className={controles.entrada} required defaultValue=""><option value="" disabled>Selecione uma pessoa</option>{candidatos.map(p => <option value={p.usuarioId} key={p.usuarioId}>{p.nomeCompleto} · {p.perfil === "atleta" ? "Atleta" : "Técnico"} · {p.clube?.nome ?? "Sem clube"}</option>)}</select>{!candidatos.length && <p className={controles.ajuda}>Não há contas aprovadas e ativas disponíveis sem vínculo com os clubes deste jogo.</p>}</div>
            : <div className={controles.campo}><label className={controles.rotulo} htmlFor="designacao-nome">Nome completo</label><input id="designacao-nome" name="nomeCompleto" className={controles.entrada} minLength={2} maxLength={120} required autoComplete="off" /></div>}
        </>}
        {acao.tipo === "remover" && <p className={styles.texto}>Retirar a designação de {acao.arbitragem.usuario?.nomeCompleto ?? acao.arbitragem.nomeCompleto}? Os acessos que dependem desta designação serão encerrados.</p>}
        {acao.tipo === "adiar" && <>
          <label className={styles.checkbox}><input type="checkbox" checked={semData} onChange={e => setSemData(e.target.checked)} />Deixar o jogo sem nova data</label>
          {!semData && <div className={controles.campo}><label className={controles.rotulo} htmlFor="adiamento-inicio">Nova data e hora local</label><input id="adiamento-inicio" className={controles.entrada} name="inicioPrevisto" type="datetime-local" defaultValue={jogo.inicioPrevistoLocal?.slice(0, 16) ?? ""} required /></div>}
          <div className={controles.campo}><label className={controles.rotulo} htmlFor="adiamento-fuso">Fuso horário do local</label><input id="adiamento-fuso" className={controles.entrada} name="fusoHorario" defaultValue={jogo.fusoHorario} maxLength={64} required /><p className={controles.ajuda}>Exemplo: America/Sao_Paulo. A hora acima corresponde a esse fuso.</p></div>
          <div className={controles.campo}><label className={controles.rotulo} htmlFor="adiamento-local">Local</label><input id="adiamento-local" className={controles.entrada} name="local" defaultValue={jogo.local ?? ""} maxLength={160} /><p className={controles.ajuda}>Deixe vazio para manter o local atual.</p></div>
          <p className={controles.nota}>A senha existente será renovada e todos os acessos temporários serão encerrados.</p>
        </>}
        {acao.tipo === "cancelar" && <p className={controles.nota}>O jogo será cancelado e os acessos temporários serão encerrados. Ele não contará para o cumprimento de suspensões.</p>}
        {acao.tipo === "trocar-senha" && <p className={controles.nota}>Os dispositivos que entraram pela senha atual perderão acesso. As sessões por designação serão preservadas.</p>}
        {operacao.erro && <p role="alert" className={controles.erro}>{operacao.erro}</p>}
        <div className={pagina.acoes}>
          <button type="submit" className={acao.tipo === "remover" || acao.tipo === "cancelar" || acao.tipo === "trocar-senha" ? controles.rejeitar : controles.primario} disabled={operacao.ocupado || (acao.tipo === "designar" && metodo === "conta" && !candidatos.length)}>{operacao.ocupado ? "Salvando…" : acao.tipo === "designar" ? "Confirmar designação" : acao.tipo === "adiar" ? "Confirmar adiamento" : acao.tipo === "remover" ? "Retirar designação" : acao.tipo === "cancelar" ? "Confirmar cancelamento" : "Confirmar troca de senha"}</button>
          <button type="button" className={controles.secundario} disabled={operacao.ocupado} onClick={() => setAcao(null)}>Voltar</button>
        </div>
      </form>}
    </ModalJogo>
  </>;
}
