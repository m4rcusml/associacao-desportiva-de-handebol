import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { cookieArbitragem, lerCookie } from "../arbitragem/arbitragem.controller.js";
import { consultarLancamentos, lancamentoSchema, registrarLancamento, traduzirErroLancamento } from "./lancamentos.js";

const uuidPipe = new ParseUUIDPipe();

/**
 * Gols e penalidades (RF-031/032/037, RN-032 a 036, MAR-68), autorizados somente pela sessão temporária da
 * arbitragem do jogo (cookie `handebol.arbitragem.<jogoId>`), revalidada na transação de cada operação.
 */
@Controller("arbitragem/jogos/:jogoId/lancamentos")
export class LancamentosController {
  constructor(private readonly prisma: PrismaService) {}

  private emTransacao<T>(request: Request, jogoId: string, operacao: (tx: Prisma.TransactionClient, id: string, token: string | undefined) => Promise<T>) {
    const id = jogoId.toLowerCase();
    return this.prisma.$transaction(tx => operacao(tx, id, lerCookie(request, cookieArbitragem(id))))
      .catch(error => { throw traduzirErroLancamento(error); });
  }

  @Get()
  consultar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.emTransacao(request, jogoId, consultarLancamentos);
  }

  @Post()
  @HttpCode(200)
  registrar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = lancamentoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe operacaoId (UUID), tipo (temp_gol, temp_cartaoAmarelo, temp_exclusaoDoisMinutos ou temp_cartaoVermelho) e participacaoId (UUID); campos adicionais não são permitidos.");
    return this.emTransacao(request, jogoId, (tx, id, token) => registrarLancamento(tx, id, token, parsed.data));
  }
}
