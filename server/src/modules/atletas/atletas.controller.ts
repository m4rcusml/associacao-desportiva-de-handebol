import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { historicoVinculos, transferenciaSchema, transferirAtleta, traduzirErroTransferencia } from "./transferencias.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const uuidPipe = new ParseUUIDPipe();

/** Vínculos e transferência de atletas entre clubes (RF-011/012, RN-005 a 009, MAR-63): somente o presidente. */
@Controller("atletas")
@UseGuards(SessionGuard)
@Requer(somentePresidente)
export class AtletasController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  @Get(":atletaId/vinculos")
  vinculos(@Param("atletaId", uuidPipe) atletaId: string) {
    return historicoVinculos(this.prisma, atletaId.toLowerCase());
  }

  @Post(":atletaId/transferencia")
  @HttpCode(200)
  transferir(@AtorAtual() ator: Ator, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    const parsed = transferenciaSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe clubeAtualId e clubeDestinoId (UUIDs distintos); campos adicionais não são permitidos.");
    return this.prisma.$transaction(async tx => {
      // Presidente relido na transação: desativação concorrente aguarda ou é observada.
      const presidente = await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return transferirAtleta(tx, atletaId.toLowerCase(), presidente.usuarioId, parsed.data);
    }).catch(error => { throw traduzirErroTransferencia(error); });
  }
}
