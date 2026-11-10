"use client";

import { useState } from "react";
import { api } from "../../../lib/api";
import type { SolicitacaoVerificacao } from "../../../lib/presidente";
import { Confirmacao } from "../../ui/confirmacao";
import { primeiroNome } from "../../ui/formatos";
import { conflito, status, useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";

export type ResultadoAtivacao = { usuario: { id: string; perfil: string; ativo: boolean }; alterado: boolean };

/** Desativa ou reativa a conta de outra pessoa (`POST /contas/:id/desativacao|reativacao`). */
export function ContaPessoa({ pessoa, aoAlterar }: { pessoa: SolicitacaoVerificacao; aoAlterar: (ativo?: boolean) => void }) {
  const tratarErro = useErroApi();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const desativar = pessoa.ativo;
  const nome = primeiroNome(pessoa.nomeCompleto);

  async function confirmar() {
    setEnviando(true);
    setErro("");
    try {
      const { usuario, alterado } = await api<ResultadoAtivacao>(`/contas/${pessoa.usuarioId}/${desativar ? "desativacao" : "reativacao"}`, {});
      setAviso(alterado
        ? (usuario.ativo ? `Conta de ${nome} reativada. A pessoa precisa entrar novamente.` : `Conta de ${nome} desativada. As sessões abertas foram encerradas.`)
        : `Nada mudou: a conta de ${nome} já estava ${usuario.ativo ? "ativa" : "desativada"}.`);
      setConfirmando(false);
      // Aplica a situação confirmada antes da releitura; se a releitura falhar, o aviso continua visível.
      aoAlterar(usuario.ativo);
    } catch (falha) {
      setErro(tratarErro(falha));
      // Estado mudou no servidor: atualiza a ficha sem fechar a confirmação, para a mensagem continuar visível.
      if (conflito(falha) || status(falha) === 404) aoAlterar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={pagina.secao} aria-labelledby="secao-conta">
      <div className={pagina.secaoTopo}>
        <h2 id="secao-conta" className={pagina.secaoTitulo}>Conta</h2>
        <span className={`${controles.status} ${pessoa.ativo ? controles.statusAprovado : controles.statusRejeitado}`}>{pessoa.ativo ? "Ativa" : "Desativada"}</span>
      </div>
      <p className={pagina.secaoTexto}>
        {pessoa.ativo
          ? "Com a conta ativa, a pessoa entra com o próprio e-mail e senha."
          : "Conta desativada: a pessoa não consegue entrar. Histórico, vínculos e carteirinha continuam preservados."}
      </p>
      <p className={pagina.aviso} role="status">{aviso}</p>
      <div className={pagina.acoes}>
        <button type="button" className={desativar ? controles.rejeitar : controles.aprovar} onClick={() => { setErro(""); setAviso(""); setConfirmando(true); }}>
          {desativar ? "Desativar conta" : "Reativar conta"}
        </button>
      </div>
      <Confirmacao
        aberto={confirmando}
        titulo={desativar ? `Desativar a conta de ${nome}?` : `Reativar a conta de ${nome}?`}
        rotulo={desativar ? "Desativar conta" : "Reativar conta"}
        tom={desativar ? "perigo" : "aprovar"}
        enviando={enviando}
        erro={erro}
        aoConfirmar={confirmar}
        aoFechar={() => setConfirmando(false)}
      >
        <p className={pagina.confirmacaoTexto}>
          {desativar
            ? "A pessoa perde o acesso imediatamente e as sessões abertas são encerradas. Histórico, vínculos e carteirinha são preservados."
            : "A pessoa volta a entrar com o mesmo e-mail e senha. Sessões antigas não voltam a valer."}
        </p>
      </Confirmacao>
    </section>
  );
}
