import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { cookieArbitragem, lerCookie } from "../arbitragem/arbitragem.controller.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import {
  correcaoCamisaSchema, corrigirCamisaPelaArbitragem, corrigirCamisaPeloPresidente, credenciamentoSchema, credenciar, estornarCredenciamento, estornoSchema,
  leituraQrArbitragemSchema, lerQrNoJogo, listarAtletasDoJogo, registrarEntrada, traduzirErroCredenciamento,
} from "./credenciamento.js";

const uuidPipe = new ParseUUIDPipe();
const somentePresidente = { perfis: ["presidente"] } as const;
const corpoCorrecaoInvalido = "Dados inválidos. Informe numeroCamisaAtual e numeroCamisa (inteiros não negativos e diferentes); campos adicionais não são permitidos.";
const corpoEstornoInvalido = "Dados inválidos. Informe somente numeroCamisa (inteiro não negativo) do credenciamento a desfazer.";

function validar<T>(schema: { safeParse(body: unknown): { success: true; data: T } | { success: false } }, body: unknown, mensagem: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(mensagem);
  return parsed.data;
}

/**
 * Credenciamento e entrada em quadra (RF-017 a 023, RN-013/015 a 021, MAR-67), correção de camisa e estorno (MAR-71),
 * autorizados somente pela sessão temporária da arbitragem do jogo (cookie `handebol.arbitragem.<jogoId>`),
 * revalidada na transação de cada operação. O QR identifica a carteirinha, nunca autoriza (RNF-004).
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

  @Post("credenciamentos/:atletaId/camisa")
  @HttpCode(200)
  corrigirCamisa(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    const dados = validar(correcaoCamisaSchema, body, corpoCorrecaoInvalido);
    return this.emTransacao(request, jogoId, (tx, id, token) => corrigirCamisaPelaArbitragem(tx, id, token, atletaId.toLowerCase(), dados));
  }

  @Post("credenciamentos/:atletaId/estorno")
  @HttpCode(200)
  estornar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    const dados = validar(estornoSchema, body, corpoEstornoInvalido);
    return this.emTransacao(request, jogoId, (tx, id, token) => estornarCredenciamento(tx, id, token, atletaId.toLowerCase(), dados));
  }
}

/**
 * Presidente corrige a camisa somente após o encerramento do jogo (MAR-71; seção 11), sem devolver acesso à arbitragem.
 * Estorno ou outra correção de atleta que entrou em quadra ou tem lançamentos aguarda a PEN-019 residual.
 */
@Controller("jogos/:jogoId/credenciamentos")
@UseGuards(SessionGuard)
@Requer(somentePresidente)
export class CredenciamentoPresidenteController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  @Post(":atletaId/camisa")
  @HttpCode(200)
  corrigirCamisa(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    const dados = validar(correcaoCamisaSchema, body, corpoCorrecaoInvalido);
    return this.prisma.$transaction(async tx => {
      await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return corrigirCamisaPeloPresidente(tx, jogoId.toLowerCase(), atletaId.toLowerCase(), dados);
    }).catch(error => { throw traduzirErroCredenciamento(error); });
  }
}
