"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { destinoDoPerfil } from "../../lib/destino-perfil";
import type { Sessao } from "../../lib/presidente";
import controles from "../ui/controles.module.css";
import tema from "../ui/tema.module.css";
import styles from "./auth-form.module.css";

export function Entrada() {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [consultando, setConsultando] = useState(true);
  const consultar = useCallback(() => {
    api<Sessao>("/sessao")
      .then(sessao => router.replace(destinoDoPerfil(sessao.usuario.perfil, new URLSearchParams(window.location.search).get("retorno"))))
      .catch(error => {
        if (error instanceof ApiError && error.status === 401) {
          const retorno = new URLSearchParams(window.location.search).get("retorno");
          router.replace(retorno ? `/login?retorno=${encodeURIComponent(retorno)}` : "/login");
        }
        else setErro(error instanceof Error ? error.message : "Não foi possível consultar sua conta.");
      }).finally(() => setConsultando(false));
  }, [router]);

  useEffect(consultar, [consultar]);

  return <div className={tema.tema}><main className={styles.principal}>
    <h1 className={styles.subtitulo}>Sua área na associação</h1>
    {erro ? <><p role="alert" className={controles.erro}>{erro}</p>
      <button type="button" className={controles.secundario} disabled={consultando} onClick={() => { setErro(""); setConsultando(true); consultar(); }}>Tentar novamente</button></>
      : <p role="status" className={styles.texto}>Abrindo sua conta…</p>}
  </main></div>;
}
