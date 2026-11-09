import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { cookieArbitragem, lerCookie } from "../arbitragem/arbitragem.controller.js";
import { CofreSenhaArbitragem } from "../arbitragem/senha.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { adiamentoSchema, adiarJogo, cancelarJogo, encerramentoSchema, encerrarJogo, iniciarJogo, traduzirErroCiclo } from "./ciclo.js";
import {
  consultarResultado, correcaoResultadoSchema, corrigirResultado, interromperJogo, invalidacaoSchema, invalidarJogo, retomarJogo,
} from "./resultado.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const uuidPipe = new ParseUUIDPipe();

/**
 * Ciclo do jogo (RF-029/030/035/036, RN-031, MAR-69/MAR-72). Início, interrupção, retomada e encerramento (inclusive
 * W.O.) pela arbitragem autorizada do jogo (cookie temporário `handebol.arbitragem.<jogoId>`, revalidado na
 * transação); adiamento, cancelamento e, após o encerramento, correção do resultado e invalidação pelo presidente.
 */
@Controller()
export class CicloJogoController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService, private readonly cofre: CofreSenhaArbitragem) {}

  private emTransacao<T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operacao).catch(error => { throw traduzirErroCiclo(error); });
  }

  private pelaArbitragem<T>(request: Request, jogoId: string, operacao: (tx: Prisma.TransactionClient, id: string, token: string | undefined) => Promise<T>) {
    const id = jogoId.toLowerCase();
    return this.emTransacao(tx => operacao(tx, id, lerCookie(request, cookieArbitragem(id))));
  }

  private pelaPresidencia<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.emTransacao(async tx => {
      await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx);
    });
  }

  @Post("arbitragem/jogos/:jogoId/inicio")
  @HttpCode(200)
  iniciar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.pelaArbitragem(request, jogoId, iniciarJogo);
  }

  @Post("arbitragem/jogos/:jogoId/encerramento")
  @HttpCode(200)
  encerrar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = encerramentoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe resultado (normal, interrompido, abandono ou wo) e vencedorInscricaoId (inscrição do clube A ou B, ou null para nenhum vencedor); campos adicionais não são permitidos.");
    return this.pelaArbitragem(request, jogoId, (tx, id, token) => encerrarJogo(tx, id, token, parsed.data));
  }

  @Post("arbitragem/jogos/:jogoId/interrupcao")
  @HttpCode(200)
  interromper(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.pelaArbitragem(request, jogoId, interromperJogo);
  }

  @Post("arbitragem/jogos/:jogoId/retomada")
  @HttpCode(200)
  retomar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.pelaArbitragem(request, jogoId, retomarJogo);
  }

  @Get("jogos/:jogoId/resultado")
  @UseGuards(SessionGuard)
  @Requer(somentePresidente)
  resultado(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.pelaPresidencia(ator, tx => consultarResultado(tx, jogoId.toLowerCase()));
  }

  @Post("jogos/:jogoId/correcao-resultado")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @Requer(somentePresidente)
  corrigirResultado(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = correcaoResultadoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe atual e novo, cada um com resultado (normal, interrompido, abandono ou wo) e vencedorInscricaoId (inscrição do jogo ou null); campos adicionais não são permitidos.");
    return this.pelaPresidencia(ator, tx => corrigirResultado(tx, ator.usuarioId, jogoId.toLowerCase(), parsed.data));
  }

  @Post("jogos/:jogoId/invalidacao")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @Requer(somentePresidente)
  invalidar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = invalidacaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe motivo (1 a 500 caracteres); campos adicionais não são permitidos.");
    return this.pelaPresidencia(ator, tx => invalidarJogo(tx, ator.usuarioId, jogoId.toLowerCase(), parsed.data));
  }

  @Post("jogos/:jogoId/adiamento")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @Requer(somentePresidente)
  adiar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = adiamentoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe inicioPrevisto (AAAA-MM-DDTHH:mm, hora local, ou null para deixar o jogo sem data) e, opcionalmente, fusoHorario (nome IANA) e local (até 160 caracteres); campos adicionais não são permitidos.");
    return this.pelaPresidencia(ator, tx => adiarJogo(tx, this.cofre, jogoId.toLowerCase(), parsed.data));
  }

  @Post("jogos/:jogoId/cancelamento")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @Requer(somentePresidente)
  cancelar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.pelaPresidencia(ator, tx => cancelarJogo(tx, jogoId.toLowerCase()));
  }
}
