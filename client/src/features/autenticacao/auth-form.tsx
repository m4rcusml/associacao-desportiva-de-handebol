"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { Dialogo } from "../ui/dialogo";
import controles from "../ui/controles.module.css";
import tema from "../ui/tema.module.css";
import styles from "./auth-form.module.css";

type Clube = { id: string; nome: string; cidade?: string | null };
type Erros = Partial<Record<"nomeCompleto" | "email" | "password" | "clubeId", string>>;

export function AuthForm({ cadastro = false }: { cadastro?: boolean }) {
  const router = useRouter();
  const [perfil, setPerfil] = useState("atleta");
  const [clubes, setClubes] = useState<Clube[] | null>(null);
  const [erroClubes, setErroClubes] = useState("");
  const [erro, setErro] = useState("");
  const [campos, setCampos] = useState<Erros>({});
  const [incerto, setIncerto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [clubeId, setClubeId] = useState("");
  const [escolhendo, setEscolhendo] = useState(false);
  const [busca, setBusca] = useState("");
  const enviando = useRef(false);
  const formulario = useRef<HTMLFormElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const clubeRef = useRef<HTMLButtonElement>(null);

  async function carregarClubes() {
    setErroClubes("");
    try { setClubes(await api<Clube[]>("/clubes")); }
    catch { setErroClubes("Não foi possível carregar os clubes. Confira a conexão e tente novamente."); }
  }
  useEffect(() => {
    if (!cadastro) return;
    let ativo = true;
    api<Clube[]>("/clubes").then(lista => { if (ativo) setClubes(lista); })
      .catch(() => { if (ativo) setErroClubes("Não foi possível carregar os clubes. Confira a conexão e tente novamente."); });
    return () => { ativo = false; };
  }, [cadastro]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando.current) return;
    const form = event.currentTarget;
    const valores = new FormData(form);
    const erros: Erros = {};
    const nomes = cadastro ? ["nomeCompleto", "email", "password"] as const : ["email", "password"] as const;
    for (const nome of nomes) {
      const campo = form.elements.namedItem(nome) as HTMLInputElement;
      if (!campo.validity.valid || (nome === "nomeCompleto" && campo.value.trim().length < 3)) {
        erros[nome] = nome === "nomeCompleto" ? "Informe um nome de 3 a 150 caracteres."
          : nome === "email" ? "Informe um e-mail válido, com até 254 caracteres."
            : "Use uma senha de 8 a 128 caracteres.";
      }
    }
    if (cadastro && perfil === "atleta" && !clubeId) erros.clubeId = "Selecione seu clube inicial.";
    setCampos(erros);
    setErro(""); setIncerto(false);
    if (Object.keys(erros).length) {
      const primeiro = Object.keys(erros)[0];
      if (primeiro === "clubeId") clubeRef.current?.focus();
      else (form.elements.namedItem(primeiro) as HTMLInputElement).focus();
      return;
    }
    enviando.current = true; setBusy(true);
    try {
      const credentials = { email: valores.get("email"), password: valores.get("password") };
      if (cadastro) {
        await api("/cadastros", { ...credentials, nomeCompleto: valores.get("nomeCompleto"), perfil,
          ...(perfil === "atleta" ? { clubeId } : {}),
        });
        setConcluido(true); form.reset();
      } else {
        await api("/auth/sign-in/email", credentials);
        form.reset();
        const retorno = new URLSearchParams(window.location.search).get("retorno");
        router.replace(retorno ? `/?retorno=${encodeURIComponent(retorno)}` : "/");
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Falha de conexão. Tente novamente.");
      setIncerto(cadastro && error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.status < 400));
    } finally { enviando.current = false; setBusy(false); }
  }
  const clube = clubes?.find(item => item.id === clubeId);
  const lista = clubes?.filter(item => `${item.nome} ${item.cidade ?? ""}`.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR"))) ?? [];
  const ajuda = (nome: keyof Erros) => campos[nome] ? <p id={`${nome}-erro`} className={styles.erroCampo}>{campos[nome]}</p> : null;

  return <div className={`${tema.tema} ${styles.pagina}`}>
    <header className={styles.cabecalho}><Link href="/login" className={styles.marca}>Handebol</Link></header>
    <main className={styles.principal}>
      <aside className={styles.contexto} aria-label="A associação">
        <h2>Seu clube.<br />Seu jogo.</h2>
        <p>Carteirinha à mão para o atleta.<br />Escalação direta para o técnico.<br />Gestão clara para o presidente.</p>
        <div className={styles.associacao}><h3>Associação Desportiva de Handebol</h3><p>Um acesso para cada conta. Seu perfil leva você à área certa.</p></div>
      </aside>
      <section className={styles.painel}>
        <h1 className={styles.titulo}>{concluido ? "Cadastro recebido" : cadastro ? "Crie sua conta" : "Entre na associação"}</h1>
        {concluido ? <div className={styles.pilha} role="status">
          <p className={styles.texto}>Sua verificação esportiva está pendente de aprovação pelo presidente. Você já pode entrar na sua conta.</p>
          <Link className={controles.primario} href="/login">Entrar na conta</Link>
        </div> : <>
          <p className={styles.texto}>{cadastro ? "Seu cadastro será analisado pelo presidente." : "Use o e-mail e a senha da sua conta."}</p>
          <form ref={formulario} className={styles.formulario} onSubmit={submit} noValidate aria-busy={busy}>
            {cadastro && <>
              <fieldset className={styles.perfis} disabled={busy}><legend className={styles.srOnly}>Perfil solicitado</legend>
                {[['atleta', 'Atleta'], ['tecnico', 'Técnico']].map(([valor, rotulo]) => <button key={valor} type="button" aria-pressed={perfil === valor} className={perfil === valor ? controles.primario : controles.secundario} onClick={() => { setPerfil(valor); setCampos({}); }}>{rotulo}</button>)}
              </fieldset>
              <div className={controles.campo}><label className={controles.rotulo} htmlFor="nomeCompleto">Nome completo</label><input className={controles.entrada} id="nomeCompleto" name="nomeCompleto" autoComplete="name" minLength={3} maxLength={150} required aria-invalid={!!campos.nomeCompleto} aria-describedby={campos.nomeCompleto ? "nomeCompleto-erro" : undefined} />{ajuda("nomeCompleto")}</div>
            </>}
            <div className={controles.campo}><label className={controles.rotulo} htmlFor="email">E-mail</label><input className={controles.entrada} id="email" name="email" type="email" placeholder="Seu e-mail" autoComplete="email" maxLength={254} required aria-invalid={!!campos.email} aria-describedby={campos.email ? "email-erro" : undefined} />{ajuda("email")}</div>
            <div className={controles.campo}><label className={controles.rotulo} htmlFor="password">Senha</label><input className={controles.entrada} id="password" name="password" type="password" placeholder="Sua senha" autoComplete={cadastro ? "new-password" : "current-password"} minLength={8} maxLength={128} required aria-invalid={!!campos.password} aria-describedby={[cadastro ? "senha-ajuda" : "", campos.password ? "password-erro" : ""].filter(Boolean).join(" ") || undefined} />{ajuda("password")}</div>
            {cadastro && <p className={controles.ajuda} id="senha-ajuda">De 8 a 128 caracteres.</p>}
            {cadastro && perfil === "atleta" && <div className={controles.campo}>
              <label className={controles.rotulo} htmlFor="clubeId">Clube inicial</label>
              <button ref={clubeRef} id="clubeId" type="button" className={`${controles.entrada} ${styles.escolher}`} onClick={() => setEscolhendo(true)} disabled={busy || clubes === null || clubes.length === 0} aria-haspopup="dialog" aria-describedby={`clube-ajuda${campos.clubeId ? " clubeId-erro" : ""}`}>{clube?.nome ?? (clubes === null && !erroClubes ? "Carregando clubes…" : "Selecione seu clube")}</button>
              {ajuda("clubeId")}<p className={controles.ajuda} id="clube-ajuda">{clubes?.length === 0 ? "Nenhum clube disponível. Procure a associação." : clube ? "Confira o clube selecionado. Mudanças de vínculo dependem do presidente." : "Confira seu clube. Mudanças de vínculo dependem do presidente."}</p>
              {erroClubes && <><p className={controles.erro} role="alert">{erroClubes}</p><button type="button" className={controles.secundario} onClick={carregarClubes}>Carregar clubes novamente</button></>}
            </div>}
            {cadastro && perfil === "tecnico" && <p className={controles.ajuda}>Você começa sem clube. Após a aprovação, o presidente faz a atribuição.</p>}
            {erro && <div className={styles.pilha} role="alert"><p className={controles.erro}>{erro}</p>{incerto && <p className={controles.nota}>A resposta não foi confirmada. Seu cadastro pode ter sido recebido. Tente entrar com o e-mail e a senha antes de enviar novamente.</p>}</div>}
            <button type="submit" className={controles.primario} disabled={busy}>{busy ? "Enviando…" : cadastro ? "Solicitar cadastro" : "Entrar"}</button>
          </form>
          <Link className={cadastro ? controles.discreto : controles.secundario} href={cadastro ? "/login" : "/cadastro"}>{cadastro ? "Já tenho conta. Entrar" : "Criar conta"}</Link>
          {!cadastro && <Link className={controles.discreto} href="/arbitragem">Acesso de arbitragem</Link>}
        </>}
      </section>
    </main>
    <Dialogo aberto={escolhendo} aoFechar={() => setEscolhendo(false)} tituloId="escolher-clube" focoInicial={buscaRef} focoAlternativo={clubeRef}>
      <div className={styles.seletor}><h2 id="escolher-clube" className={styles.subtitulo}>Escolha seu clube</h2>
        <div className={controles.campo}><label htmlFor="busca-clube" className={controles.rotulo}>Buscar por nome ou cidade</label><input id="busca-clube" ref={buscaRef} className={controles.entrada} value={busca} onChange={event => setBusca(event.target.value)} type="search" /></div>
        <ul className={styles.clubes}>{lista.map(item => <li key={item.id}><button type="button" className={controles.secundario} onClick={() => { setClubeId(item.id); setEscolhendo(false); }}><span>{item.nome}{item.cidade && <small>{item.cidade}</small>}</span>{item.id === clubeId && <span>Selecionado</span>}</button></li>)}</ul>
        {lista.length === 0 && <p role="status">Nenhum clube encontrado. Tente outro nome.</p>}
        <button type="button" className={controles.discreto} onClick={() => setEscolhendo(false)}>Voltar ao cadastro</button>
      </div>
    </Dialogo>
  </div>;
}
