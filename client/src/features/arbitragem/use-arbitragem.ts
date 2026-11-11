"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, apiUrl, ApiError, type ApiMethod } from "../../lib/api";
import { aceitaEvento, aplicarResposta, respostaConfirmada, type AtletasJogo, type DadosArbitragem, type Recibo, type RespostaOperacao, type SessaoArbitragem } from "../../lib/arbitragem";
import type { RegistrosJogo, SenhaArbitragem, Sessao } from "../../lib/presidente";

export type Intencao = { caminho: string; corpo: unknown; metodo?: ApiMethod; sucesso: string; tipo?: "encerramento" | "saida" };
type Estado = "consultando" | "entrada" | "ativo" | "encerrado";
const MOTIVOS: Record<string, string> = {
  jogo_encerrado: "O jogo foi encerrado. O acesso operacional terminou; correções posteriores cabem ao presidente.",
  jogo_adiado: "O jogo foi adiado. Solicite o novo acesso ao presidente.",
  jogo_cancelado: "O jogo foi cancelado. O acesso operacional terminou.",
  troca_senha: "A senha do jogo foi trocada. Entre novamente com a nova senha.",
  saida: "Você saiu da arbitragem deste jogo neste dispositivo.",
};
export function mensagemErro(erro: unknown) {
  if (erro instanceof ApiError) {
    const mensagem = (erro.data as { message?: unknown } | undefined)?.message;
    return typeof mensagem === "string" ? mensagem : erro.status === 401 ? "Acesso indisponível para este jogo. Confira sua entrada." : erro.message;
  }
  return "Não foi possível concluir. Atualize os dados e tente novamente.";
}
function detalheConflito(erro: ApiError) {
  const dados = erro.data as RespostaOperacao | undefined;
  if (dados?.participacao) return ` Estado atual: ${dados.participacao.atleta.nomeCompleto}, camisa ${dados.participacao.numeroCamisa}.`;
  if (dados?.lancamento) return ` Registro atual: ${dados.lancamento.atleta?.nomeCompleto ?? "atleta indisponível"}, camisa ${dados.lancamento.numeroCamisa ?? "—"}, ${dados.lancamento.anuladoEm ? "anulado" : "vigente"}.${dados.substituto ? ` Substituto: ${dados.substituto.atleta?.nomeCompleto}, camisa ${dados.substituto.numeroCamisa}.` : ""}`;
  return "";
}

/** Uma escrita por vez; épocas impedem que consultas ou escritas antigas restaurem um acesso revogado. */
export function useArbitragem(jogoId: string) {
  const base = `/arbitragem/jogos/${jogoId}`;
  const [estado, setEstado] = useState<Estado>("consultando");
  const [dados, setDados] = useState<DadosArbitragem | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [sincronizado, setSincronizado] = useState(false);
  const [conexao, setConexao] = useState("Conectando…");
  const [pendente, setPendente] = useState<Intencao | null>(null);
  const [recibo, setRecibo] = useState<Recibo | null>(null);
  const [confirmacaoLancamento, setConfirmacaoLancamento] = useState(0);
  const vida = useRef(true);
  const epoca = useRef(0);
  const versao = useRef(0);
  const acesso = useRef(false);
  const ocupado = useRef(false);
  const pendenteRef = useRef<Intencao | null>(null);
  const socket = useRef<Socket | null>(null);
  const refrescarDepois = useRef(false);
  const consultaEmVoo = useRef<{ era: number } | null>(null);

  const retirarAcesso = useCallback((razao: string) => {
    epoca.current++;
    versao.current++;
    acesso.current = false;
    socket.current?.disconnect();
    setDados(null);
    setSincronizado(false);
    setAtualizando(false);
    setEstado("encerrado");
    setErro(""); setAviso("");
    setMotivo(MOTIVOS[razao] ?? "Seu acesso a este jogo foi encerrado ou ficou indisponível. Confira com o presidente.");
    // O encerramento pode ter sido confirmado antes de o aviso chegar: conserva somente seu corpo para recuperar o recibo.
    if (pendenteRef.current?.tipo !== "encerramento") {
      pendenteRef.current = null;
      setPendente(null);
    }
  }, []);

  const atualizar = useCallback(async (inicial = false): Promise<boolean> => {
    if (!vida.current || (!inicial && !acesso.current)) return false;
    if (ocupado.current) { refrescarDepois.current = true; return false; }
    if (consultaEmVoo.current?.era === epoca.current) { refrescarDepois.current = true; return false; }
    const consulta = { era: epoca.current };
    consultaEmVoo.current = consulta;
    refrescarDepois.current = false;
    const leitura = ++versao.current;
    const era = epoca.current;
    const vigente = () => vida.current && era === epoca.current && leitura === versao.current;
    setAtualizando(true);
    try {
      const sessao = await api<SessaoArbitragem>(`${base}/sessao`);
      if (!vigente()) return false;
      const [atletas, registros] = await Promise.all([api<AtletasJogo>(`${base}/atletas`), api<RegistrosJogo>(`${base}/lancamentos`)]);
      if (!vigente()) return false;
      acesso.current = true;
      setDados({ sessao, atletas, registros });
      setEstado("ativo");
      setSincronizado(typeof navigator === "undefined" || navigator.onLine);
      return true;
    } catch (falha) {
      if (!vigente()) return false;
      setSincronizado(false);
      if (falha instanceof ApiError && [401, 403].includes(falha.status)) {
        if (inicial && !acesso.current) { setDados(null); setEstado("entrada"); setMotivo(mensagemErro(falha)); }
        else retirarAcesso("acesso_indisponivel");
      } else {
        setErro(`${mensagemErro(falha)} ${acesso.current ? "Os dados exibidos podem estar desatualizados. Atualize antes de continuar." : ""}`);
        if (inicial) setEstado("entrada");
      }
      return false;
    } finally {
      if (consultaEmVoo.current === consulta) {
        consultaEmVoo.current = null;
        if (vida.current) setAtualizando(false);
        if (vida.current && acesso.current && refrescarDepois.current && !ocupado.current) { refrescarDepois.current = false; void atualizar(); }
      }
    }
  }, [base, retirarAcesso]);

  const desmontar = useCallback(() => { vida.current = false; epoca.current++; versao.current++; acesso.current = false; }, []);
  useEffect(() => {
    vida.current = true;
    void atualizar(true);
    return desmontar;
  }, [atualizar, desmontar]);

  useEffect(() => {
    const offline = () => { versao.current++; setAtualizando(false); setSincronizado(false); setConexao("Sem internet. Reconecte e atualize os dados."); };
    const online = () => { setConexao("Reconectando…"); void atualizar(); };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, [atualizar]);

  const ativo = estado === "ativo";
  useEffect(() => {
    if (!ativo) return;
    const url = new URL(apiUrl, window.location.origin);
    const canal = io(url.origin, { path: `${url.pathname.replace(/\/$/, "")}/socket.io`, withCredentials: true, auth: { jogoId }, transports: ["polling"] });
    socket.current = canal;
    const ids = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; void atualizar(); }, 120);
    };
    canal.on("connect", () => { setConexao("Conectado ao jogo"); setSincronizado(false); agendar(); });
    canal.on("disconnect", () => {
      if (acesso.current) { setConexao("Reconectando… Use Atualizar para conferir o servidor."); setSincronizado(false); }
    });
    canal.on("connect_error", (falha: Error & { data?: { motivo?: string } }) => {
      if (!acesso.current) return;
      setConexao("Reconectando… Use Atualizar para conferir o servidor.");
      setSincronizado(false);
      if (falha.message === "acesso_indisponivel" || falha.data?.motivo) agendar();
    });
    canal.on("jogo:evento", (evento: { id?: unknown; jogoId?: string }) => {
      if (evento.jogoId === jogoId && aceitaEvento(ids, evento.id)) agendar();
    });
    canal.on("acesso:encerrado", (evento: { jogoId?: string; motivo?: string }) => {
      if (evento.jogoId === jogoId) retirarAcesso(evento.motivo ?? "acesso_indisponivel");
    });
    return () => { if (timer) clearTimeout(timer); canal.removeAllListeners(); canal.disconnect(); if (socket.current === canal) socket.current = null; };
  }, [ativo, jogoId, atualizar, retirarAcesso]);

  async function entrar(caminho: string, corpo: unknown) {
    if (ocupado.current || acesso.current) return false;
    ocupado.current = true;
    const era = epoca.current;
    setEnviando(true); setErro(""); setMotivo(""); versao.current++;
    let entrou = false;
    try {
      await api<SessaoArbitragem>(`${base}/entrada/${caminho}`, corpo);
      if (!vida.current || era !== epoca.current) return false;
      acesso.current = true;
      entrou = true;
    } catch (falha) {
      if (vida.current && era === epoca.current) setErro(mensagemErro(falha));
    } finally { ocupado.current = false; if (vida.current) setEnviando(false); }
    if (entrou) await atualizar();
    return entrou;
  }

  async function executar(intencao: Intencao, reenvio = false) {
    const recuperarEncerramento = reenvio && intencao.tipo === "encerramento";
    if (ocupado.current || !navigator.onLine || (!recuperarEncerramento && (!acesso.current || !sincronizado)) || (!reenvio && pendenteRef.current)) return false;
    ocupado.current = true;
    pendenteRef.current = intencao;
    setPendente(null);
    setEnviando(true); setErro(""); setAviso(""); setAtualizando(false);
    versao.current++;
    const era = epoca.current;
    let sucesso = false;
    try {
      const resposta = await api<RespostaOperacao | Recibo>(`${base}${intencao.caminho}`, intencao.corpo, intencao.metodo ?? "POST");
      if (!respostaConfirmada(intencao.caminho, resposta)) throw new ApiError("Resposta incompleta do servidor.", 200);
      if (!vida.current) return false;
      if (intencao.tipo === "encerramento") {
        setRecibo(resposta as Recibo);
        retirarAcesso("jogo_encerrado");
        setErro("");
      } else if (era !== epoca.current) return false;
      else if (intencao.tipo === "saida") retirarAcesso("saida");
      else setDados(atual => atual ? aplicarResposta(atual, resposta as RespostaOperacao) : null);
      pendenteRef.current = null; setPendente(null);
      if (intencao.caminho === "/lancamentos") setConfirmacaoLancamento(atual => atual + 1);
      setAviso(intencao.sucesso);
      sucesso = true;
    } catch (falha) {
      if (!vida.current) return false;
      const incerto = !(falha instanceof ApiError) || falha.status === 0 || falha.status >= 500 || (falha.status >= 200 && falha.status < 300);
      if (incerto && (era === epoca.current || intencao.tipo === "encerramento")) {
        setPendente(intencao);
        setErro("O servidor não confirmou a resposta. A operação pode ter sido gravada. Confira os dados e use Reenviar a mesma operação para consultar ou concluir esta tentativa.");
        setSincronizado(false);
      } else if (era === epoca.current) {
        pendenteRef.current = null; setPendente(null);
        if (falha instanceof ApiError && [401, 403].includes(falha.status)) retirarAcesso("acesso_indisponivel");
        else {
          const conflito = falha instanceof ApiError && falha.status === 409;
          setErro(mensagemErro(falha) + (conflito ? detalheConflito(falha) : ""));
          if (conflito && falha.data && typeof falha.data === "object") setDados(atual => atual ? aplicarResposta(atual, falha.data as RespostaOperacao) : null);
        }
      } else { pendenteRef.current = null; setPendente(null); }
    } finally {
      ocupado.current = false;
      if (vida.current) {
        setEnviando(false);
        if (acesso.current) { refrescarDepois.current = false; void atualizar(); }
      }
    }
    return sucesso;
  }

  async function ler<T>(caminho: string, corpo?: unknown): Promise<T | null> {
    if (ocupado.current || !acesso.current || !sincronizado || pendenteRef.current || !navigator.onLine) return null;
    ocupado.current = true; setEnviando(true); setErro("");
    versao.current++;
    const era = epoca.current;
    try {
      const resposta = await api<T>(`${base}${caminho}`, corpo);
      return vida.current && era === epoca.current ? resposta : null;
    } catch (falha) {
      if (vida.current && era === epoca.current) {
        setErro(mensagemErro(falha));
        if (falha instanceof ApiError && [401, 403].includes(falha.status)) retirarAcesso("acesso_indisponivel");
      }
      return null;
    } finally { ocupado.current = false; if (vida.current) { setEnviando(false); if (refrescarDepois.current) { refrescarDepois.current = false; void atualizar(); } } }
  }
  function abandonar() { if (ocupado.current) return; pendenteRef.current = null; setPendente(null); setErro(""); setAviso("Tentativa abandonada neste dispositivo. Isso não desfaz uma operação já gravada."); }

  async function gerirSenha(trocar: boolean): Promise<SenhaArbitragem | null> {
    if (ocupado.current || !acesso.current || !sincronizado || pendenteRef.current || !navigator.onLine || dados?.sessao.sessao.metodoEntrada !== "designacao" || !dados.sessao.podeGerirSenhaPelaConta) return null;
    ocupado.current = true; setEnviando(true); setErro(""); versao.current++;
    const era = epoca.current;
    try {
      const conta = await api<Sessao>("/sessao");
      if (!vida.current || era !== epoca.current) return null;
      if (!conta.usuario.aprovado || !["atleta", "tecnico"].includes(conta.usuario.perfil)) throw new Error("Conta designada indisponível.");
      const senha = await api<SenhaArbitragem>(`/jogos/${jogoId}/arbitragem/senha${trocar ? "/troca" : ""}`, trocar ? {} : undefined);
      if (!vida.current || era !== epoca.current) return null;
      if (trocar) setAviso("Senha trocada. Os acessos por senha foram encerrados; os acessos por designação permanecem.");
      return senha;
    } catch (falha) {
      if (vida.current && era === epoca.current) setErro(`${mensagemErro(falha)}${trocar ? " Se a resposta se perdeu, consulte a senha atual antes de solicitar outra troca." : ""}`);
      return null;
    } finally { ocupado.current = false; if (vida.current) { setEnviando(false); if (acesso.current) void atualizar(); } }
  }
  function prepararEntrada() { if (ocupado.current || pendenteRef.current) return; setErro(""); setAviso(""); setEstado("entrada"); }
  const fotoSemAcesso = useCallback((status: number) => {
    if (status === 401) retirarAcesso("acesso_indisponivel");
    else if (status === 403) void atualizar();
  }, [atualizar, retirarAcesso]);

  return { estado, dados, erro, aviso, motivo, enviando, atualizando, sincronizado, conexao, pendente, recibo, confirmacaoLancamento, entrar, executar, ler, atualizar, abandonar, gerirSenha, prepararEntrada, fotoSemAcesso,
    bloqueado: enviando || !sincronizado || !!pendente, retirarAcesso };
}
