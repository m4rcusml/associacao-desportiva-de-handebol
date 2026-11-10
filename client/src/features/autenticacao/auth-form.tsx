"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { LinhasQuadra } from "../ui/linhas-quadra";
import controles from "../ui/controles.module.css";
import tema from "../ui/tema.module.css";
import styles from "./auth-form.module.css";

type Clube = { id: string; nome: string };

export function AuthForm({ cadastro = false }: { cadastro?: boolean }) {
  const router = useRouter();
  const [perfil, setPerfil] = useState("atleta");
  const [clubes, setClubes] = useState<Clube[]>([]);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    if (cadastro) api<Clube[]>("/clubes").then(setClubes).catch(() => setErro("Não foi possível carregar os clubes. Recarregue a página para tentar novamente."));
  }, [cadastro]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErro("");
    setBusy(true);
    try {
      const credentials = { email: form.get("email"), password: form.get("password") };
      if (cadastro) {
        await api("/cadastros", { ...credentials, nomeCompleto: form.get("nomeCompleto"), perfil,
          ...(perfil === "atleta" ? { clubeId: form.get("clubeId") } : {}),
        });
        setConcluido(true);
      } else {
        await api("/auth/sign-in/email", credentials);
        router.replace("/presidente");
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Falha de conexão. Tente novamente.");
    } finally { setBusy(false); }
  }

  return <div className={`${tema.tema} ${styles.pagina}`}>
    <header className={styles.cabecalho}>
      <LinhasQuadra />
      <div className={styles.cabecalhoConteudo}>
        <p className={styles.marca}>Associação Desportiva de Handebol</p>
        <h1 className={styles.titulo}>{cadastro ? "Crie sua conta" : "Entre na associação"}</h1>
      </div>
    </header>
    <main className={styles.principal}>
      {concluido ? <section aria-live="polite">
        <h2 className={styles.subtitulo}>Cadastro recebido</h2>
        <p className={styles.texto}>Sua verificação esportiva está pendente de aprovação pelo presidente. Você já pode entrar na sua conta.</p>
        <Link className={styles.link} href="/login">Entrar na conta</Link>
      </section> : <>
        <p className={styles.texto}>{cadastro ? "Cadastre-se como atleta ou técnico para solicitar sua verificação." : "Acesse sua conta com e-mail e senha."}</p>
        <form className={styles.formulario} onSubmit={submit}>
          {cadastro && <>
            <div className={controles.campo}><label className={controles.rotulo} htmlFor="nomeCompleto">Nome completo</label><input className={controles.entrada} id="nomeCompleto" name="nomeCompleto" autoComplete="name" minLength={3} maxLength={150} required /></div>
            <div className={controles.campo}><label className={controles.rotulo} htmlFor="perfil">Perfil</label><select className={controles.entrada} id="perfil" name="perfil" value={perfil} onChange={e => setPerfil(e.target.value)}><option value="atleta">Atleta</option><option value="tecnico">Técnico</option></select></div>
            {perfil === "atleta" && <div className={controles.campo}><label className={controles.rotulo} htmlFor="clubeId">Clube</label><select className={controles.entrada} id="clubeId" name="clubeId" defaultValue="" required><option value="" disabled>Selecione seu clube</option>{clubes.map(clube => <option key={clube.id} value={clube.id}>{clube.nome}</option>)}</select>{clubes.length === 0 && <p className={controles.ajuda}>Se seu clube não estiver disponível, procure a associação.</p>}</div>}
          </>}
          <div className={controles.campo}><label className={controles.rotulo} htmlFor="email">E-mail</label><input className={controles.entrada} id="email" name="email" type="email" autoComplete="email" maxLength={254} required /></div>
          <div className={controles.campo}><label className={controles.rotulo} htmlFor="password">Senha</label><input className={controles.entrada} id="password" name="password" type="password" autoComplete={cadastro ? "new-password" : "current-password"} minLength={8} maxLength={128} aria-describedby={cadastro ? "senha-ajuda" : undefined} required />
            {cadastro && <p className={controles.ajuda} id="senha-ajuda">Use entre 8 e 128 caracteres.</p>}</div>
          {erro && <p className={controles.erro} role="alert">{erro}</p>}
          <button className={controles.primario} disabled={busy}>{busy ? "Aguarde…" : cadastro ? "Solicitar cadastro" : "Entrar"}</button>
        </form>
        <p className={styles.texto}>{cadastro ? "Já tem uma conta?" : "Ainda não tem conta?"} <Link className={styles.link} href={cadastro ? "/login" : "/cadastro"}>{cadastro ? "Entrar" : "Criar conta"}</Link></p>
      </>}
    </main>
  </div>;
}
