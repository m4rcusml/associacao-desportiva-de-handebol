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
  anulacaoSchema, anularPelaArbitragem, anularPeloPresidente, consultarLancamentos, consultarLancamentosPeloPresidente, correcaoSchema,
  corrigirPelaArbitragem, corrigirPeloPresidente, lancamentoSchema, registrarLancamento, traduzirErroLancamento,
} from "./lancamentos.js";

const uuidPipe = new ParseUUIDPipe();
const somentePresidente = { perfis: ["presidente"] } as const;
const corpoLancamentoInvalido = "Dados inválidos. Informe operacaoId (UUID), tipo (gol, cartaoAmarelo, exclusaoDoisMinutos ou cartaoVermelho) e participacaoId (UUID); relatorioDisciplinar (booleano) somente no cartaoVermelho; campos adicionais não são permitidos.";
const corpoAnulacaoInvalido = "Dados inválidos. Informe somente operacaoId (UUID) gerado para esta anulação.";

function validar<T>(schema: { safeParse(body: unknown): { success: true; data: T } | { success: false } }, body: unknown, mensagem: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(mensagem);
  return parsed.data;
}

/**
 * Gols e penalidades (RF-031/032/034/037, RN-032 a 036, MAR-68/70), autorizados somente pela sessão temporária da
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
    const dados = validar(lancamentoSchema, body, corpoLancamentoInvalido);
    return this.emTransacao(request, jogoId, (tx, id, token) => registrarLancamento(tx, id, token, dados));
  }

  @Post(":lancamentoId/correcao")
  @HttpCode(200)
  corrigir(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Param("lancamentoId", uuidPipe) lancamentoId: string, @Body() body: unknown) {
    const dados = validar(correcaoSchema, body, corpoLancamentoInvalido);
    return this.emTransacao(request, jogoId, (tx, id, token) => corrigirPelaArbitragem(tx, id, token, lancamentoId.toLowerCase(), dados));
  }

  @Post(":lancamentoId/anulacao")
  @HttpCode(200)
  anular(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Param("lancamentoId", uuidPipe) lancamentoId: string, @Body() body: unknown) {
    const dados = validar(anulacaoSchema, body, corpoAnulacaoInvalido);
    return this.emTransacao(request, jogoId, (tx, id, token) => anularPelaArbitragem(tx, id, token, lancamentoId.toLowerCase(), dados));
  }
}

/**
 * Presidente consulta os lançamentos em qualquer status e, somente após o encerramento, corrige ou anula diretamente,
 * sem devolver acesso à arbitragem (RF-036, RN-031, MAR-70). Não inclui lançamentos novos.
 */
@Controller("jogos/:jogoId/lancamentos")
@UseGuards(SessionGuard)
@Requer(somentePresidente)
export class LancamentosPresidenteController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private pelaPresidencia<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx);
    }).catch(error => { throw traduzirErroLancamento(error); });
  }

  @Get()
  consultar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.pelaPresidencia(ator, tx => consultarLancamentosPeloPresidente(tx, jogoId.toLowerCase()));
  }

  @Post(":lancamentoId/correcao")
  @HttpCode(200)
  corrigir(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Param("lancamentoId", uuidPipe) lancamentoId: string, @Body() body: unknown) {
    const dados = validar(correcaoSchema, body, corpoLancamentoInvalido);
    return this.pelaPresidencia(ator, tx => corrigirPeloPresidente(tx, jogoId.toLowerCase(), lancamentoId.toLowerCase(), dados));
  }

  @Post(":lancamentoId/anulacao")
  @HttpCode(200)
  anular(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Param("lancamentoId", uuidPipe) lancamentoId: string, @Body() body: unknown) {
    const dados = validar(anulacaoSchema, body, corpoAnulacaoInvalido);
    return this.pelaPresidencia(ator, tx => anularPeloPresidente(tx, jogoId.toLowerCase(), lancamentoId.toLowerCase(), dados));
  }
}
