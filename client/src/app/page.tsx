"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, apiUrl } from "../lib/api";

type Sessao = { usuario: { nomeCompleto: string; perfil: string; statusVerificacao: string | null } };

export default function Home() {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`${apiUrl}/sessao`, { credentials: "include", cache: "no-store" })
      .then(async response => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error();
        setSessao(await response.json());
      })
      .catch(() => setMessage("Não foi possível consultar sua conta. Recarregue a página para tentar novamente."))
      .finally(() => setLoading(false));
  }, []);

  async function action(logout = false) {
    setBusy(true);
    setMessage("");
    try {
      if (logout) {
        await api("/auth/sign-out", {});
        setSessao(null);
        setMessage("Você saiu da conta.");
      } else {
        const data = await api<{ message: string }>("/protegida");
        setMessage(data.message);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha de conexão. Tente novamente."); }
    finally { setBusy(false); }
  }

  return <main>
    <h1>Associação Desportiva de Handebol</h1>
    {loading ? <p role="status">Consultando sua conta…</p> : sessao ? <section>
      <h2>Olá, {sessao.usuario.nomeCompleto}</h2>
      <p>Conta autenticada. Perfil: {sessao.usuario.perfil === "tecnico" ? "técnico" : sessao.usuario.perfil}.</p>
      {sessao.usuario.statusVerificacao && <p>Verificação esportiva: {sessao.usuario.statusVerificacao}. O acesso à conta não substitui a aprovação esportiva.</p>}
      <div className="actions"><button onClick={() => action()} disabled={busy}>Verificar acesso protegido</button><button className="secondary" onClick={() => action(true)} disabled={busy}>Sair da conta</button></div>
    </section> : <><p>Entre na sua conta ou solicite seu cadastro como atleta ou técnico.</p><nav className="actions" aria-label="Acesso à conta"><Link href="/login">Entrar</Link><Link href="/cadastro">Criar conta</Link></nav></>}
    <p role="status">{message}</p>
  </main>;
}
