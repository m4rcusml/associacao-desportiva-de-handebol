import { HttpException, Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from "@nestjs/common";
import type { Server as HttpServer } from "node:http";
import pg from "pg";
import { Server } from "socket.io";
import { z } from "zod";
import type { MotivoRevogacaoArbitragem, TipoEventoJogo } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { revalidarArbitragem } from "../arbitragem/acesso.js";
import { cookieArbitragem, lerCookie } from "../arbitragem/arbitragem.controller.js";
import { hashToken } from "../arbitragem/senha.js";
import { AuthService } from "../autenticacao/auth.service.js";

/** Caminho do Socket.IO sob `/api`, encaminhado ao backend junto com a API REST. */
export const CAMINHO_SOCKET = "/api/socket.io";

/** Aviso de mudança confirmada no jogo; sem dados esportivos ou pessoais: o estado oficial vem da API REST. */
export interface EventoNotificado {
  /** Identificador crescente do evento (texto): reenvios do mesmo evento repetem o id. */
  id: string;
  jogoId: string;
  tipo: TipoEventoJogo;
  referenciaId: string | null;
  ocorridoEm: string;
}

/** Último aviso a uma conexão que deixou de estar autorizada, antes de desconectá-la. */
export interface AcessoEncerrado {
  jogoId: string;
  /** Motivo gravado na própria sessão temporária, ou `acesso_indisponivel` (expiração, designação retirada, conta, dia). */
  motivo: MotivoRevogacaoArbitragem | "acesso_indisponivel";
}

interface EventosServidor {
  "jogo:evento": (evento: EventoNotificado) => void;
  "acesso:encerrado": (aviso: AcessoEncerrado) => void;
}
interface DadosConexao { jogoId: string; token: string | undefined }
type Conexao = { data: DadosConexao; emit: <E extends keyof EventosServidor>(evento: E, ...args: Parameters<EventosServidor[E]>) => unknown; disconnect: (fechar?: boolean) => unknown };

const handshakeSchema = z.object({ jogoId: z.uuid().transform(id => id.toLowerCase()) });
const sala = (jogoId: string) => `jogo:${jogoId}`;
const LOTE = 100;

/**
 * Notificações por Socket.IO aos dispositivos da arbitragem autorizados no jogo (MAR-73; RNF-003, PEN-030/033).
 *
 * - Handshake: origem exata do cliente, `auth.jogoId` e o cookie temporário daquele jogo, revalidado como nas
 *   escritas (`revalidarArbitragem`). Só a sessão temporária do jogo assina; conta permanente não.
 * - Publicação confiável: os eventos ficam em `EventoJogo`, gravados na transação da mudança. O PostgreSQL entrega
 *   `NOTIFY evento_jogo` somente no commit; o publicador envia os pendentes em ordem e marca `publicadoEm`. Os que
 *   ficarem pendentes (queda do processo ou da conexão LISTEN) são enviados na inicialização e na varredura periódica.
 *   Envio ao menos uma vez: o dispositivo ignora `id` repetido e, ao (re)conectar, consulta o estado por REST.
 * - Revalidação além do handshake: antes de cada envio, cada conexão do jogo é revalidada no banco; as revogadas
 *   recebem `acesso:encerrado` e são desconectadas sem receber o evento. `NOTIFY arbitragem_revisada` (revogação,
 *   retirada da designação, logout/desativação) e a varredura periódica retiram as conexões revogadas sem evento.
 * - Uma instância, sem Redis nem adaptador entre réplicas (arquitetura); trabalho serializado nesta instância.
 */
@Injectable()
export class NotificacoesService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(NotificacoesService.name);
  private io?: Server<Record<string, never>, EventosServidor, Record<string, never>, DadosConexao>;
  private ouvinte?: pg.Client;
  private varredura?: NodeJS.Timeout;
  private encerrando = false;
  private executando = false;
  private eventosPendentes = false;
  private revisarTodas = false;
  private readonly jogosParaRevisar = new Set<string>();
  /** Intervalo da varredura de segurança (expiração, virada do dia, vínculos e NOTIFY perdido). */
  private readonly intervaloMs = Number(process.env.NOTIFICACOES_VARREDURA_MS ?? 30_000);

  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  /** Monta o Socket.IO no servidor HTTP do Nest (chamado em `createApp`). */
  anexar(httpServer: HttpServer) {
    const origem = this.auth.clientOrigin;
    this.io = new Server(httpServer, {
      path: CAMINHO_SOCKET,
      serveClient: false,
      cors: { origin: origem, credentials: true },
      // Mesmo critério das escritas REST: somente a origem exata do cliente (impede uso do cookie por outro site).
      allowRequest: (request, permitir) => permitir(null, request.headers.origin === origem),
    });
    this.io.use((socket, next) => {
      const handshake = handshakeSchema.safeParse(socket.handshake.auth);
      if (!handshake.success) return next(Object.assign(new Error("jogo_invalido"), { data: { mensagem: "Informe auth.jogoId (UUID) do jogo." } }));
      const dados = { jogoId: handshake.data.jogoId, token: lerCookie(socket.request, cookieArbitragem(handshake.data.jogoId)) };
      this.verificar(dados).then(motivo => {
        if (motivo) return next(Object.assign(new Error("acesso_indisponivel"), { data: { motivo } }));
        socket.data = dados;
        next();
      }, (error: unknown) => {
        this.logger.error("Falha ao validar conexão Socket.IO", error as Error);
        next(new Error("indisponivel"));
      });
    });
    this.io.on("connection", socket => {
      void socket.join(sala(socket.data.jogoId));
      // Revogação confirmada entre a validação do handshake e a entrada na sala: a revisão do jogo a encontra.
      this.agendar({ jogo: socket.data.jogoId });
    });
  }

  async onApplicationBootstrap() {
    if (!this.io) return;
    await this.ouvir();
    this.varredura = setInterval(() => this.agendar({ eventos: true, todas: true }), this.intervaloMs);
    this.varredura.unref();
  }

  async beforeApplicationShutdown() {
    this.encerrando = true;
    clearInterval(this.varredura);
    await this.ouvinte?.end().catch(() => undefined);
    // Fecha conexões e o engine; o servidor HTTP é fechado pelo Nest em seguida.
    this.io?.disconnectSockets(true);
    this.io?.engine.close();
  }

  /** Conexão LISTEN dedicada; ao (re)conectar processa o que ficou pendente enquanto estava fora. */
  private async ouvir() {
    if (this.encerrando) return;
    const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
    let reconectando = false;
    const reconectar = (error?: Error) => {
      if (this.encerrando || reconectando) return;
      reconectando = true;
      if (error) this.logger.warn(`Conexão LISTEN perdida: ${error.message}`);
      void cliente.end().catch(() => undefined);
      setTimeout(() => void this.ouvir().catch(erro => reconectar(erro as Error)), 1000).unref();
    };
    cliente.on("notification", ({ channel, payload }) => {
      if (channel === "evento_jogo") this.agendar({ eventos: true });
      else if (payload) this.agendar({ jogo: payload });
      else this.agendar({ todas: true });
    });
    cliente.on("error", reconectar);
    cliente.on("end", () => reconectar());
    try {
      await cliente.connect();
      await cliente.query("LISTEN evento_jogo; LISTEN arbitragem_revisada");
    } catch (error) {
      reconectar(error as Error);
      return;
    }
    this.ouvinte = cliente;
    this.agendar({ eventos: true, todas: true });
  }

  private agendar({ eventos = false, todas = false, jogo }: { eventos?: boolean; todas?: boolean; jogo?: string }) {
    if (eventos) this.eventosPendentes = true;
    if (todas) this.revisarTodas = true;
    if (jogo) this.jogosParaRevisar.add(jogo);
    if (this.executando || this.encerrando || !this.io) return;
    this.executando = true;
    void this.drenar();
  }

  /** Executa revisões e publicações uma de cada vez, até não restar trabalho; falhas são refeitas depois. */
  private async drenar() {
    try {
      while (!this.encerrando && (this.eventosPendentes || this.revisarTodas || this.jogosParaRevisar.size > 0)) {
        if (this.revisarTodas) {
          this.revisarTodas = false;
          this.jogosParaRevisar.clear();
          await this.revisar();
        } else if (this.jogosParaRevisar.size > 0) {
          const jogos = [...this.jogosParaRevisar];
          this.jogosParaRevisar.clear();
          for (const jogo of jogos) await this.revisar(jogo);
        } else {
          this.eventosPendentes = false;
          await this.publicarPendentes();
        }
      }
    } catch (error) {
      if (!this.encerrando) {
        this.logger.error("Falha ao publicar notificações; nova tentativa em seguida", error as Error);
        this.eventosPendentes = true;
        this.revisarTodas = true;
        setTimeout(() => this.agendar({}), 1000).unref();
      }
    } finally {
      this.executando = false;
    }
  }

  /** Envia os eventos pendentes em ordem de gravação, somente às conexões revalidadas, e só então os marca. */
  private async publicarPendentes() {
    for (;;) {
      const lote = await this.prisma.$queryRaw<{ id: string; jogoId: string; tipo: TipoEventoJogo; referenciaId: string | null; criadoEm: Date }[]>`
        SELECT id::text, "jogoId"::text, tipo, "referenciaId"::text, "criadoEm" FROM "EventoJogo"
        WHERE "publicadoEm" IS NULL ORDER BY id LIMIT ${LOTE}`;
      if (lote.length === 0) return;
      const porJogo = new Map<string, typeof lote>();
      for (const evento of lote) porJogo.set(evento.jogoId, [...porJogo.get(evento.jogoId) ?? [], evento]);
      for (const [jogoId, eventos] of porJogo) {
        const autorizadas = await this.revisar(jogoId);
        for (const { id, tipo, referenciaId, criadoEm } of eventos) {
          const evento: EventoNotificado = { id, jogoId, tipo, referenciaId, ocorridoEm: criadoEm.toISOString() };
          for (const conexao of autorizadas) conexao.emit("jogo:evento", evento);
        }
      }
      await this.prisma.$executeRaw`UPDATE "EventoJogo" SET "publicadoEm" = now() WHERE id = ANY(${lote.map(e => e.id)}::bigint[])`;
      if (lote.length < LOTE) return;
    }
  }

  /** Revalida as conexões do jogo (ou todas); encerra as não autorizadas e devolve as que continuam. */
  private async revisar(jogoId?: string): Promise<Conexao[]> {
    const conexoes: Conexao[] = await (jogoId ? this.io!.in(sala(jogoId)) : this.io!).fetchSockets();
    const motivos = await Promise.all(conexoes.map(conexao => this.verificar(conexao.data)));
    return conexoes.filter((conexao, i) => {
      const motivo = motivos[i];
      if (!motivo) return true;
      // Sem fechar o transporte: o aviso segue antes do pacote de desconexão, e o cliente não reconecta sozinho.
      conexao.emit("acesso:encerrado", { jogoId: conexao.data.jogoId, motivo });
      conexao.disconnect();
      return false;
    });
  }

  /** `null` se a sessão temporária continua autorizada no jogo; senão, o motivo a informar ao dispositivo. */
  private async verificar({ jogoId, token }: DadosConexao): Promise<AcessoEncerrado["motivo"] | null> {
    try {
      await this.prisma.$transaction(tx => revalidarArbitragem(tx, jogoId, token));
      return null;
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      if (!token) return "acesso_indisponivel";
      const [sessao] = await this.prisma.$queryRaw<{ motivo: MotivoRevogacaoArbitragem | null }[]>`
        SELECT s."motivoRevogacao" AS motivo FROM "SessaoArbitragem" s JOIN "Arbitragem" a ON a.id = s."arbitragemId"
        WHERE s."tokenHash" = ${hashToken(token)} AND a."jogoId" = ${jogoId}::uuid`;
      return sessao?.motivo ?? "acesso_indisponivel";
    }
  }
}
