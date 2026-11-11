"use client";

import { useRef, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import { useSessaoPresidente } from "../shell";
import styles from "./conta.module.css";

type RespostaEdicao = { usuario: { id: string; nomeCompleto: string }; alterado: boolean };

/** Identificação da própria conta, edição do nome (`PATCH /conta`) e saída. E-mail e senha não são editáveis. */
export function Identificacao() {
  const { sessao, renomear, sair } = useSessaoPresidente();
  const tratarErro = useErroApi();
  const [nome, setNome] = useState(sessao.usuario.nomeCompleto);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [saindo, setSaindo] = useState(false);
  const [erroSaida, setErroSaida] = useState("");
  // Evita envio duplo antes de o botão desabilitado ser renderizado.
  const emAndamento = useRef(false);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (emAndamento.current) return;
    const nomeCompleto = nome.trim();
    setAviso("");
    if (nomeCompleto.length < 3 || nomeCompleto.length > 150) { setErro("Informe o nome completo com 3 a 150 caracteres."); return; }
    emAndamento.current = true;
    setEnviando(true);
    setErro("");
    try {
      const { usuario, alterado } = await api<RespostaEdicao>("/conta", { nomeCompleto }, "PATCH");
      renomear(usuario.nomeCompleto);
      setNome(usuario.nomeCompleto);
      setAviso(alterado ? "Nome salvo." : "Nada mudou: o nome já era este.");
    } catch (falha) {
      setErro(tratarErro(falha));
    } finally {
      emAndamento.current = false;
      setEnviando(false);
    }
  }

  async function sairDaConta() {
    setSaindo(true);
    setErroSaida("");
    try {
      await sair();
    } catch (falha) {
      setErroSaida(tratarErro(falha));
      setSaindo(false);
    }
  }

  const semMudanca = nome.trim() === sessao.usuario.nomeCompleto;

  return (
    <section className={pagina.secao} aria-labelledby="secao-identificacao">
      <h2 id="secao-identificacao" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Sua identificação</h2>
      <dl className={pagina.ficha}>
        <div><dt>Perfil</dt><dd>Presidente</dd></div>
        <div><dt>Nome</dt><dd>{sessao.usuario.nomeCompleto}</dd></div>
        <div><dt>ID da conta</dt><dd className={styles.id}>{sessao.usuario.id}</dd></div>
      </dl>

      <form className={pagina.formulario} onSubmit={salvar} noValidate>
        <div className={controles.campo}>
          <label className={controles.rotulo} htmlFor="conta-nome">Nome completo</label>
          <input
            id="conta-nome" className={controles.entrada} value={nome} onChange={e => { setNome(e.target.value); setAviso(""); }}
            autoComplete="name" maxLength={150} required disabled={enviando} aria-describedby="conta-nome-ajuda"
            aria-invalid={erro ? true : undefined}
          />
          <p className={controles.ajuda} id="conta-nome-ajuda">De 3 a 150 caracteres. A alteração vale sem nova aprovação.</p>
        </div>
        {erro && <p className={controles.erro} role="alert">{erro}</p>}
        <div className={pagina.acoes}>
          <button type="submit" className={controles.primario} disabled={enviando || semMudanca}>{enviando ? "Salvando…" : "Salvar nome"}</button>
        </div>
      </form>
      <p className={pagina.aviso} role="status">{aviso}</p>

      <p className={pagina.secaoTexto}>
        E-mail, senha e perfil não podem ser alterados por esta tela, e a recuperação de senha ainda não está disponível.
      </p>
      {erroSaida && <p className={`${controles.erro} ${pagina.erroDecisao}`} role="alert">{erroSaida}</p>}
      <div className={pagina.acoes}>
        <button type="button" className={controles.secundario} onClick={sairDaConta} disabled={saindo}>{saindo ? "Saindo…" : "Sair da conta"}</button>
      </div>
    </section>
  );
}
