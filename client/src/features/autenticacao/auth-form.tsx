"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";

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
        router.replace("/");
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Falha de conexão. Tente novamente.");
    } finally { setBusy(false); }
  }

  return <main className="auth">
    <Link href="/">Associação Desportiva de Handebol</Link>
    <h1>{cadastro ? "Crie sua conta" : "Entre na associação"}</h1>
    {concluido ? <section aria-live="polite"><h2>Cadastro recebido</h2><p>Sua verificação esportiva está pendente de aprovação pelo presidente. Você já pode entrar na sua conta.</p><Link href="/login">Entrar na conta</Link></section> : <>
      <p>{cadastro ? "Cadastre-se como atleta ou técnico para solicitar sua verificação." : "Acesse sua conta com e-mail e senha."}</p>
      <form onSubmit={submit}>
        {cadastro && <>
          <label htmlFor="nomeCompleto">Nome completo</label><input id="nomeCompleto" name="nomeCompleto" autoComplete="name" minLength={3} maxLength={150} required />
          <label htmlFor="perfil">Perfil</label><select id="perfil" name="perfil" value={perfil} onChange={e => setPerfil(e.target.value)}><option value="atleta">Atleta</option><option value="tecnico">Técnico</option></select>
          {perfil === "atleta" && <><label htmlFor="clubeId">Clube</label><select id="clubeId" name="clubeId" defaultValue="" required><option value="" disabled>Selecione seu clube</option>{clubes.map(clube => <option key={clube.id} value={clube.id}>{clube.nome}</option>)}</select>{clubes.length === 0 && <p>Se seu clube não estiver disponível, procure a associação.</p>}</>}
        </>}
        <label htmlFor="email">E-mail</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
        <label htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete={cadastro ? "new-password" : "current-password"} minLength={8} maxLength={128} aria-describedby={cadastro ? "senha-ajuda" : undefined} required />
        {cadastro && <p id="senha-ajuda">Use entre 8 e 128 caracteres.</p>}
        {erro && <p role="alert">{erro}</p>}
        <button disabled={busy}>{busy ? "Aguarde…" : cadastro ? "Solicitar cadastro" : "Entrar"}</button>
      </form>
      <p>{cadastro ? "Já tem uma conta?" : "Ainda não tem conta?"} <Link href={cadastro ? "/login" : "/cadastro"}>{cadastro ? "Entrar" : "Criar conta"}</Link></p>
    </>}
  </main>;
}
