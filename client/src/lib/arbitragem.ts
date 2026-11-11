import type { ClubeNoJogo, Jogo, Lancamento, ParticipacaoCredenciamento, Pessoa, Placar, RegistrosJogo, ResultadoJogo } from "./presidente";

export type Visualizacao = "linha" | "banco";
export type SessaoArbitragem = {
  jogo: Pick<Jogo, "id" | "status" | "local" | "fusoHorario" | "inicioPrevistoEm" | "inicioPrevistoLocal" | "iniciadoEm" | "interrompidoEm"> & { clubeA: ClubeNoJogo; clubeB: ClubeNoJogo };
  arbitragem: Pessoa & { visualizacao: Visualizacao | null };
  sessao: { metodoEntrada: "designacao" | "senha"; expiraEm: string };
  podeGerirSenhaPelaConta: boolean;
};
export type Credenciamento = Omit<ParticipacaoCredenciamento, "entradaAnulada" | "registroAdministrativo"> & Partial<Pick<ParticipacaoCredenciamento, "entradaAnulada" | "registroAdministrativo">>;
export type Impedimento = "nao_aprovado" | "sem_vinculo_com_clubes_do_jogo" | "conta_desativada" | "carteirinha_invalidada" | "suspensao";
export type AtletaJogo = { atleta: Pessoa; escalado: boolean; credenciamento: Credenciamento | null; impedimento: Impedimento | null };
export type ElencoJogo = ClubeNoJogo & { atletas: AtletaJogo[] };
export type AtletasJogo = { jogo: RegistrosJogo["jogo"]; clubes: ElencoJogo[] };
export type LeituraQr = { atleta: Pessoa; carteirinha: { codigo: string; status: string }; clube: ClubeNoJogo | null; credenciamento: Credenciamento | null; impedimento: Impedimento | null };
export type Recibo = { jogo: { id: string; status: string; iniciadoEm: string | null; encerradoEm: string | null; resultado: ResultadoJogo; vencedor: ClubeNoJogo | null }; placar: Placar | null; alterado: boolean };
export type DadosArbitragem = { sessao: SessaoArbitragem; atletas: AtletasJogo; registros: RegistrosJogo };
export type RespostaOperacao = Partial<SessaoArbitragem> & {
  participacao?: Credenciamento;
  estorno?: { inscricaoId: string; atleta: Pessoa };
  lancamento?: Lancamento;
  anulado?: Lancamento;
  substituto?: Lancamento | null;
  placar?: Placar | null;
  alterado?: boolean;
};
export const TIPOS_LANCAMENTO = { gol: "Gol", cartaoAmarelo: "Cartão amarelo", exclusaoDoisMinutos: "Exclusão de 2 minutos", cartaoVermelho: "Cartão vermelho" } as const;
export const IMPEDIMENTOS: Record<Impedimento, string> = {
  nao_aprovado: "Atleta ainda não aprovado.",
  sem_vinculo_com_clubes_do_jogo: "Atleta sem vínculo atual com um dos clubes deste jogo.",
  conta_desativada: "Conta do atleta desativada.",
  carteirinha_invalidada: "Carteirinha do atleta invalidada.",
  suspensao: "Atleta com suspensão a cumprir neste campeonato.",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function idJogo(valor: string, origem: string): string | null {
  const texto = valor.trim();
  if (UUID.test(texto)) return texto.toLowerCase();
  try {
    const url = new URL(texto, origem);
    if (url.origin !== origem || url.search || url.hash || url.username || url.password) return null;
    const id = /^\/arbitragem\/jogos\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    return id && UUID.test(id) ? id.toLowerCase() : null;
  } catch { return null; }
}
export function numeroCamisa(valor: string): number | null {
  if (!/^\d+$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 && numero <= 2_147_483_647 ? numero : null;
}
export function podeEstornar(p: Credenciamento, lancamentos: Lancamento[]) {
  return !p.entrouEmQuadraEm && !lancamentos.some(l => l.participacaoId === p.participacaoId);
}
export function aceitaEvento(ids: Set<string>, id: unknown) {
  if (typeof id !== "string" || !id || ids.has(id)) return false;
  ids.add(id);
  if (ids.size > 256) ids.delete(ids.values().next().value!);
  return true;
}
/** O alvo de Desfazer é o registro exibido, nunca uma alteração local do placar. */
export function ultimoLancamento(lancamentos: Lancamento[]): Lancamento | null {
  return lancamentos.reduce<Lancamento | null>((ultimo, atual) => !ultimo || atual.registradoEm > ultimo.registradoEm || (atual.registradoEm === ultimo.registradoEm && atual.id > ultimo.id) ? atual : ultimo, null);
}
/** Um 2xx sem o recibo esperado também é incerto: não autoriza criar outra intenção. */
export function respostaConfirmada(caminho: string, valor: unknown): boolean {
  if (!valor || typeof valor !== "object") return false;
  const r = valor as Record<string, unknown>;
  const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
  if (caminho === "/saida") return typeof r.encerrada === "boolean";
  if (caminho === "/visualizacao" || ["/inicio", "/interrupcao", "/retomada"].includes(caminho)) return objeto(r.jogo) && typeof r.jogo.id === "string" && objeto(r.arbitragem) && objeto(r.sessao);
  if (typeof r.alterado !== "boolean") return false;
  if (caminho === "/encerramento") return objeto(r.jogo) && r.jogo.status === "finalizado" && typeof r.jogo.id === "string" && ["normal", "interrompido", "abandono", "wo"].includes(String(r.jogo.resultado)) && "vencedor" in r.jogo && "placar" in r;
  if (caminho.endsWith("/estorno")) return objeto(r.estorno) && objeto(r.estorno.atleta) && typeof r.estorno.atleta.id === "string";
  if (caminho.startsWith("/credenciamentos")) return objeto(r.participacao) && typeof r.participacao.participacaoId === "string" && objeto(r.participacao.atleta);
  if (caminho.startsWith("/lancamentos")) return objeto(r.lancamento) && typeof r.lancamento.id === "string" && "placar" in r;
  return false;
}
/** Respostas confirmadas entram antes da releitura; falhar o GET não desfaz o sucesso. */
export function aplicarResposta(dados: DadosArbitragem, resposta: RespostaOperacao): DadosArbitragem {
  const p = resposta.participacao;
  const clubes = dados.atletas.clubes.map(clube => {
    const atletas = clube.atletas.map(a => {
      if (p && a.atleta.id === p.atleta.id && clube.inscricaoId === p.inscricaoId) return { ...a, escalado: p.escalado, credenciamento: p, impedimento: null };
      if (resposta.estorno?.atleta.id === a.atleta.id && resposta.estorno.inscricaoId === clube.inscricaoId) return { ...a, credenciamento: null };
      return a;
    });
    if (p && p.inscricaoId === clube.inscricaoId && !atletas.some(a => a.atleta.id === p.atleta.id)) atletas.push({ atleta: p.atleta, escalado: p.escalado, credenciamento: p, impedimento: null });
    return { ...clube, atletas };
  });
  const alterados = [resposta.anulado, resposta.lancamento, resposta.substituto].filter((l): l is Lancamento => !!l);
  const porId = new Map(dados.registros.lancamentos.map(l => [l.id, l]));
  for (const l of alterados) porId.set(l.id, l);
  const sessao = resposta.jogo && resposta.arbitragem && resposta.sessao ? resposta as SessaoArbitragem : dados.sessao;
  const lancamentos = [...porId.values()];
  // O desempenho também é derivado dos registros oficiais, sem manter totais antigos após um POST.
  const desempenho = clubes.flatMap(c => c.atletas.flatMap(a => {
    const p = a.credenciamento;
    if (!p || p.numeroCamisa === null) return [];
    const vigentes = lancamentos.filter(l => l.participacaoId === p.participacaoId && !l.anuladoEm);
    return [{ participacaoId: p.participacaoId, inscricaoId: p.inscricaoId, atleta: p.atleta, numeroCamisa: p.numeroCamisa,
      gols: vigentes.filter(l => l.tipo === "gol").length, cartoesAmarelos: vigentes.filter(l => l.tipo === "cartaoAmarelo").length,
      exclusoesDoisMinutos: vigentes.filter(l => l.tipo === "exclusaoDoisMinutos").length, cartoesVermelhos: vigentes.filter(l => l.tipo === "cartaoVermelho").length }];
  }));
  return { sessao, atletas: { ...dados.atletas, clubes, jogo: { id: sessao.jogo.id, status: sessao.jogo.status } }, registros: { ...dados.registros, jogo: { id: sessao.jogo.id, status: sessao.jogo.status }, lancamentos, desempenho, placar: resposta.placar === undefined ? dados.registros.placar : resposta.placar } };
}
