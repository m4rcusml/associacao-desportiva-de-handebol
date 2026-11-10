"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "../../../lib/api";
import { consultarSolicitacoes, type DecisaoVerificacao, type SolicitacaoVerificacao, type StatusVerificacao } from "../../../lib/presidente";
import { Dialogo } from "../../ui/dialogo";
import { data, normalizar, primeiroNome } from "../../ui/formatos";
import { conflito, status, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import styles from "../../ui/pagina.module.css";

type Solicitacao = SolicitacaoVerificacao;
type Perfil = Solicitacao["perfil"];
type Status = StatusVerificacao;
type Decisao = "aprovar" | "rejeitar";
type FiltroPerfil = Perfil | "todos";
type FiltroStatus = Status | "todos";

const NOME_PERFIL: Record<Perfil, string> = { atleta: "Atleta", tecnico: "Técnico" };
const NOME_STATUS: Record<Status, string> = { pendente: "Pendente", aprovado: "Aprovado", rejeitado: "Rejeitado" };
const OPCOES_PERFIL: readonly { valor: FiltroPerfil; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "atleta", rotulo: "Atletas" },
  { valor: "tecnico", rotulo: "Técnicos" },
];
const OPCOES_STATUS: readonly { valor: FiltroStatus; rotulo: string }[] = [
  { valor: "pendente", rotulo: "Pendentes" },
  { valor: "aprovado", rotulo: "Aprovados" },
  { valor: "rejeitado", rotulo: "Rejeitados" },
  { valor: "todos", rotulo: "Todos" },
];
const CLASSE_STATUS: Record<Status, string> = {
  pendente: controles.statusPendente,
  aprovado: controles.statusAprovado,
  rejeitado: controles.statusRejeitado,
};
const ROTA_DECISAO: Record<Decisao, string> = { aprovar: "aprovacao", rejeitar: "rejeicao" };

export function Cadastros() {
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[] | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroPerfil, setFiltroPerfil] = useState<FiltroPerfil>("todos");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("pendente");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Decisao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroDecisao, setErroDecisao] = useState("");
  const [aviso, setAviso] = useState("");
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const botaoAprovar = useRef<HTMLButtonElement>(null);
  const botaoRejeitar = useRef<HTMLButtonElement>(null);
  const tituloResultado = useRef<HTMLHeadingElement>(null);

  const tratarSessao = useErroApi();

  // A API filtra por um status por vez; as três consultas correm em paralelo para manter contagens e "Todos".
  const carregar = useCallback(() => {
    consultarSolicitacoes()
      .then(lista => { setSolicitacoes(lista); setErroCarga(""); })
      .catch(erro => setErroCarga(tratarSessao(erro)));
  }, [tratarSessao]);

  useEffect(carregar, [carregar]);

  function atualizar() {
    setSolicitacoes(null);
    setErroCarga("");
    setAviso("");
    carregar();
  }

  const termo = normalizar(busca);
  const doPerfil = (solicitacoes ?? []).filter(s => filtroPerfil === "todos" || s.perfil === filtroPerfil);
  const contagem = { pendente: 0, aprovado: 0, rejeitado: 0, todos: doPerfil.length };
  for (const s of doPerfil) contagem[s.statusVerificacao]++;
  const visiveis = doPerfil.filter(s =>
    (filtroStatus === "todos" || s.statusVerificacao === filtroStatus)
    && (!termo || normalizar(s.nomeCompleto).includes(termo) || normalizar(s.clube?.nome ?? "sem clube").includes(termo)));
  const aberta = solicitacoes?.find(s => s.usuarioId === abertaId) ?? null;

  function abrir(id: string) {
    setAbertaId(id);
    setConfirmando(null);
    setErroDecisao("");
  }

  function fechar() {
    setAbertaId(null);
    setConfirmando(null);
    setErroDecisao("");
  }

  function voltar() {
    const decisao = confirmando;
    flushSync(() => { setConfirmando(null); setErroDecisao(""); });
    (decisao === "rejeitar" ? botaoRejeitar : botaoAprovar).current?.focus();
  }

  async function recuperar(usuarioId: string, mensagem: string) {
    try {
      const lista = await consultarSolicitacoes();
      setSolicitacoes(lista);
      const atual = lista.find(s => s.usuarioId === usuarioId);
      if (!atual) return;
      setErroDecisao(`${mensagem} A ficha acima mostra a situação atual.`);
      if (atual.statusVerificacao !== "pendente" || !atual.ativo) {
        flushSync(() => setConfirmando(null));
        botaoFechar.current?.focus();
      }
    } catch (erro) {
      setErroDecisao(`${mensagem} Não foi possível consultar a situação atual: ${tratarSessao(erro)}`);
    }
  }

  async function decidir(solicitacao: Solicitacao, decisao: Decisao) {
    setEnviando(true);
    setErroDecisao("");
    try {
      const { solicitacao: atualizada } = await api<DecisaoVerificacao>(
        `/verificacoes/${solicitacao.usuarioId}/${ROTA_DECISAO[decisao]}`, {});
      setSolicitacoes(atual => (atual ?? []).map(s => (s.usuarioId === atualizada.usuarioId ? atualizada : s)));
      setAviso(`Cadastro de ${atualizada.nomeCompleto} ${atualizada.statusVerificacao === "aprovado" ? "aprovado" : "rejeitado"}.`);
      fechar();
    } catch (erro) {
      const mensagem = tratarSessao(erro);
      setErroDecisao(mensagem);
      // 409/404: outra decisão ou alteração chegou antes. Relê o estado real sem esvaziar a lista; a
      // confirmação só continua se a solicitação ainda puder ser decidida. Nada é reenviado.
      if (conflito(erro) || status(erro) === 404) await recuperar(solicitacao.usuarioId, mensagem);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className={styles.topo}>
        <div>
          <h1 className={styles.titulo}>Solicitações de cadastro</h1>
          <p className={styles.texto}>Confira nome e clube antes de aprovar ou rejeitar.</p>
        </div>
        <button type="button" className={controles.secundario} onClick={atualizar} disabled={solicitacoes === null && !erroCarga}>
          Atualizar lista
        </button>
      </div>

      <div className={styles.controles}>
        <div className={controles.campo}>
          <label className={controles.rotulo} htmlFor="busca-solicitacoes">Buscar por nome ou clube</label>
          <input id="busca-solicitacoes" className={controles.entrada} type="search" value={busca} onChange={e => setBusca(e.target.value)} autoComplete="off" />
        </div>
        <div className={styles.filtros}>
          <div className={controles.grupo} role="group" aria-label="Perfil">
            {OPCOES_PERFIL.map(o => (
              <button key={o.valor} type="button" className={controles.opcao} aria-pressed={filtroPerfil === o.valor} onClick={() => setFiltroPerfil(o.valor)}>
                {o.rotulo}
              </button>
            ))}
          </div>
          <div className={controles.grupo} role="group" aria-label="Status">
            {OPCOES_STATUS.map(o => (
              <button key={o.valor} type="button" className={controles.opcao} aria-pressed={filtroStatus === o.valor} onClick={() => setFiltroStatus(o.valor)}>
                {o.rotulo} {solicitacoes && <span className={controles.contagem}>{contagem[o.valor]}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className={styles.aviso} role="status" aria-live="polite">{aviso}</p>

      {erroCarga ? (
        <div className={styles.vazio}>
          <p className={controles.erro} role="alert">{erroCarga}</p>
          <button type="button" className={`${controles.secundario} ${styles.acaoVazio}`} onClick={atualizar}>Tentar novamente</button>
        </div>
      ) : solicitacoes === null ? (
        <p className={styles.carregando} role="status">Carregando solicitações…</p>
      ) : (
        <>
          <h2 ref={tituloResultado} className={styles.resultado} tabIndex={-1}>
            {visiveis.length === 1 ? "1 solicitação" : `${visiveis.length} solicitações`}
          </h2>
          {visiveis.length === 0 ? (
            <div className={styles.vazio}>
              {solicitacoes.length === 0 ? (
                <p className={styles.vazioTexto}>Nenhuma solicitação de atleta ou técnico até agora.</p>
              ) : (
                <>
                  <p className={styles.vazioTexto}>Nenhuma solicitação corresponde à busca e aos filtros escolhidos.</p>
                  <button type="button" className={controles.secundario} onClick={() => { setBusca(""); setFiltroPerfil("todos"); setFiltroStatus("todos"); }}>
                    Mostrar todas as solicitações
                  </button>
                </>
              )}
            </div>
          ) : (
            <ul className={styles.lista}>
              {visiveis.map(s => (
                <li key={s.usuarioId}>
                  <button type="button" className={styles.linha} onClick={() => abrir(s.usuarioId)} aria-haspopup="dialog">
                    <span className={styles.linhaNome}>{s.nomeCompleto}</span>
                    <span className={styles.linhaMeta}>{NOME_PERFIL[s.perfil]}, {s.clube?.nome ?? "sem clube"}{s.ativo ? "" : ", conta desativada"}</span>
                    <span className={styles.linhaData}>
                      Solicitado em {s.verificacaoSolicitadaEm ? <time dateTime={s.verificacaoSolicitadaEm}>{data(s.verificacaoSolicitadaEm)}</time> : "data não registrada"}
                    </span>
                    <span className={`${controles.status} ${styles.linhaStatus} ${CLASSE_STATUS[s.statusVerificacao]}`}>{NOME_STATUS[s.statusVerificacao]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialogo aberto={aberta !== null} aoFechar={fechar} tituloId="detalhe-titulo" focoInicial={botaoFechar} focoAlternativo={tituloResultado} bloqueado={enviando}>
        {aberta && (
          <div className={styles.detalhe}>
            <div className={styles.detalheTopo}>
              <span className={`${controles.status} ${CLASSE_STATUS[aberta.statusVerificacao]}`}>{NOME_STATUS[aberta.statusVerificacao]}</span>
              <button ref={botaoFechar} type="button" className={styles.fechar} onClick={fechar} disabled={enviando}>Fechar</button>
            </div>
            <h2 id="detalhe-titulo" className={styles.detalheNome}>{aberta.nomeCompleto}</h2>
            <dl className={styles.ficha}>
              <div><dt>Perfil</dt><dd>{NOME_PERFIL[aberta.perfil]}</dd></div>
              <div><dt>Clube</dt><dd>{aberta.clube?.nome ?? "Sem clube"}</dd></div>
              <div><dt>Solicitação</dt><dd>{data(aberta.verificacaoSolicitadaEm)}</dd></div>
              {aberta.statusVerificacao !== "pendente" && <div><dt>Decisão</dt><dd>{data(aberta.verificadoEm)}</dd></div>}
              {aberta.carteirinha && <div><dt>Carteirinha</dt><dd>{aberta.carteirinha.codigo}</dd></div>}
            </dl>

            {erroDecisao && <p className={`${controles.erro} ${styles.erroDecisao}`} role="alert">{erroDecisao}</p>}

            {!aberta.ativo ? (
              <p className={controles.nota}>Conta desativada. A solicitação não pode ser decidida enquanto a conta estiver desativada.</p>
            ) : aberta.statusVerificacao === "pendente" ? (
              confirmando ? (
                <div className={styles.confirmacao}>
                  <p className={styles.confirmacaoTexto}>
                    {confirmando === "aprovar"
                      ? `Aprovar o cadastro de ${primeiroNome(aberta.nomeCompleto)}? Depois de aprovado, o cadastro não pode ser rejeitado.`
                      : `Rejeitar o cadastro de ${primeiroNome(aberta.nomeCompleto)}? Uma nova análise só acontece se a pessoa pedir novamente.`}
                  </p>
                  {confirmando === "aprovar" && aberta.perfil === "atleta" && (
                    <p className={controles.nota}>A aprovação confirma o vínculo com o clube e emite a carteirinha do atleta.</p>
                  )}
                  <div className={styles.acoes}>
                    <button
                      type="button"
                      className={confirmando === "aprovar" ? controles.aprovar : controles.rejeitar}
                      onClick={() => decidir(aberta, confirmando)}
                      disabled={enviando}
                      autoFocus
                    >
                      {enviando ? "Enviando…" : confirmando === "aprovar" ? "Confirmar aprovação" : "Confirmar rejeição"}
                    </button>
                    <button type="button" className={controles.secundario} onClick={voltar} disabled={enviando}>Voltar</button>
                  </div>
                </div>
              ) : (
                <div className={styles.acoes}>
                  <button ref={botaoAprovar} type="button" className={controles.aprovar} onClick={() => setConfirmando("aprovar")}>Aprovar</button>
                  <button ref={botaoRejeitar} type="button" className={controles.rejeitar} onClick={() => setConfirmando("rejeitar")}>Rejeitar</button>
                </div>
              )
            ) : (
              <p className={controles.nota}>
                {aberta.statusVerificacao === "aprovado"
                  ? "Cadastro aprovado. Uma aprovação não pode ser desfeita."
                  : "Cadastro rejeitado. Ele volta para análise somente se a pessoa solicitar nova verificação."}
              </p>
            )}
          </div>
        )}
      </Dialogo>
    </>
  );
}
