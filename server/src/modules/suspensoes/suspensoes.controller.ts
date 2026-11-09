import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import {
  aplicarSuspensao, filtroSuspensoesSchema, listarSuspensoes, novaSuspensaoSchema, reducaoSuspensaoSchema, reduzirSuspensao, revogacaoSuspensaoSchema,
  revogarSuspensao, traduzirErroSuspensao,
} from "./suspensoes.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const uuidPipe = new ParseUUIDPipe();

/**
 * Suspensões manuais (RF-038/041, MAR-66): somente o presidente aplica, reduz e revoga com justificativa (MAR-84) e
 * consulta saldo e jogos cumpridos; a redução e a revogação valem também para as automáticas (MAR-79).
 * Visibilidade para atleta, técnico e público fica para as tarefas que dependem dela (MAR-67/MAR-74). O
 * cumprimento é registrado no encerramento do jogo (`registrarCumprimentos`), sem rota própria.
 */
@Controller("campeonatos/:campeonatoId/suspensoes")
@UseGuards(SessionGuard)
@Requer(somentePresidente)
export class SuspensoesController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private emTransacao<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient, presidenteId: string) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // Presidente relido na transação: desativação concorrente aguarda ou é observada.
      const presidente = await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx, presidente.usuarioId);
    }).catch(error => { throw traduzirErroSuspensao(error); });
  }

  @Post()
  aplicar(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string, @Body() body: unknown) {
    const parsed = novaSuspensaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe atletaId (UUID), quantidadeJogos (inteiro positivo) e motivo (1 a 500 caracteres); campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, presidenteId) => aplicarSuspensao(tx, campeonatoId.toLowerCase(), presidenteId, parsed.data));
  }

  @Get()
  listar(@Param("campeonatoId", uuidPipe) campeonatoId: string, @Query() query: unknown) {
    const parsed = filtroSuspensoesSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Filtro inválido. Use somente atletaId (UUID).");
    return listarSuspensoes(this.prisma, campeonatoId.toLowerCase(), parsed.data.atletaId);
  }

  @Post(":suspensaoId/revogar")
  @HttpCode(200)
  revogar(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string, @Param("suspensaoId", uuidPipe) suspensaoId: string, @Body() body: unknown) {
    const parsed = revogacaoSuspensaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe justificativa (1 a 500 caracteres); campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, presidenteId) => revogarSuspensao(tx, campeonatoId.toLowerCase(), suspensaoId.toLowerCase(), presidenteId, parsed.data));
  }

  @Post(":suspensaoId/reduzir")
  @HttpCode(200)
  reduzir(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string, @Param("suspensaoId", uuidPipe) suspensaoId: string, @Body() body: unknown) {
    const parsed = reducaoSuspensaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe novaQuantidade (inteiro de 0 em diante) e justificativa (1 a 500 caracteres); campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, presidenteId) => reduzirSuspensao(tx, campeonatoId.toLowerCase(), suspensaoId.toLowerCase(), presidenteId, parsed.data));
  }
}
