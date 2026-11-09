import { BadRequestException, Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { cookieArbitragem, lerCookie } from "../arbitragem/arbitragem.controller.js";
import { CofreSenhaArbitragem } from "../arbitragem/senha.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { adiamentoSchema, adiarJogo, cancelarJogo, encerrarJogo, iniciarJogo, traduzirErroCiclo } from "./ciclo.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const uuidPipe = new ParseUUIDPipe();

/**
 * Ciclo do jogo (RF-029/030/035, RN-031, MAR-69). Início e encerramento pela arbitragem autorizada do jogo (cookie
 * temporário `handebol.arbitragem.<jogoId>`, revalidado na transação); adiamento e cancelamento pelo presidente.
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
  encerrar(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string) {
    return this.pelaArbitragem(request, jogoId, encerrarJogo);
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
