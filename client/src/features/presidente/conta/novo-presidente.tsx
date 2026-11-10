"use client";

import { useRef, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { useErroApi } from "../../ui/use-erro-api";
import controles from "../../ui/controles.module.css";
import pagina from "../../ui/pagina.module.css";
import type { ReferenciaPresidente } from "./referencias-locais";
import styles from "./conta.module.css";

type RespostaCriacao = { usuario: { id: string; nomeCompleto: string; perfil: string }; criadoPorPresidenteId: string };
type Valores = { nome: string; email: string; senha: string };

const VAZIO: Valores = { nome: "", email: "", senha: "" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validar({ nome, email, senha }: Valores) {
  const nomeCompleto = nome.trim();
  const emailLimpo = email.trim();
  if (nomeCompleto.length < 3 || nomeCompleto.length > 150) return "Informe o nome completo com 3 a 150 caracteres.";
  if (!EMAIL.test(emailLimpo) || emailLimpo.length > 254) return "Informe um e-mail válido, com até 254 caracteres.";
  if (senha.length < 8 || senha.length > 128) return "A senha inicial deve ter de 8 a 128 caracteres.";
  return null;
}

/**
 * Cria outro presidente (`POST /presidentes`) com senha inicial. A senha fica só no estado do formulário
 * enquanto é digitada, é enviada uma vez e é apagada após o sucesso; nunca é registrada nem guardada.
 */
export function NovoPresidente({ aoCriar }: { aoCriar: (referencia: ReferenciaPresidente) => boolean }) {
  const tratarErro = useErroApi();
  const [valores, setValores] = useState<Valores>(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const emAndamento = useRef(false);
  const campoNome = useRef<HTMLInputElement>(null);

  function mudar(campo: keyof Valores, valor: string) {
    setValores(atual => ({ ...atual, [campo]: valor }));
    setAviso("");
  }

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    if (emAndamento.current) return;
    setAviso("");
    const invalido = validar(valores);
    if (invalido) { setErro(invalido); return; }
    emAndamento.current = true;
    setEnviando(true);
    setErro("");
    try {
      const { usuario } = await api<RespostaCriacao>("/presidentes", {
        nomeCompleto: valores.nome.trim(), email: valores.email.trim(), password: valores.senha,
      });
      setValores(VAZIO);
      const guardado = aoCriar({ id: usuario.id, nomeCompleto: usuario.nomeCompleto });
      setAviso(`Presidente ${usuario.nomeCompleto} criado. Repasse o e-mail e a senha inicial por um canal seguro.`
        + (guardado ? " A conta entrou na lista deste navegador." : " Este navegador não permitiu guardar a referência: anote o ID exibido na lista."));
      // O campo volta a ficar habilitado na próxima renderização.
      requestAnimationFrame(() => campoNome.current?.focus());
    } catch (falha) {
      setErro(tratarErro(falha));
    } finally {
      emAndamento.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className={pagina.secao} aria-labelledby="secao-novo-presidente">
      <h2 id="secao-novo-presidente" className={`${pagina.secaoTitulo} ${pagina.erroDecisao}`}>Novo presidente</h2>
      <p className={pagina.secaoTexto}>
        Para sucessão ou divisão de tarefas. A pessoa entra com o e-mail e a senha inicial informados aqui, e você fica
        registrado como quem criou a conta.
      </p>
      <form className={pagina.formulario} onSubmit={criar} noValidate>
        <div className={controles.campo}>
          <label className={controles.rotulo} htmlFor="novo-presidente-nome">Nome completo</label>
          <input
            ref={campoNome} id="novo-presidente-nome" className={controles.entrada} value={valores.nome}
            onChange={e => mudar("nome", e.target.value)} autoComplete="off" maxLength={150} required disabled={enviando}
          />
        </div>
        <div className={controles.campo}>
          <label className={controles.rotulo} htmlFor="novo-presidente-email">E-mail</label>
          <input
            id="novo-presidente-email" className={controles.entrada} type="email" inputMode="email" value={valores.email}
            onChange={e => mudar("email", e.target.value)} autoComplete="off" spellCheck={false} maxLength={254} required disabled={enviando}
          />
        </div>
        <div className={controles.campo}>
          <label className={controles.rotulo} htmlFor="novo-presidente-senha">Senha inicial</label>
          <input
            id="novo-presidente-senha" className={controles.entrada} type="password" value={valores.senha}
            onChange={e => mudar("senha", e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required
            disabled={enviando} aria-describedby="novo-presidente-senha-ajuda"
          />
          <p className={controles.ajuda} id="novo-presidente-senha-ajuda">De 8 a 128 caracteres. Não fica guardada nesta tela após a criação.</p>
        </div>
        {erro && <p className={controles.erro} role="alert">{erro}</p>}
        <div className={pagina.acoes}>
          <button type="submit" className={controles.primario} disabled={enviando}>{enviando ? "Criando…" : "Criar presidente"}</button>
        </div>
      </form>
      <p className={`${pagina.aviso} ${styles.avisoLongo}`} role="status">{aviso}</p>
    </section>
  );
}
