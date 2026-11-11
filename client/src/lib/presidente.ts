import { api } from "./api";

// Contratos JSON das consultas administrativas; datas da API chegam como texto ISO.
export type PerfilUsuario = "atleta" | "tecnico" | "presidente";
export type StatusVerificacao = "pendente" | "aprovado" | "rejeitado";
export type StatusCarteirinha = "ativa" | "invalidada";
export type StatusCampeonato = "planejado" | "em_andamento" | "encerrado" | "cancelado";
export type StatusJogo = "agendado" | "em_andamento" | "finalizado" | "cancelado";
export type ResultadoJogo = "normal" | "interrompido" | "abandono" | "wo";
export type TipoLancamento = "gol" | "cartaoAmarelo" | "exclusaoDoisMinutos" | "cartaoVermelho";
export type Pessoa = { id: string; nomeCompleto: string };
export type ReferenciaClube = { id: string; nome: string };
export type ClubeBasico = ReferenciaClube & { cidade: string | null };

export type Sessao = {
  usuario: Pessoa & {
    perfil: PerfilUsuario;
    statusVerificacao: StatusVerificacao | null;
    aprovado: boolean;
    clubeId: string | null;
  };
  expiresAt: string;
};
export type SessaoPresidente = Omit<Sessao, "usuario"> & {
  usuario: Sessao["usuario"] & { perfil: "presidente" };
};

export type CarteirinhaVerificacao = {
  id: string;
  codigo: string;
  status: StatusCarteirinha;
  emitidaEm: string;
  emitidaPorPresidenteId: string;
};
type SolicitacaoBase = {
  usuarioId: string;
  nomeCompleto: string;
  ativo: boolean;
  statusVerificacao: StatusVerificacao;
  verificacaoSolicitadaEm: string | null;
  verificadoPorPresidenteId: string | null;
  verificadoEm: string | null;
  clube: ReferenciaClube | null;
};
export type SolicitacaoVerificacao = SolicitacaoBase & (
  { perfil: "atleta"; carteirinha: CarteirinhaVerificacao | null }
  | { perfil: "tecnico"; carteirinha?: never }
);
export type DecisaoVerificacao = { solicitacao: SolicitacaoVerificacao; alterado: boolean };

/** Não há lista geral de contas: estas consultas cobrem os atletas e técnicos conhecidos. */
export async function consultarSolicitacoes(): Promise<SolicitacaoVerificacao[]> {
  const listas = await Promise.all((["pendente", "aprovado", "rejeitado"] as const)
    .map(status => api<SolicitacaoVerificacao[]>(`/verificacoes?status=${status}`)));
  return listas.flat().sort((a, b) => (a.verificacaoSolicitadaEm ?? "").localeCompare(b.verificacaoSolicitadaEm ?? "") || a.usuarioId.localeCompare(b.usuarioId));
}

export type Clube = ClubeBasico & {
  criadoPorPresidenteId: string;
  tecnico: (Pessoa & { ativo: boolean }) | null;
};
export type Campeonato = {
  id: string;
  nome: string;
  edicao: string;
  categoria: string;
  inicio: string | null;
  fim: string | null;
  status: StatusCampeonato;
  inscricoes: number;
};
export type Inscricao = {
  id: string;
  incluidaPorPresidenteId: string;
  incluidaEm: string;
  clube: ClubeBasico;
};
export type DetalheCampeonato = Omit<Campeonato, "inscricoes"> & {
  criadoPorPresidenteId: string;
  inscricoes: Inscricao[];
  jogos: Record<StatusJogo, number>;
};
export type TransicaoCampeonato = { campeonato: DetalheCampeonato; alterado: boolean };
export type ClubeNoJogo = { inscricaoId: string; clube: ReferenciaClube };
export type Jogo = {
  id: string;
  campeonatoId: string;
  status: StatusJogo;
  local: string | null;
  fusoHorario: string;
  inicioPrevistoEm: string | null;
  inicioPrevistoLocal: string | null;
  iniciadoEm: string | null;
  encerradoEm: string | null;
  resultado: ResultadoJogo | null;
  vencedorInscricaoId: string | null;
  invalidadoEm: string | null;
  criadoPorPresidenteId: string;
  clubeA: { inscricaoId: string; clube: ClubeBasico };
  clubeB: { inscricaoId: string; clube: ClubeBasico };
  interrompidoEm: string | null;
};
export type ArbitragemDesignada = {
  id: string;
  nomeCompleto: string | null;
  designadoPorPresidenteId: string | null;
  designadoEm: string | null;
  visualizacao: "linha" | "banco" | null;
  acessouEm: string | null;
  tipo: "cadastrado" | "externo" | "entrada_por_senha";
  usuario: (Pessoa & { perfil: PerfilUsuario }) | null;
};
export type DetalheJogo = Jogo & { arbitragens: ArbitragemDesignada[] };
export type SenhaArbitragem = { jogoId: string; senha: string; geradaEm: string };
export type TrocaSenhaArbitragem = SenhaArbitragem & { sessoesRevogadas: number };

export type Carteirinha = CarteirinhaVerificacao & {
  nomeCompleto: string;
  clubeAtual: ReferenciaClube | null;
  possuiFoto: boolean;
  tokenQr: string;
};
export type EventoCarteirinha = {
  tipo: "invalidacao" | "reativacao" | "substituicao_qr";
  versaoQr: number;
  presidenteId: string;
  ocorridoEm: string;
};
export type DetalheCarteirinha = Carteirinha & {
  atletaId: string;
  versaoQr: number;
  historico: EventoCarteirinha[];
};
export type AlteracaoCarteirinha = { carteirinha: DetalheCarteirinha; alterado: boolean };
export type VinculoClube = {
  id: string;
  inicio: string;
  fim: string | null;
  definidoPorPresidenteId: string | null;
  clube: ClubeBasico;
};
export type HistoricoVinculos = {
  atleta: { id: string; nomeCompleto: string; ativo: boolean; statusVerificacao: StatusVerificacao };
  clubeAtual: ClubeBasico | null;
  vinculos: VinculoClube[];
};

export type SituacaoSuspensao = "vigente" | "cumprida" | "revogada" | "saldo_encerrado" | "anulada";
export type ReducaoSuspensao = {
  id: string;
  quantidadeAnterior: number;
  novaQuantidade: number;
  justificativa: string | null;
  reduzidaEm: string;
  herdadaDeReducaoId: string | null;
  reduzidaPor: Pessoa | null;
};
export type Suspensao = {
  id: string;
  campeonatoId: string;
  origem: "manual" | "automatica";
  regra: "desqualificacao_com_relatorio" | null;
  jogoOrigemId: string | null;
  quantidadeJogos: number;
  quantidadeAtual: number;
  motivo: string;
  aplicadaEm: string;
  revogadaEm: string | null;
  justificativaRevogacao: string | null;
  saldoEncerradoEm: string | null;
  anuladaEm: string | null;
  atleta: Pessoa;
  aplicadaPor: Pessoa | null;
  revogadaPor: Pessoa | null;
  situacao: SituacaoSuspensao;
  jogosCumpridos: number;
  jogosRestantes: number;
  cumprimentos: { jogoId: string; registradoEm: string }[];
  reducoes: ReducaoSuspensao[];
};
export type DetalheSuspensao = Suspensao;
export type AlteracaoSuspensao = { suspensao: Suspensao; alterado: boolean };
export type Metricas = { gols: number; cartoesAmarelos: number; exclusoesDoisMinutos: number; cartoesVermelhos: number };
export type Placar = { clubeA: ClubeNoJogo; placarClubeA: number; clubeB: ClubeNoJogo; placarClubeB: number };
export type IrregularidadeParticipacao = "conta_desativada" | "carteirinha_invalidada" | "suspensao";
export type SituacaoParticipacao = {
  participacaoId: string;
  numeroCamisa: number | null;
  escalado: boolean;
  credenciado: boolean;
  entrouEmQuadra: boolean;
  entradaAnulada: boolean;
  registroAdministrativo: boolean;
  irregularidades: IrregularidadeParticipacao[];
  metricas: Metricas | null;
};
export type Participacao = SituacaoParticipacao & { inscricaoId: string; atleta: Pessoa };
export type ParticipacaoCredenciamento = {
  participacaoId: string;
  inscricaoId: string;
  atleta: Pessoa;
  numeroCamisa: number | null;
  credenciadoEm: string | null;
  entrouEmQuadraEm: string | null;
  escalado: boolean;
  entradaAnulada: { anuladaEm: string; presidenteId: string | null } | null;
  registroAdministrativo: { presidenteId: string; irregularidades: IrregularidadeParticipacao[] } | null;
};
export type AlteracaoCredenciamento = {
  id: string;
  tipo: "correcao_camisa" | "estorno";
  inscricaoId: string;
  atleta: Pessoa;
  credenciadoEm: string;
  numeroCamisaAnterior: number;
  numeroCamisaNova: number | null;
  registradaEm: string;
  entrouEmQuadraEm: string | null;
  entradaAnulada: ParticipacaoCredenciamento["entradaAnulada"];
  registroAdministrativo: ParticipacaoCredenciamento["registroAdministrativo"];
  presidenteId: string | null;
};
export type CredenciamentosJogo = {
  jogo: { id: string; status: StatusJogo };
  participacoes: ParticipacaoCredenciamento[];
  desfeitas: { participacaoId: string; inscricaoId: string; atleta: Pessoa; desfeitoEm: string }[];
  alteracoes: AlteracaoCredenciamento[];
};
export type Lancamento = {
  id: string;
  operacaoId: string;
  tipo: TipoLancamento;
  relatorioDisciplinar: boolean | null;
  valor: number;
  registradoEm: string;
  participacaoId: string | null;
  inscricaoId: string | null;
  atleta: Pessoa | null;
  numeroCamisa: number | null;
  substituiLancamentoId: string | null;
  anuladoEm: string | null;
  substituidoPorId: string | null;
};
export type RegistrosJogo = {
  jogo: { id: string; status: StatusJogo };
  placar: Placar | null;
  desempenho: (Metricas & { participacaoId: string; inscricaoId: string; atleta: Pessoa; numeroCamisa: number })[];
  lancamentos: Lancamento[];
};
export type ResumoJogoHistorico = {
  id: string;
  status: StatusJogo;
  campeonato: Pick<Campeonato, "id" | "nome" | "edicao" | "categoria">;
  local: string | null;
  fusoHorario: string;
  inicioPrevistoEm: string | null;
  iniciadoEm: string | null;
  encerradoEm: string | null;
  resultado: ResultadoJogo | null;
  vencedorInscricaoId: string | null;
  invalidadoEm: string | null;
  interrompido: boolean;
};
export type DesempenhoJogo = { jogo: ResumoJogoHistorico; placar: Placar | null; participacoes: Participacao[] };
export type JogoHistoricoAtleta = SituacaoParticipacao & {
  jogo: ResumoJogoHistorico;
  clube: ClubeNoJogo;
  adversario: ClubeNoJogo;
  placar: { clube: number; adversario: number } | null;
};
export type HistoricoAtleta = {
  atleta: Pessoa & { clubeAtual: ReferenciaClube | null };
  totais: Metricas & { participacoes: { escaladas: number; credenciadas: number; comEntradaEmQuadra: number } };
  jogos: JogoHistoricoAtleta[];
};
export type AlteracaoResultado = {
  id: string;
  tipo: "correcao" | "invalidacao";
  resultadoAnterior: ResultadoJogo;
  inscricaoVencedorAnteriorId: string | null;
  resultadoNovo: ResultadoJogo;
  inscricaoVencedorNovoId: string | null;
  motivo: string | null;
  registradaEm: string;
  presidente: Pessoa;
};
export type ResultadoDetalhado = {
  jogo: {
    id: string;
    status: StatusJogo;
    iniciadoEm: string | null;
    encerradoEm: string | null;
    resultado: ResultadoJogo | null;
    vencedor: ClubeNoJogo | null;
  };
  placar: Placar | null;
  invalidacao: { invalidadoEm: string; motivo: string | null; presidente: Pessoa | null } | null;
  interrupcoes: { interrompidoEm: string; retomadoEm: string | null }[];
  alteracoes: AlteracaoResultado[];
};
export type EscalacaoJogo = {
  jogo: Pick<Jogo, "id" | "campeonatoId" | "status" | "fusoHorario" | "inicioPrevistoEm" | "inicioPrevistoLocal">;
  clubes: {
    inscricaoId: string;
    clube: ClubeBasico;
    tecnico: Pessoa | null;
    escalados: {
      participacaoId: string;
      atleta: Pessoa;
      vinculoClubeId: string;
      vinculoAtual: boolean;
      escolhidaPorTecnico: Pessoa | null;
      escolhidaEm: string;
      suspensaoPendente: boolean;
    }[];
    alteracoes: {
      tipo: "inclusao" | "remocao";
      atleta: Pessoa;
      vinculoClubeId: string;
      tecnico: Pessoa;
      ocorridoEm: string;
    }[];
    atletasDoClube: (Pessoa & { suspensaoPendente: boolean })[];
  }[];
};
