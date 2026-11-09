import { TipoEventoJogo } from "../../generated/prisma/client.js";
import { CAMINHO_SOCKET } from "./notificacoes.service.js";

/**
 * Contrato dos eventos Socket.IO (MAR-73), publicado em `GET /api/openapi.json` como extensão `x-socketio`, já que
 * OpenAPI não descreve canais WebSocket. Avisos sem dados: o estado oficial continua nas rotas REST.
 */
export const openapiNotificacoes = {
  path: CAMINHO_SOCKET,
  descricao: "Notificações às sessões temporárias da arbitragem do jogo, depois do commit. Somente aviso: ao receber um evento e ao (re)conectar, consulte o estado oficial pela API REST (sessão, atletas do jogo, lançamentos). Entrega ao menos uma vez; ignore id repetido. Eventos ocorridos com o dispositivo desconectado não são reenviados.",
  handshake: {
    origem: "Header Origin igual a CLIENT_ORIGIN; outra origem é recusada (HTTP 403).",
    auth: { type: "object", required: ["jogoId"], properties: { jogoId: { type: "string", format: "uuid" } } },
    cookie: "handebol.arbitragem.{jogoId} (prefixo __Host- em produção), o mesmo das rotas REST; conta permanente não assina.",
    erros: {
      jogo_invalido: "auth.jogoId ausente ou inválido",
      acesso_indisponivel: "Sem cookie temporário válido para o jogo (revogado, expirado, fora do dia, designação retirada, conta ou sessão de origem encerrada); data.motivo traz o motivo da sessão quando houver",
      indisponivel: "Falha temporária do servidor; tente novamente",
    },
  },
  eventosDoServidor: {
    "jogo:evento": {
      descricao: "Mudança confirmada no jogo. Enviado só às conexões revalidadas no momento do envio.",
      schema: {
        type: "object", required: ["id", "jogoId", "tipo", "referenciaId", "ocorridoEm"], additionalProperties: false,
        properties: {
          id: { type: "string", description: "Identificador crescente do evento (inteiro em texto); repetido em reenvio" },
          jogoId: { type: "string", format: "uuid" },
          tipo: { type: "string", enum: Object.values(TipoEventoJogo) },
          referenciaId: { type: ["string", "null"], format: "uuid", description: "Lançamento (lancamento_*), atleta (escalacao_alterada, credenciamento_*, entrada_registrada) ou arbitragem (visualizacao_alterada); null nos eventos do jogo" },
          ocorridoEm: { type: "string", format: "date-time" },
        },
      },
    },
    "acesso:encerrado": {
      descricao: "Última mensagem à conexão que deixou de estar autorizada; em seguida o servidor desconecta (sem reconexão automática). Entre novamente pela designação ou pela senha do jogo, se ainda couber.",
      schema: {
        type: "object", required: ["jogoId", "motivo"], additionalProperties: false,
        properties: {
          jogoId: { type: "string", format: "uuid" },
          motivo: { type: "string", enum: ["saida", "troca_senha", "jogo_encerrado", "jogo_adiado", "jogo_cancelado", "acesso_indisponivel"] },
        },
      },
    },
  },
  eventosDoCliente: "Nenhum: operações continuam somente pela API REST.",
};
