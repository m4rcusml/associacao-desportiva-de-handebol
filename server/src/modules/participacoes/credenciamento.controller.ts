import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { cookieArbitragem, lerCookie } from "../arbitragem/arbitragem.controller.js";
import {
  credenciamentoSchema, credenciar, leituraQrArbitragemSchema, lerQrNoJogo, listarAtletasDoJogo, registrarEntrada, traduzirErroCredenciamento,
} from "./credenciamento.js";

const uuidPipe = new ParseUUIDPipe();

/**
 * Credenciamento e entrada em quadra (RF-017 a 023, RN-013/015 a 021, MAR-67), autorizados somente pela sessão
 * temporária da arbitragem do jogo (cookie `handebol.arbitragem.<jogoId>`), revalidada na transação de cada
 * operação. O QR identifica a carteirinha, nunca autoriza (RNF-004).
 */
@Controller("arbitragem/jogos/:jogoId")
export class CredenciamentoController {
  constructor(private readonly prisma: PrismaService) {}

  private emTransacao<T>(request: Request, jogoId: string, operacao: (tx: Prisma.TransactionClient, id: string, token: string | undefined) => Promise<T>) {
    const id = jogoId.toLowerCase();
    return this.prisma.$transaction(tx => operacao(tx, id, lerCookie(request, cookieArbitragem(id))))
      .catch(error => { throw traduzirErroCredenciamento(error); });
  }

  @Get("atletas")
  listar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.emTransacao(request, jogoId, listarAtletasDoJogo);
  }

  @Post("leitura-qr")
  @HttpCode(200)
  lerQr(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = leituraQrArbitragemSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Informe somente tokenQr.");
    return this.emTransacao(request, jogoId, (tx, id, token) => lerQrNoJogo(tx, id, token, parsed.data.tokenQr));
  }

  @Post("credenciamentos")
  @HttpCode(200)
  credenciar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = credenciamentoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe numeroCamisa (inteiro não negativo) e atletaId (UUID) ou tokenQr; campos adicionais não são permitidos.");
    return this.emTransacao(request, jogoId, (tx, id, token) => credenciar(tx, id, token, parsed.data));
  }

  @Post("credenciamentos/:atletaId/entrada")
  @HttpCode(200)
  registrarEntrada(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    if (body !== undefined && (typeof body !== "object" || body === null || Object.keys(body).length > 0)) throw new BadRequestException("A entrada em quadra não recebe dados.");
    return this.emTransacao(request, jogoId, (tx, id, token) => registrarEntrada(tx, id, token, atletaId.toLowerCase()));
  }
}
