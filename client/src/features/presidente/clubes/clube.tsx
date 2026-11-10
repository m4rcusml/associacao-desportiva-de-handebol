"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { consultarSolicitacoes, type Clube as DadosClube, type SolicitacaoVerificacao } from "../../../lib/presidente";
import { Confirmacao } from "../../ui/confirmacao";
import { contar, primeiroNome } from "../../ui/formatos";
import { conflito, status, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { CamposClube, lerCamposClube, type ValoresClube } from "./campos-clube";

type Estado = { tipo: "carregando" } | { tipo: "falha"; mensagem: string } | { tipo: "ausente" }
  /** `erroReleitura`: a releitura falhou com dados já exibidos (ex.: após operação confirmada); os dados ficam. */
  | { tipo: "pronto"; clube: DadosClube; pessoas: SolicitacaoVerificacao[]; erroReleitura?: string; relendo?: boolean };
type OperacaoTecnico = { tipo: "atribuir" | "substituir"; tecnico: SolicitacaoVerificacao } | { tipo: "desvincular" };

const valoresDe = (clube: DadosClube): ValoresClube => ({ nome: clube.nome, cidade: clube.cidade ?? "" });

/** Detalhe do clube: nome e cidade, técnico (atribuir, substituir, desvincular) e elenco atual. Sem exclusão de clube. */
export function Clube({ clubeId, criado }: { clubeId: string; criado: boolean }) {
  const tratarErro = useErroApi();
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [valores, setValores] = useState<ValoresClube | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroEdicao, setErroEdicao] = useState("");
  const [avisoEdicao, setAvisoEdicao] = useState(criado ? "Clube criado. Atribua um técnico quando houver um aprovado." : "");
  const [escolhido, setEscolhido] = useState("");
  const [operacao, setOperacao] = useState<OperacaoTecnico | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroTecnico, setErroTecnico] = useState("");
  const [avisoTecnico, setAvisoTecnico] = useState("");

  /** Relê clube e pessoas. Não toca no formulário de edição se ele já foi iniciado. */
  const carregar = useCallback(() => {
    return Promise.all([api<DadosClube>(`/clubes/${clubeId}`), consultarSolicitacoes()])
      .then(([clube, pessoas]) => {
        setEstado({ tipo: "pronto", clube, pessoas });
        setValores(atual => atual ?? valoresDe(clube));
      })
      .catch(erro => {
        if (status(erro) === 404 || status(erro) === 400) { setEstado({ tipo: "ausente" }); return; }
        const mensagem = tratarErro(erro);
        // Com dados já exibidos, a falha da releitura não esconde o clube nem o aviso da operação confirmada.
        setEstado(atual => atual.tipo === "pronto" ? { ...atual, erroReleitura: mensagem, relendo: false } : { tipo: "falha", mensagem });
      });
  }, [clubeId, tratarErro]);

  function reler() {
    setEstado(atual => atual.tipo === "pronto" ? { ...atual, erroReleitura: undefined, relendo: true } : atual);
    carregar();
  }

  useEffect(() => { carregar(); }, [carregar]);

  const voltar = <Link href="/presidente/clubes" className={pagina.voltar}>Voltar para Clubes</Link>;

  if (estado.tipo === "carregando") return <>{voltar}<p className={pagina.carregando} role="status">Carregando clube…</p></>;
  if (estado.tipo === "ausente") {
    return (
      <>
        {voltar}
        <h1 className={pagina.titulo}>Clube não encontrado</h1>
        <p className={pagina.texto}>Não há clube com este endereço. Volte para a lista e escolha o clube novamente.</p>
      </>
    );
  }
  if (estado.tipo === "falha") {
    return (
      <>
        {voltar}
        <div className={pagina.vazio}>
          <p className={controles.erro} role="alert">{estado.mensagem}</p>
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={() => { setEstado({ tipo: "carregando" }); carregar(); }}>Tentar novamente</button>
        </div>
      </>
    );
  }

  const { clube, pessoas } = estado;
  const tecnico = clube.tecnico;
  const candidatos = pessoas
    .filter(p => p.perfil === "tecnico" && p.statusVerificacao === "aprovado" && p.ativo && p.clube === null)
    .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR"));
  const candidato = candidatos.find(c => c.usuarioId === escolhido) ?? null;
  const atletas = pessoas.filter(p => p.perfil === "atleta" && p.clube?.id === clube.id)
    .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR"));
  const aprovados = atletas.filter(a => a.statusVerificacao === "aprovado");
  const aguardando = atletas.filter(a => a.statusVerificacao === "pendente").length;
  const form = valores ?? valoresDe(clube);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setAvisoEdicao("");
    const lido = lerCamposClube(form);
    if ("erro" in lido) { setErroEdicao(lido.erro); return; }
    // Envia somente o que mudou; `cidade: null` remove a cidade.
    const mudancas = {
      ...(lido.nome !== clube.nome ? { nome: lido.nome } : {}),
      ...(lido.cidade !== clube.cidade ? { cidade: lido.cidade } : {}),
    };
    if (Object.keys(mudancas).length === 0) { setErroEdicao(""); setAvisoEdicao("Nada mudou: nome e cidade já estão assim."); return; }
    setSalvando(true);
    setErroEdicao("");
    try {
      const atualizado = await api<DadosClube>(`/clubes/${clube.id}`, mudancas, "PATCH");
      setEstado(e => (e.tipo === "pronto" ? { ...e, clube: atualizado } : e));
      setValores(valoresDe(atualizado));
      setAvisoEdicao("Dados do clube salvos.");
    } catch (erro) {
      // Mantém o que foi digitado; em 404 a página passa a "não encontrado" na releitura.
      setErroEdicao(tratarErro(erro));
      if (status(erro) === 404) carregar();
    } finally {
      setSalvando(false);
    }
  }

  function pedir(op: OperacaoTecnico) {
    setErroTecnico("");
    setAvisoTecnico("");
    setOperacao(op);
  }

  async function confirmarTecnico() {
    if (!operacao) return;
    setEnviando(true);
    setErroTecnico("");
    try {
      let atualizado: DadosClube;
      if (operacao.tipo === "desvincular") {
        if (!tecnico) return;
        atualizado = await api<DadosClube>(`/clubes/${clube.id}/tecnico/${tecnico.id}`, undefined, "DELETE");
        setAvisoTecnico(`${tecnico.nomeCompleto} foi desvinculado. O clube está sem técnico.`);
      } else {
        const corpo = operacao.tipo === "substituir" && tecnico
          ? { tecnicoId: operacao.tecnico.usuarioId, substituirTecnicoId: tecnico.id }
          : { tecnicoId: operacao.tecnico.usuarioId };
        atualizado = await api<DadosClube>(`/clubes/${clube.id}/tecnico`, corpo, "PUT");
        setAvisoTecnico(`${operacao.tecnico.nomeCompleto} é o técnico do clube.`);
        setEscolhido("");
      }
      setEstado(e => (e.tipo === "pronto" ? { ...e, clube: atualizado } : e));
      setOperacao(null);
      // As pessoas mudam de clube com a operação: relê para candidatos e fichas ficarem corretos.
      carregar();
    } catch (erro) {
      // 409: vaga ocupada ou técnico já atribuído por outra operação. Mostra e relê o estado real; a escolha é mantida.
      setErroTecnico(tratarErro(erro));
      if (conflito(erro) || status(erro) === 404) carregar();
    } finally {
      setEnviando(false);
    }
  }

  const tituloOperacao = !operacao ? ""
    : operacao.tipo === "desvincular" ? `Desvincular ${tecnico ? primeiroNome(tecnico.nomeCompleto) : "o técnico"}?`
      : operacao.tipo === "substituir" ? `Substituir por ${primeiroNome(operacao.tecnico.nomeCompleto)}?`
        : `Atribuir ${primeiroNome(operacao.tecnico.nomeCompleto)} ao clube?`;

  return (
    <>
      {voltar}
      <div className={pagina.topo}>
        <div>
          <h1 className={pagina.titulo}>{clube.nome}</h1>
          <p className={pagina.texto}>{clube.cidade ?? "Cidade não informada"}</p>
        </div>
        <span className={`${controles.status} ${tecnico ? controles.statusAprovado : controles.statusPendente}`}>{tecnico ? "Com técnico" : "Sem técnico"}</span>
      </div>

      {(estado.erroReleitura || estado.relendo) && (
        <div className={pagina.erroDecisao}>
          {estado.erroReleitura && (
            <p className={controles.erro} role="alert">
              Não foi possível atualizar os dados desta página; o que o servidor já confirmou continua valendo. {estado.erroReleitura}
            </p>
          )}
          <button type="button" className={`${controles.secundario} ${pagina.acaoVazio}`} onClick={reler} disabled={estado.relendo}>
            {estado.relendo ? "Atualizando…" : "Atualizar dados"}
          </button>
        </div>
      )}

      <div className={pagina.secoes}>
        <section className={pagina.secao} aria-labelledby="secao-dados">
          <h2 id="secao-dados" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Dados do clube</h2>
          <form className={pagina.formulario} onSubmit={salvar} noValidate>
            <CamposClube valores={form} aoMudar={v => { setValores(v); setAvisoEdicao(""); }} prefixo="clube" desativado={salvando} />
            {erroEdicao && <p className={controles.erro} role="alert">{erroEdicao}</p>}
            <div className={pagina.acoes}>
              <button type="submit" className={controles.primario} disabled={salvando}>{salvando ? "Salvando…" : "Salvar alterações"}</button>
            </div>
          </form>
          <p className={pagina.aviso} role="status">{avisoEdicao}</p>
          <p className={controles.ajuda}>Alterar o nome não muda vínculos nem o histórico. Clubes não são excluídos.</p>
        </section>

        <section className={pagina.secao} aria-labelledby="secao-tecnico">
          <h2 id="secao-tecnico" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Técnico</h2>
          {tecnico ? (
            <dl className={pagina.ficha}>
              <div><dt>Técnico atual</dt><dd><Link href={`/presidente/pessoas/${tecnico.id}`}>{tecnico.nomeCompleto}</Link></dd></div>
              <div><dt>Conta</dt><dd className={tecnico.ativo ? undefined : controles.textoAlerta}>{tecnico.ativo ? "Ativa" : "Desativada"}</dd></div>
            </dl>
          ) : (
            <p className={pagina.secaoTexto}>O clube está sem técnico.</p>
          )}

          <p className={pagina.aviso} role="status">{avisoTecnico}</p>
          {erroTecnico && !operacao && <p className={`${controles.erro} ${pagina.erroDecisao}`} role="alert">{erroTecnico}</p>}

          <form className={pagina.formulario} onSubmit={e => { e.preventDefault(); if (candidato) pedir({ tipo: tecnico ? "substituir" : "atribuir", tecnico: candidato }); else setErroTecnico("Escolha um técnico."); }} noValidate>
            <div className={controles.campo}>
              <label className={controles.rotulo} htmlFor="tecnico-novo">{tecnico ? "Substituir por" : "Atribuir técnico"}</label>
              <select id="tecnico-novo" className={controles.entrada} value={escolhido} onChange={e => { setEscolhido(e.target.value); setErroTecnico(""); }} disabled={enviando || candidatos.length === 0}>
                <option value="">{candidatos.length ? "Escolha um técnico" : "Nenhum técnico disponível"}</option>
                {candidatos.map(c => <option key={c.usuarioId} value={c.usuarioId}>{c.nomeCompleto}</option>)}
              </select>
              <p className={controles.ajuda}>Aparecem técnicos aprovados, com conta ativa e sem clube. Para trazer o técnico de outro clube, desvincule-o lá antes.</p>
            </div>
            <div className={pagina.acoes}>
              <button type="submit" className={controles.primario} disabled={enviando || candidatos.length === 0}>{tecnico ? "Substituir técnico" : "Atribuir técnico"}</button>
              {tecnico && <button type="button" className={controles.rejeitar} onClick={() => pedir({ tipo: "desvincular" })} disabled={enviando}>Desvincular técnico</button>}
            </div>
          </form>
        </section>

        <section className={pagina.secao} aria-labelledby="secao-elenco">
          <div className={pagina.secaoTopo}>
            <h2 id="secao-elenco" className={pagina.secaoTitulo}>Elenco</h2>
            <span className={pagina.linhaMeta}>{contar(aprovados.length, "atleta aprovado", "atletas aprovados")}</span>
          </div>
          <p className={pagina.secaoTexto}>
            Atletas com vínculo atual com o clube. Transferências são feitas na página do atleta, em Pessoas.
            {aguardando > 0 && ` ${contar(aguardando, "cadastro aguarda", "cadastros aguardam")} aprovação.`}
          </p>
          {aprovados.length === 0 ? (
            <p className={pagina.secaoTexto}>Nenhum atleta aprovado no clube.</p>
          ) : (
            <ul className={pagina.lista}>
              {aprovados.map(a => (
                <li key={a.usuarioId}>
                  <Link href={`/presidente/pessoas/${a.usuarioId}`} className={pagina.linha}>
                    <span className={pagina.linhaNome}>{a.nomeCompleto}</span>
                    <span className={pagina.linhaMeta}>
                      {a.carteirinha ? `Carteirinha ${a.carteirinha.codigo}${a.carteirinha.status === "invalidada" ? ", invalidada" : ""}` : "Sem carteirinha"}
                      {!a.ativo && <strong className={controles.textoAlerta}>, conta desativada</strong>}
                    </span>
                    <span className={`${controles.status} ${pagina.linhaStatus} ${a.ativo ? controles.statusAprovado : controles.statusRejeitado}`}>{a.ativo ? "Ativo" : "Desativado"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Confirmacao
        aberto={operacao !== null}
        titulo={tituloOperacao}
        rotulo={operacao?.tipo === "desvincular" ? "Desvincular técnico" : operacao?.tipo === "substituir" ? "Substituir técnico" : "Atribuir técnico"}
        tom={operacao?.tipo === "desvincular" ? "perigo" : "primario"}
        enviando={enviando}
        erro={erroTecnico}
        aoConfirmar={confirmarTecnico}
        aoFechar={() => setOperacao(null)}
      >
        <p className={pagina.confirmacaoTexto}>
          {operacao?.tipo === "desvincular"
            ? "O clube fica sem técnico até uma nova atribuição."
            : operacao?.tipo === "substituir"
              ? `${tecnico?.nomeCompleto ?? "O técnico atual"} deixa o clube e ${operacao.tecnico.nomeCompleto} passa a ser o técnico.`
              : operacao ? `${operacao.tecnico.nomeCompleto} passa a ser o técnico de ${clube.nome}.` : ""}
        </p>
      </Confirmacao>
    </>
  );
}
