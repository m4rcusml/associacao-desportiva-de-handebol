"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { consultarSolicitacoes, type ReferenciaClube, type SolicitacaoVerificacao } from "../../../lib/presidente";
import { data } from "../../ui/formatos";
import { useErroApi } from "../../ui/use-erro-api";
import { Iniciais } from "../../ui/identificacao";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { Carteirinha } from "./carteirinha";
import { ContaPessoa } from "./conta-pessoa";
import { Foto } from "./foto";
import { Historico } from "./historico";
import { CLASSE_STATUS, NOME_PERFIL, NOME_STATUS } from "./nomes";
import { Vinculos } from "./vinculos";
import { AtalhoPresidente, IconePresidente } from "../visual";
import visual from "../visual.module.css";

/** `erroReleitura`: a releitura falhou depois de a página já ter dados (ex.: após um POST confirmado); os dados ficam. */
type Estado = { tipo: "carregando" } | { tipo: "falha"; mensagem: string } | { tipo: "ausente" }
  | { tipo: "pronto"; pessoa: SolicitacaoVerificacao; erroReleitura?: string; relendo?: boolean };

/**
 * Detalhe de um atleta ou técnico. Não há consulta individual de conta: a pessoa vem das listas de
 * verificação. `revisao` avisa as seções dependentes do clube (carteirinha, histórico) após uma transferência.
 */
export function Pessoa({ usuarioId }: { usuarioId: string }) {
  const tratarErro = useErroApi();
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [revisao, setRevisao] = useState(0);
  const [area, setArea] = useState<"cadastro" | "conta" | "carteirinha" | "foto" | "vinculos" | "historico" | null>(null);
  const consulta = useRef(0);

  const carregar = useCallback(() => {
    const versao = ++consulta.current;
    consultarSolicitacoes()
      .then(lista => {
        if (versao !== consulta.current) return;
        const pessoa = lista.find(p => p.usuarioId === usuarioId.toLowerCase());
        setEstado(pessoa ? { tipo: "pronto", pessoa } : { tipo: "ausente" });
      })
      .catch(erro => {
        if (versao !== consulta.current) return;
        const mensagem = tratarErro(erro);
        // Com dados já exibidos, a falha da releitura não esconde a ficha nem o aviso de sucesso das seções.
        setEstado(atual => atual.tipo === "pronto" ? { ...atual, erroReleitura: mensagem, relendo: false } : { tipo: "falha", mensagem });
      });
  }, [usuarioId, tratarErro]);

  /** Aplica o resultado já confirmado pelo servidor e relê as listas. */
  const aplicar = useCallback((mudanca: Partial<Pick<SolicitacaoVerificacao, "ativo" | "clube">>) => {
    consulta.current++;
    setEstado(atual => atual.tipo === "pronto" ? { ...atual, pessoa: { ...atual.pessoa, ...mudanca } as SolicitacaoVerificacao } : atual);
    carregar();
  }, [carregar]);

  const aoAlterarConta = useCallback((ativo?: boolean) => aplicar(ativo === undefined ? {} : { ativo }), [aplicar]);

  function reler() {
    setEstado(atual => atual.tipo === "pronto" ? { ...atual, erroReleitura: undefined, relendo: true } : atual);
    carregar();
  }

  const invalidarConsulta = useCallback(() => { consulta.current++; }, []);
  useEffect(() => { carregar(); return invalidarConsulta; }, [carregar, invalidarConsulta]);

  const aoTransferir = useCallback((clube: ReferenciaClube | null) => {
    aplicar({ clube });
    setRevisao(r => r + 1);
  }, [aplicar]);

  const voltar = <Link href="/presidente/pessoas" className={pagina.voltar}>Voltar para Pessoas</Link>;

  if (estado.tipo === "carregando") return <>{voltar}<p className={pagina.carregando} role="status">Carregando dados da pessoa…</p></>;
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
  if (estado.tipo === "ausente") {
    return (
      <>
        {voltar}
        <h1 className={pagina.titulo}>Pessoa não encontrada</h1>
        <p className={pagina.texto}>Não há atleta ou técnico com este endereço. Volte para a lista e escolha a pessoa novamente.</p>
      </>
    );
  }

  const { pessoa } = estado;
  const atleta = pessoa.perfil === "atleta";
  const aprovado = pessoa.statusVerificacao === "aprovado";

  return (
    <>
      {voltar}
      <div className={pagina.topo}>
        <div className={visual.identificacao}>
          <Iniciais nome={pessoa.nomeCompleto} grande />
          <div>
          <h1 className={pagina.titulo}>{pessoa.nomeCompleto}</h1>
          <p className={pagina.texto}>
            {NOME_PERFIL[pessoa.perfil]}, {pessoa.clube?.nome ?? "sem clube"}
            {!pessoa.ativo && <strong className={controles.textoAlerta}>, conta desativada</strong>}
          </p>
          </div>
        </div>
        <span className={`${controles.status} ${CLASSE_STATUS[pessoa.statusVerificacao]}`}>{NOME_STATUS[pessoa.statusVerificacao]}</span>
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

      {!area && <>
        {atleta && aprovado && <div className={visual.destaque}><IconePresidente tipo="carteirinha" /><div><h2>{pessoa.carteirinha?.status === "invalidada" ? "Carteirinha invalidada" : pessoa.carteirinha ? "Carteirinha ativa" : "Carteirinha"}</h2><p className={pagina.texto}>{pessoa.carteirinha?.codigo ?? "Consultar emissão"}</p></div><button type="button" className={controles.primario} onClick={() => setArea("carteirinha")}>Ver carteirinha</button></div>}
        <div className={visual.atalhos}>
          {atleta && <AtalhoPresidente titulo="Vínculo e transferência" detalhe={pessoa.clube?.nome ?? "Sem clube"} icone="clube" aoAbrir={() => setArea("vinculos")} />}
          {atleta && aprovado && <AtalhoPresidente titulo="Histórico esportivo" detalhe="Participações, métricas e registros" icone="calendario" aoAbrir={() => setArea("historico")} />}
          {atleta && <AtalhoPresidente titulo="Foto do atleta" detalhe="Consultar ou enviar foto opcional" icone="pessoa" aoAbrir={() => setArea("foto")} />}
          <AtalhoPresidente titulo="Acesso da conta" detalhe={pessoa.ativo ? "Conta ativa" : "Conta desativada"} icone="pessoa" aoAbrir={() => setArea("conta")} />
          <AtalhoPresidente titulo="Dados do cadastro" detalhe={`Solicitado em ${data(pessoa.verificacaoSolicitadaEm)}`} icone="pessoa" aoAbrir={() => setArea("cadastro")} />
        </div>
        {pessoa.statusVerificacao === "pendente" && <p className={controles.nota}>A verificação está pendente. Confira e decida em <Link href="/presidente">Cadastros</Link>.</p>}
        {!atleta && <p className={controles.nota}>A atribuição do técnico é feita em <Link href={pessoa.clube ? `/presidente/clubes/${pessoa.clube.id}` : "/presidente/clubes"}>Clubes</Link>.</p>}
      </>}
      {area && <div className={visual.contexto}>
        <button type="button" className={controles.secundario} onClick={() => { setArea(null); reler(); }}>Voltar à ficha</button>
        {area === "cadastro" && <section className={pagina.secao} aria-labelledby="secao-cadastro">
          <h2 id="secao-cadastro" className={pagina.secaoTitulo}>Cadastro</h2>
          <dl className={`${pagina.ficha} ${pagina.bloco}`}>
            <div><dt>Perfil</dt><dd>{NOME_PERFIL[pessoa.perfil]}</dd></div>
            <div><dt>{atleta ? "Clube atual" : "Clube"}</dt><dd>{pessoa.clube?.nome ?? "Sem clube"}</dd></div>
            <div><dt>Verificação</dt><dd>{NOME_STATUS[pessoa.statusVerificacao]}</dd></div>
            <div><dt>Solicitação</dt><dd>{data(pessoa.verificacaoSolicitadaEm)}</dd></div>
            {pessoa.statusVerificacao !== "pendente" && <div><dt>Decisão</dt><dd>{data(pessoa.verificadoEm)}</dd></div>}
          </dl>
          {pessoa.statusVerificacao === "pendente" && (
            <p className={controles.nota}>A verificação está pendente. Aprove ou rejeite em <Link href="/presidente">Cadastros</Link>.</p>
          )}
          {!atleta && (
            <p className={controles.nota}>
              Técnicos são atribuídos e desvinculados na página do clube, em{" "}
              <Link href={pessoa.clube ? `/presidente/clubes/${pessoa.clube.id}` : "/presidente/clubes"}>Clubes</Link>.
            </p>
          )}
        </section>}

        {area === "conta" && <ContaPessoa pessoa={pessoa} aoAlterar={aoAlterarConta} />}
        {area === "carteirinha" && atleta && aprovado && <Carteirinha atletaId={pessoa.usuarioId} revisao={revisao} />}
        {area === "foto" && atleta && <Foto atletaId={pessoa.usuarioId} nome={pessoa.nomeCompleto} />}
        {area === "vinculos" && atleta && <Vinculos atletaId={pessoa.usuarioId} aprovado={aprovado} aoTransferir={aoTransferir} />}
        {area === "historico" && atleta && aprovado && <Historico atletaId={pessoa.usuarioId} revisao={revisao} />}
      </div>}
    </>
  );
}
