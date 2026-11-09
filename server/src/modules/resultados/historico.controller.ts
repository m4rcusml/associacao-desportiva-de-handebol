import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator, Requisito } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { consultarDesempenhoDoJogo, consultarHistoricoDoAtleta } from "./historico.js";

const uuidPipe = new ParseUUIDPipe();
const presidenteOuTecnico: Requisito = { perfis: ["presidente", "tecnico"], aprovado: true };
const aprovado: Requisito = { aprovado: true };

/**
 * Resultados e histórico esportivo (RF-033, RN-008, RN-036, MAR-74), somente leitura e sem divulgação pública.
 * O ator é relido na transação (técnico trocado de clube ou conta desativada deixam de consultar).
 */
@Controller()
@UseGuards(SessionGuard)
export class HistoricoController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private comAtor<T>(ator: Ator, requisito: Requisito, consulta: (tx: Prisma.TransactionClient, ator: Ator) => Promise<T>) {
    return this.prisma.$transaction(async tx => consulta(tx, await this.autorizacao.revalidar(tx, ator, requisito)));
  }

  @Get("jogos/:jogoId/desempenho")
  @Requer(presidenteOuTecnico)
  desempenho(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.comAtor(ator, presidenteOuTecnico, (tx, atual) => consultarDesempenhoDoJogo(tx, atual, jogoId.toLowerCase()));
  }

  @Get("atletas/:atletaId/historico")
  @Requer(aprovado)
  historico(@AtorAtual() ator: Ator, @Param("atletaId", uuidPipe) atletaId: string) {
    return this.comAtor(ator, aprovado, (tx, atual) => consultarHistoricoDoAtleta(tx, atual, atletaId.toLowerCase()));
  }
}
