"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import type { Sessao } from "../../lib/presidente";
import { secaoPessoal } from "../../lib/area-pessoal";
import { CabecalhoArea } from "../ui/navegacao";
import controles from "../ui/controles.module.css";
import tema from "../ui/tema.module.css";
import styles from "./pessoal.module.css";

type PerfilPessoal = "atleta" | "tecnico";
type Contexto = {
  sessao: Sessao;
  revalidar: () => Promise<void>;
  atualizarUsuario: (campos: Partial<Sessao["usuario"]>) => void;
  sair: () => Promise<void>;
  tratarErro: (erro: unknown) => string;
};
const ContextoPessoal = createContext<Contexto | null>(null);
export function useAreaPessoal() {
  const valor = useContext(ContextoPessoal);
  if (!valor) throw new Error("Área pessoal requer sessão validada.");
  return valor;
}

export function PessoalShell({ perfil, children }: { perfil: PerfilPessoal; children: ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const caminhoAtual = useRef(caminho);
  useEffect(() => { caminhoAtual.current = caminho; }, [caminho]);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [erro, setErro] = useState("");
  const consulta = useRef<Promise<void> | null>(null);
  const versao = useRef(0);
  const revalidar = useCallback(() => {
    if (consulta.current) return consulta.current;
    const atual = ++versao.current;
    const pendente = api<Sessao>("/sessao").then(nova => {
      if (atual !== versao.current) return;
      setSessao(nova); setErro("");
      if (nova.usuario.perfil !== perfil) router.replace(`/${nova.usuario.perfil}`);
    }).catch(falha => {
      if (atual !== versao.current) return;
      if (falha instanceof ApiError && falha.status === 401) { setSessao(null); router.replace(`/login?retorno=${encodeURIComponent(caminhoAtual.current)}`); }
      const mensagem = falha instanceof Error ? falha.message : "Não foi possível consultar sua conta.";
      setErro(mensagem);
      throw falha;
    }).finally(() => { if (consulta.current === pendente) consulta.current = null; });
    consulta.current = pendente;
    return pendente;
  }, [perfil, router]);
  useEffect(() => {
    const geracaoSessao = versao;
    const consultaSessao = consulta;
    void revalidar().catch(() => {});
    return () => { geracaoSessao.current++; consultaSessao.current = null; };
  }, [revalidar]);
  const atualizarUsuario = useCallback((campos: Partial<Sessao["usuario"]>) => {
    setSessao(atual => atual ? { ...atual, usuario: { ...atual.usuario, ...campos } } : atual);
  }, []);
  const tratarErro = useCallback((falha: unknown) => {
    if (falha instanceof ApiError && falha.status === 401) { versao.current++; consulta.current = null; setSessao(null); router.replace(`/login?retorno=${encodeURIComponent(caminhoAtual.current)}`); }
    if (falha instanceof ApiError && falha.status === 403) void revalidar().catch(() => {});
    return falha instanceof Error ? falha.message : "Não foi possível concluir. Tente novamente.";
  }, [revalidar, router]);
  const sair = useCallback(async () => {
    versao.current++; consulta.current = null;
    await api("/auth/sign-out", {});
    setSessao(null); router.replace("/login");
  }, [router]);
  const autorizado = sessao?.usuario.perfil === perfil;
  const base = `/${perfil}`;
  const secoes = perfil === "atleta"
    ? [{ href: base, rotulo: "Carteirinha", exata: true, icone: "/figma/pessoal/card-inativo.svg", iconeAtivo: "/figma/pessoal/card.svg", iconeTamanho: 22, iconeDesktop: "/icones/carteirinha.svg" }, { href: `${base}/historico`, rotulo: "Histórico", icone: "/figma/pessoal/historico-inativo.svg", iconeAtivo: "/figma/pessoal/historico.svg", iconeTamanho: 22, iconeDesktop: "/icones/cadastros.svg" }, { href: `${base}/clubes`, rotulo: "Clubes", icone: "/figma/pessoal/clubes-inativo.svg", iconeAtivo: "/figma/pessoal/clubes.svg", iconeTamanho: 22, iconeDesktop: "/icones/clubes.svg" }, { href: `${base}/conta`, rotulo: "Conta", icone: "/figma/pessoal/conta-inativo.svg", iconeAtivo: "/figma/pessoal/conta.svg", iconeTamanho: 22, iconeDesktop: "/icones/conta.svg" }]
    : [{ href: base, rotulo: "Jogos", exata: true }, { href: `${base}/clube`, rotulo: "Meu clube" }, { href: `${base}/conta`, rotulo: "Conta" }];
  return <div className={tema.tema}>
    <CabecalhoArea secoes={autorizado ? secoes : []} area={`Área do ${perfil === "atleta" ? "atleta" : "técnico"}`} nome={perfil === "tecnico" ? "Técnico" : "Sua conta"} contaHref={`${base}/conta`} contaIcone={perfil === "atleta" ? "/icones/conta-mobile.svg" : undefined} conteudoId="conteudo-pessoal" navegacaoInferior ativaHref={secaoPessoal(perfil, caminho)} />
    <main id="conteudo-pessoal" className={`${styles.principal} ${perfil === "atleta" ? styles.atleta : ""}`}>
      {erro && <div className={styles.pilha}><p className={controles.erro} role="alert">{erro}</p><button className={controles.secundario} onClick={() => { void revalidar().catch(() => {}); }}>Atualizar conta</button></div>}
      {!sessao && !erro && <p role="status">Consultando sua conta…</p>}
      {autorizado && <ContextoPessoal.Provider value={{ sessao, revalidar, atualizarUsuario, sair, tratarErro }}>
        <div key={`${sessao.usuario.id}:${sessao.usuario.clubeId}:${sessao.usuario.aprovado}`}>{children}</div>
      </ContextoPessoal.Provider>}
    </main>
  </div>;
}
