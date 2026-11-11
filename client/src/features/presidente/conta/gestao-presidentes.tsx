"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../../lib/api";
import { consultarSolicitacoes, type SolicitacaoVerificacao } from "../../../lib/presidente";
import { Confirmacao } from "../../ui/confirmacao";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { useSessaoPresidente } from "../shell";
import { ehUuid, type ReferenciaPresidente } from "./referencias-locais";
import styles from "./conta.module.css";

type Operacao = "desativacao" | "reativacao";
type ResultadoAtivacao = { usuario: { id: string; perfil: string; ativo: boolean }; alterado: boolean };
/** Pedido em confirmação: `nome` é só a referência local, nunca confirmada pelo servidor. */
type Pedido = { id: string; nome: string | null; operacao: Operacao };
/** Resposta do servidor nesta visita à página; não é guardada no navegador. */
type Confirmado = { ativo: boolean; perfil: string; em: Date };
/** `chave`: ID da linha da lista ou "informado" para o campo de ID. */
type Bloqueio = { chave: string; conteudo: ReactNode };
type Pessoas = { tipo: "carregando" } | { tipo: "falha"; mensagem: string } | { tipo: "pronto"; porId: Map<string, SolicitacaoVerificacao> };

const PERFIL: Record<string, string> = { atleta: "atleta", tecnico: "técnico", presidente: "presidente" };
const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Desativa ou reativa contas de presidentes (`POST /contas/:id/desativacao|reativacao`). Sem listagem de
 * presidentes na API, os alvos são os criados neste navegador ou um ID informado. A API aceita qualquer conta,
 * então a tela bloqueia a própria conta e IDs de atletas e técnicos conhecidos (esses vão para Pessoas).
 */
export function GestaoPresidentes({ referencias, guardadas, aoEsquecer }: {
  referencias: ReferenciaPresidente[];
  /** false quando o navegador não permitiu gravar a lista local. */
  guardadas: boolean;
  aoEsquecer: (id: string) => void;
}) {
  const { sessao } = useSessaoPresidente();
  const tratarErro = useErroApi();
  const [pessoas, setPessoas] = useState<Pessoas>({ tipo: "carregando" });
  const [idInformado, setIdInformado] = useState("");
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [confirmados, setConfirmados] = useState<Record<string, Confirmado>>({});
  const emAndamento = useRef(false);
  const campoId = useRef<HTMLInputElement>(null);

  const carregarPessoas = useCallback(() => {
    consultarSolicitacoes()
      .then(lista => setPessoas({ tipo: "pronto", porId: new Map(lista.map(p => [p.usuarioId.toLowerCase(), p])) }))
      .catch(falha => setPessoas({ tipo: "falha", mensagem: tratarErro(falha) }));
  }, [tratarErro]);

  useEffect(carregarPessoas, [carregarPessoas]);

  function recarregarPessoas() {
    setPessoas({ tipo: "carregando" });
    carregarPessoas();
  }

  /** Motivo para não operar sobre o ID, ou null quando a operação pode ser pedida. */
  function impedimento(id: string): ReactNode | null {
    if (!ehUuid(id)) return "Informe o ID completo da conta: 36 caracteres, com hifens. Confira com quem tem o ID.";
    if (id === sessao.usuario.id.toLowerCase()) return "Este é o ID da sua própria conta. O presidente administra somente outras contas.";
    if (pessoas.tipo !== "pronto") return "Aguarde a consulta de atletas e técnicos terminar para conferir o ID.";
    const pessoa = pessoas.porId.get(id);
    if (pessoa) {
      return (
        <>
          Este ID é de {pessoa.nomeCompleto}, {PERFIL[pessoa.perfil] ?? pessoa.perfil}. Desative ou reative essa conta pela
          ficha em <Link href={`/presidente/pessoas/${pessoa.usuarioId}`}>Pessoas</Link>.
        </>
      );
    }
    return null;
  }

  function pedir(chave: string, idBruto: string, nome: string | null, operacao: Operacao) {
    const id = idBruto.trim().toLowerCase();
    setAviso("");
    const motivo = impedimento(id);
    if (motivo) { setBloqueio({ chave, conteudo: motivo }); return; }
    setBloqueio(null);
    setErro("");
    setPedido({ id, nome, operacao });
  }

  async function confirmar() {
    if (!pedido || emAndamento.current) return;
    emAndamento.current = true;
    setEnviando(true);
    setErro("");
    try {
      const { usuario, alterado } = await api<ResultadoAtivacao>(`/contas/${pedido.id}/${pedido.operacao}`, {});
      setConfirmados(atual => ({ ...atual, [usuario.id.toLowerCase()]: { ativo: usuario.ativo, perfil: usuario.perfil, em: new Date() } }));
      const situacao = usuario.ativo ? "ativa" : "desativada";
      const perfil = PERFIL[usuario.perfil] ?? usuario.perfil;
      setAviso(alterado
        ? `Servidor confirmou: conta ${usuario.id} (${perfil}) ${usuario.ativo ? "reativada. A pessoa precisa entrar novamente." : "desativada. As sessões abertas foram encerradas."}`
        : `Nada mudou: o servidor informou que a conta ${usuario.id} (${perfil}) já estava ${situacao}.`);
      if (pedido.nome === null && usuario.perfil !== "presidente") recarregarPessoas();
      setPedido(null);
      if (pedido.nome === null) setIdInformado("");
    } catch (falha) {
      // 403 (própria conta), 404 (ID inexistente) e 409 (último presidente ativo) chegam com a mensagem do servidor.
      setErro(tratarErro(falha));
    } finally {
      emAndamento.current = false;
      setEnviando(false);
    }
  }

  function botoes(chave: string, id: string, nome: string | null, rotuloAlvo: string) {
    return (
      <>
        <button type="button" className={controles.rejeitar} onClick={() => pedir(chave, id, nome, "desativacao")} aria-label={`Desativar ${rotuloAlvo}`}>Desativar</button>
        <button type="button" className={controles.aprovar} onClick={() => pedir(chave, id, nome, "reativacao")} aria-label={`Reativar ${rotuloAlvo}`}>Reativar</button>
      </>
    );
  }

  const ultimo = (id: string) => {
    const c = confirmados[id];
    if (!c) return null;
    return <span className={pagina.linhaMeta}>Servidor confirmou às {hora.format(c.em)}: {c.ativo ? "ativa" : "desativada"}.</span>;
  };

  const mensagemBloqueio = (chave: string) => bloqueio?.chave === chave && <p className={controles.nota} role="alert">{bloqueio.conteudo}</p>;

  return (
    <section className={pagina.secao} aria-labelledby="secao-presidentes">
      <h2 id="secao-presidentes" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Outros presidentes</h2>
      <p className={pagina.secaoTexto}>
        A API não lista presidentes nem informa a situação das contas. Aqui aparecem só os presidentes criados por você
        neste navegador; para outra conta, informe o ID. Cada operação é confirmada pelo servidor.
      </p>
      {pessoas.tipo === "falha" && (
        <div className={pagina.erroDecisao}>
          <p className={controles.erro} role="alert">
            Não foi possível consultar atletas e técnicos para conferir os IDs: {pessoas.mensagem}
          </p>
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={recarregarPessoas}>Tentar novamente</button>
        </div>
      )}
      {pessoas.tipo === "carregando" && <p className={pagina.carregando} role="status">Consultando atletas e técnicos para conferir os IDs…</p>}

      <h3 className={pagina.subtitulo}>Criados neste navegador</h3>
      {!guardadas && (
        <p className={`${controles.nota} ${pagina.erroDecisao}`}>
          Este navegador não permite guardar a lista: ela vale só até fechar a página. Anote os IDs.
        </p>
      )}
      {referencias.length === 0 ? (
        <p className={pagina.vazioTexto}>Nenhum presidente criado por você neste navegador.</p>
      ) : (
        <ul className={pagina.lista}>
          {referencias.map(r => (
            <li key={r.id}>
              <div className={pagina.linhaAcoes}>
                <div>
                  <span className={pagina.linhaNome}>{r.nomeCompleto}</span>
                  <span className={`${pagina.linhaMeta} ${styles.id}`}>ID {r.id}</span>
                  {ultimo(r.id)}
                </div>
                <div>
                  {botoes(r.id, r.id, r.nomeCompleto, r.nomeCompleto)}
                  <button type="button" className={controles.secundario} onClick={() => aoEsquecer(r.id)} aria-label={`Tirar ${r.nomeCompleto} da lista deste navegador`}>
                    Tirar da lista
                  </button>
                </div>
              </div>
              {mensagemBloqueio(r.id)}
            </li>
          ))}
        </ul>
      )}
      {referencias.length > 0 && (
        <p className={`${controles.ajuda} ${styles.espaco}`}>Nome e ID são referências guardadas neste navegador. “Tirar da lista” não altera a conta.</p>
      )}

      <h3 className={pagina.subtitulo}>Informar ID</h3>
      <div className={pagina.formulario}>
        <div className={controles.campo}>
          <label className={controles.rotulo} htmlFor="presidente-id">ID da conta de presidente</label>
          <input
            ref={campoId} id="presidente-id" className={`${controles.entrada} ${styles.id}`} value={idInformado}
            onChange={e => { setIdInformado(e.target.value); setBloqueio(b => (b?.chave === "informado" ? null : b)); }}
            autoComplete="off" spellCheck={false} maxLength={36} aria-describedby="presidente-id-ajuda"
          />
          <p className={controles.ajuda} id="presidente-id-ajuda">O ID aparece na tela Conta do próprio presidente.</p>
        </div>
        {mensagemBloqueio("informado")}
        <div className={pagina.acoes}>{botoes("informado", idInformado, null, "a conta deste ID")}</div>
      </div>
      <p className={`${pagina.aviso} ${styles.avisoLongo}`} role="status">{aviso}</p>

      <Confirmacao
        aberto={pedido !== null}
        titulo={pedido?.operacao === "desativacao" ? "Desativar a conta deste ID?" : "Reativar a conta deste ID?"}
        rotulo={pedido?.operacao === "desativacao" ? "Desativar conta" : "Reativar conta"}
        tom={pedido?.operacao === "desativacao" ? "perigo" : "aprovar"}
        enviando={enviando}
        erro={erro}
        aoConfirmar={confirmar}
        aoFechar={() => { setPedido(null); setErro(""); }}
        focoAlternativo={campoId}
      >
        {pedido && (
          <>
            <p className={pagina.confirmacaoTexto}>Confira o ID:</p>
            <p className={styles.idConferencia}>{pedido.id}</p>
            {pedido.nome && <p className={controles.ajuda}>Referência deste navegador: {pedido.nome} (não confirmada pelo servidor).</p>}
            <p className={controles.ajuda}>
              A operação vale para a conta que tiver este ID; o servidor não confere antes se é de presidente e informa o perfil na resposta.
              {pedido.operacao === "desativacao"
                ? " A pessoa perde o acesso imediatamente e as sessões abertas são encerradas; o histórico é preservado. O último presidente ativo não pode ser desativado."
                : " A pessoa volta a entrar com o mesmo e-mail e senha; sessões antigas não voltam a valer."}
            </p>
          </>
        )}
      </Confirmacao>
    </section>
  );
}
