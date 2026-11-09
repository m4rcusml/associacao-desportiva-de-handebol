import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { minutes, SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, type RequestComAtor } from "../autorizacao/autorizacao.decorators.js";
import {
  alterarVisualizacao, consultarSenha, entradaDesignacaoSchema, entradaSenhaSchema, entrarPorDesignacao, entrarPorSenha, resumirSessao,
  sairDaArbitragem, traduzirErroArbitragem, trocarSenha, visualizacaoSchema,
} from "./acesso.js";
import { CofreSenhaArbitragem } from "./senha.js";

const uuidPipe = new ParseUUIDPipe();
const producao = () => process.env.NODE_ENV === "production";

/**
 * Cookie temporário por jogo, separado do cookie da conta (PEN-030): não o sobrescreve nem substitui o
 * acesso a outro jogo no mesmo navegador. HttpOnly/Lax; em produção, Secure com prefixo `__Host-`.
 */
export const cookieArbitragem = (jogoId: string) => `${producao() ? "__Host-" : ""}handebol.arbitragem.${jogoId.toLowerCase()}`;

export function lerCookie(request: Request, nome: string): string | undefined {
  for (const parte of (request.headers.cookie ?? "").split(";")) {
    const separador = parte.indexOf("=");
    if (separador > 0 && parte.slice(0, separador).trim() === nome) return decodeURIComponent(parte.slice(separador + 1).trim());
  }
  return undefined;
}

const atributos = () => ({ httpOnly: true, sameSite: "lax" as const, secure: producao(), path: "/" });

/**
 * Acesso temporário da arbitragem (RF-025 a 030, RN-025 a 031, MAR-65). Entrada por designação (conta
 * autenticada) ou por nome e senha do jogo; consulta e troca da senha pelo presidente ou conta designada.
 * Operações esportivas (MAR-67 a 69) reutilizam `revalidarArbitragem` na própria transação.
 */
@Controller()
export class ArbitragemController {
  constructor(private readonly prisma: PrismaService, private readonly cofre: CofreSenhaArbitragem) {}

  private emTransacao<T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operacao).catch(error => { throw traduzirErroArbitragem(error); });
  }

  private emitirCookie(response: Response, jogoId: string, { token, expiraEm }: { token: string; expiraEm: Date }) {
    response.cookie(cookieArbitragem(jogoId), token, { ...atributos(), expires: expiraEm });
  }

  @Post("arbitragem/jogos/:jogoId/entrada/designacao")
  @HttpCode(201)
  @UseGuards(SessionGuard)
  async entrarPorDesignacao(@AtorAtual() ator: Ator, @Req() request: RequestComAtor, @Res({ passthrough: true }) response: Response, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = entradaDesignacaoSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe opcionalmente visualizacao (linha ou banco); campos adicionais não são permitidos.");
    const id = jogoId.toLowerCase();
    const sessao = await this.emTransacao(tx => entrarPorDesignacao(tx, id, ator, request.authSessionId!, parsed.data));
    this.emitirCookie(response, id, sessao);
    return sessao.resumo;
  }

  @Post("arbitragem/jogos/:jogoId/entrada/senha")
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ cadastro: true })
  @Throttle({ arbitragem: { ttl: minutes(10), limit: 10 } })
  async entrarPorSenha(@Res({ passthrough: true }) response: Response, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = entradaSenhaSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe nomeCompleto (2 a 120 caracteres), senha e, opcionalmente, visualizacao (linha ou banco); campos adicionais não são permitidos.");
    const id = jogoId.toLowerCase();
    const sessao = await this.emTransacao(tx => entrarPorSenha(tx, id, parsed.data));
    this.emitirCookie(response, id, sessao);
    return sessao.resumo;
  }

  @Get("arbitragem/jogos/:jogoId/sessao")
  consultarSessao(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string) {
    const id = jogoId.toLowerCase();
    return this.emTransacao(tx => resumirSessao(tx, id, lerCookie(request, cookieArbitragem(id))));
  }

  @Put("arbitragem/jogos/:jogoId/visualizacao")
  alterarVisualizacao(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = visualizacaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe visualizacao: linha ou banco.");
    const id = jogoId.toLowerCase();
    return this.emTransacao(tx => alterarVisualizacao(tx, id, lerCookie(request, cookieArbitragem(id)), parsed.data.visualizacao));
  }

  @Post("arbitragem/jogos/:jogoId/saida")
  @HttpCode(200)
  async sair(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Param("jogoId", uuidPipe) jogoId: string) {
    const id = jogoId.toLowerCase();
    const resultado = await this.emTransacao(tx => sairDaArbitragem(tx, id, lerCookie(request, cookieArbitragem(id))));
    response.clearCookie(cookieArbitragem(id), atributos());
    return resultado;
  }

  @Get("jogos/:jogoId/arbitragem/senha")
  @UseGuards(SessionGuard)
  consultarSenha(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.emTransacao(tx => consultarSenha(tx, this.cofre, jogoId.toLowerCase(), ator));
  }

  @Post("jogos/:jogoId/arbitragem/senha/troca")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  trocarSenha(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.emTransacao(tx => trocarSenha(tx, this.cofre, jogoId.toLowerCase(), ator));
  }
}
