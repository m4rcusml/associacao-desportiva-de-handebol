import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer, RequerAprovado } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { consultarEscalacao, escolhaSchema, escolherAtleta, retirarAtleta, traduzirErroEscalacao } from "./escalacao.js";

const tecnicoAprovado = { perfis: ["tecnico"], aprovado: true } as const;
const uuidPipe = new ParseUUIDPipe();

/**
 * Escalação preliminar (RF-016, RN-014, PEN-018, MAR-64): o técnico aprovado atual escolhe e altera os
 * atletas do próprio clube até o início do jogo; o presidente consulta, sem operação de escalação substituta.
 * Clube sem técnico apto não tem escalação: a arbitragem credenciará diretamente (MAR-67).
 */
@Controller("jogos/:jogoId/escalacao")
@UseGuards(SessionGuard)
export class EscalacaoController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private emTransacao<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient, tecnico: Ator) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // Técnico relido na transação (FOR SHARE): substituição, desativação ou desvinculação concorrente aguarda ou é vista.
      const tecnico = await this.autorizacao.revalidar(tx, ator, tecnicoAprovado);
      return operacao(tx, tecnico);
    }).catch(error => { throw traduzirErroEscalacao(error); });
  }

  @Get()
  @Requer({ perfis: ["presidente", "tecnico"], aprovado: true })
  consultar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string) {
    if (ator.perfil === "presidente") return consultarEscalacao(this.prisma, jogoId.toLowerCase());
    if (!ator.clubeId) throw new ForbiddenException("Técnico sem clube atribuído não possui escalação");
    return consultarEscalacao(this.prisma, jogoId.toLowerCase(), ator.clubeId.toLowerCase());
  }

  @Post()
  @HttpCode(200)
  @RequerAprovado("tecnico")
  escolher(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = escolhaSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe atletaId (UUID); campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, tecnico) => escolherAtleta(tx, tecnico, jogoId.toLowerCase(), parsed.data.atletaId));
  }

  @Delete(":atletaId")
  @HttpCode(200)
  @RequerAprovado("tecnico")
  retirar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Param("atletaId", uuidPipe) atletaId: string) {
    return this.emTransacao(ator, (tx, tecnico) => retirarAtleta(tx, tecnico, jogoId.toLowerCase(), atletaId.toLowerCase()));
  }
}
