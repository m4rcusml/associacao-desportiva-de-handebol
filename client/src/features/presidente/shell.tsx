"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import type { Sessao, SessaoPresidente } from "../../lib/presidente";
import { destinoDoPerfil } from "../../lib/destino-perfil";
import { CabecalhoArea } from "../ui/navegacao";
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
  { href: "/presidente", rotulo: "Cadastros", exata: true, icone: "/icones/cadastros-mobile.svg", iconeAtivo: "/icones/cadastros-ativo-mobile.svg", iconeDesktop: "/icones/cadastros.svg" },
  { href: "/presidente/pessoas", rotulo: "Pessoas", exata: false, icone: "/icones/pessoas-mobile.svg", iconeAtivo: "/icones/pessoas-ativo-mobile.svg", iconeDesktop: "/icones/pessoas.svg" },
  { href: "/presidente/clubes", rotulo: "Clubes", exata: false, icone: "/icones/clubes-mobile.svg", iconeAtivo: "/icones/clubes-ativo-mobile.svg", iconeDesktop: "/icones/clubes.svg" },
  { href: "/presidente/campeonatos", rotulo: "Campeonatos", exata: false, icone: "/icones/campeonatos-mobile.svg", iconeAtivo: "/icones/campeonatos-ativo-mobile.svg", iconeDesktop: "/icones/campeonatos.svg" },
  { href: "/presidente/conta", rotulo: "Conta", exata: false, icone: "/icones/conta-nav-mobile.svg", iconeAtivo: "/icones/conta-ativo-mobile.svg", iconeDesktop: "/icones/conta.svg" },
] as const;

function ehPresidente(sessao: Sessao): sessao is SessaoPresidente {
  return sessao.usuario.perfil === "presidente";
}

export function PresidenteShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const consulta = useRef(0);
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [saindo, setSaindo] = useState(false);
  const invalidarConsulta = useCallback(() => { consulta.current += 1; }, []);

  const consultar = useCallback(() => {
    const versao = ++consulta.current;
    api<Sessao>("/sessao")
      .then(sessao => {
        if (versao !== consulta.current) return;
        if (!ehPresidente(sessao)) router.replace(destinoDoPerfil(sessao.usuario.perfil));
        else setEstado({ tipo: "pronto", sessao });
      })
      .catch(erro => {
        if (versao !== consulta.current) return;
        if (erro instanceof ApiError && erro.status === 401) router.replace(`/login?retorno=${encodeURIComponent(window.location.pathname)}`);
        else setEstado({ tipo: "falha", mensagem: "Não foi possível consultar sua conta. Confira a conexão e tente novamente." });
      });
  }, [router]);

  useEffect(() => {
    consultar();
    // A geração pertence à consulta; invalida a resposta também ao desmontar.
    return invalidarConsulta;
  }, [consultar, invalidarConsulta]);

  const sair = useCallback(async () => {
    setSaindo(true);
    consulta.current++;
    try {
      await api("/auth/sign-out", {});
      setEstado({ tipo: "carregando" });
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

  const sessao = estado.tipo === "pronto" ? estado.sessao : null;
  const presidente = sessao && ehPresidente(sessao) ? sessao : null;

  return (
    <div className={tema.tema}>
      <CabecalhoArea secoes={presidente ? SECOES : []} nome={sessao?.usuario.nomeCompleto} area="Áreas do presidente" contaHref="/presidente/conta" conteudoId="conteudo-presidente" navegacaoInferior contaIcone="/icones/conta-mobile.svg" marcaMobile="Presidente" marcaDesktop="Handebol" mostrarNomeDesktop />

      {estado.tipo === "carregando" && <main className={styles.principal}><p className={styles.situacao} role="status">Consultando sua conta…</p></main>}

      {estado.tipo === "falha" && (
        <main className={styles.principal}>
          <p className={controles.erro} role="alert">{estado.mensagem}</p>
          <button type="button" className={`${controles.secundario} ${styles.repetir}`} onClick={() => { setEstado({ tipo: "carregando" }); consultar(); }}>Tentar novamente</button>
        </main>
      )}

      {presidente && (
        <SessaoContexto.Provider value={{ sessao: presidente, renomear, sair }}>
          <main id="conteudo-presidente" className={styles.principal} aria-busy={saindo}>{children}</main>
        </SessaoContexto.Provider>
      )}
    </div>
  );
}
