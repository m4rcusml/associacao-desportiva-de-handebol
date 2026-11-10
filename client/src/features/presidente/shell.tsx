"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import type { Sessao, SessaoPresidente } from "../../lib/presidente";
import { LinhasQuadra } from "../ui/linhas-quadra";
import controles from "../ui/controles.module.css";
import tema from "../ui/tema.module.css";
import styles from "./shell.module.css";

type Estado = { tipo: "carregando" } | { tipo: "falha"; mensagem: string } | { tipo: "pronto"; sessao: Sessao };

type ContextoSessao = {
  sessao: SessaoPresidente;
  /** Atualiza o nome exibido depois de `PATCH /conta` confirmado pelo servidor. */
  renomear: (nomeCompleto: string) => void;
  /** Encerra a sessão e leva ao login; rejeita se o servidor não confirmar. */
  sair: () => Promise<void>;
};

const SessaoContexto = createContext<ContextoSessao | null>(null);

/** Sessão do presidente autenticado, disponível dentro de `PresidenteShell`. */
export function useSessaoPresidente() {
  const contexto = useContext(SessaoContexto);
  if (!contexto) throw new Error("useSessaoPresidente deve ser usado dentro de PresidenteShell.");
  return contexto;
}

/** Seções do presidente. `exata`: só a própria rota; as demais também valem para as sub-rotas. */
const SECOES = [
  { href: "/presidente", rotulo: "Cadastros", exata: true },
  { href: "/presidente/pessoas", rotulo: "Pessoas", exata: false },
  { href: "/presidente/clubes", rotulo: "Clubes", exata: false },
  { href: "/presidente/campeonatos", rotulo: "Campeonatos", exata: false },
  { href: "/presidente/conta", rotulo: "Conta", exata: false },
] as const;

function secaoAtual(caminho: string, secao: (typeof SECOES)[number]) {
  return caminho === secao.href || (!secao.exata && caminho.startsWith(`${secao.href}/`));
}

const NOME_PERFIL = { atleta: "atleta", tecnico: "técnico", presidente: "presidente" } as const;
const NOME_VERIFICACAO: Record<string, string> = { pendente: "pendente", aprovado: "aprovada", rejeitado: "rejeitada" };

function ehPresidente(sessao: Sessao): sessao is SessaoPresidente {
  return sessao.usuario.perfil === "presidente";
}

export function PresidenteShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [saindo, setSaindo] = useState(false);

  const consultar = useCallback(() => {
    api<Sessao>("/sessao")
      .then(sessao => setEstado({ tipo: "pronto", sessao }))
      .catch(erro => {
        if (erro instanceof ApiError && erro.status === 401) router.replace("/login");
        else setEstado({ tipo: "falha", mensagem: "Não foi possível consultar sua conta. Confira a conexão e tente novamente." });
      });
  }, [router]);

  useEffect(consultar, [consultar]);

  const sair = useCallback(async () => {
    setSaindo(true);
    try {
      await api("/auth/sign-out", {});
      router.replace("/login");
    } catch (erro) {
      setSaindo(false);
      throw erro;
    }
  }, [router]);

  const renomear = useCallback((nomeCompleto: string) => {
    setEstado(atual => atual.tipo === "pronto"
      ? { tipo: "pronto", sessao: { ...atual.sessao, usuario: { ...atual.sessao.usuario, nomeCompleto } } }
      : atual);
  }, []);

  function sairPeloCabecalho() {
    sair().catch(() => setEstado({ tipo: "falha", mensagem: "Não foi possível sair da conta. Tente novamente." }));
  }

  const sessao = estado.tipo === "pronto" ? estado.sessao : null;
  const presidente = sessao && ehPresidente(sessao) ? sessao : null;
  const contexto = useMemo(() => (presidente ? { sessao: presidente, renomear, sair } : null), [presidente, renomear, sair]);

  return (
    <div className={tema.tema}>
      <header className={styles.cabecalho}>
        <LinhasQuadra />
        <div className={styles.barra}>
          <p className={styles.marca}>Associação Desportiva de Handebol</p>
          {sessao && (
            <div className={styles.conta}>
              <span className={styles.usuario}>{sessao.usuario.nomeCompleto}</span>
              <button type="button" className={styles.sair} onClick={sairPeloCabecalho} disabled={saindo}>{saindo ? "Saindo…" : "Sair"}</button>
            </div>
          )}
        </div>
        {presidente && (
          <nav className={styles.secoes} aria-label="Áreas do presidente">
            {SECOES.map(s => (
              <Link key={s.href} href={s.href} className={styles.secao} aria-current={secaoAtual(caminho, s) ? "page" : undefined}>{s.rotulo}</Link>
            ))}
          </nav>
        )}
      </header>

      {estado.tipo === "carregando" && <main className={styles.principal}><p className={styles.situacao} role="status">Consultando sua conta…</p></main>}

      {estado.tipo === "falha" && (
        <main className={styles.principal}>
          <p className={controles.erro} role="alert">{estado.mensagem}</p>
          <button type="button" className={`${controles.secundario} ${styles.repetir}`} onClick={() => { setEstado({ tipo: "carregando" }); consultar(); }}>Tentar novamente</button>
        </main>
      )}

      {sessao && !presidente && (
        <main className={styles.principal}>
          <h1 className={styles.titulo}>Área restrita ao presidente</h1>
          <p className={styles.texto}>
            Você entrou como {NOME_PERFIL[sessao.usuario.perfil]}
            {sessao.usuario.statusVerificacao ? `, com verificação esportiva ${NOME_VERIFICACAO[sessao.usuario.statusVerificacao] ?? sessao.usuario.statusVerificacao}` : ""}.
            As telas de atletas e técnicos ainda não estão disponíveis nesta versão.
          </p>
        </main>
      )}

      {contexto && (
        <SessaoContexto.Provider value={contexto}>
          <main className={styles.principal}>{children}</main>
        </SessaoContexto.Provider>
      )}
    </div>
  );
}
