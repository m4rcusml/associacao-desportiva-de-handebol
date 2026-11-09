import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import {
  alterarStatus, consultarCarteirinha, consultarPropria, identificarPorQr, leituraQrSchema, substituicaoQrSchema, substituirQr, traduzirErroCarteirinha,
} from "./carteirinhas.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const corpoVazio = z.strictObject({}).optional();
const uuidPipe = new ParseUUIDPipe();

function validar<T>(schema: z.ZodType<T>, body: unknown, mensagem: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(mensagem);
  return parsed.data;
}
const exigirCorpoVazio = (body: unknown) => validar(corpoVazio, body, "Envie um corpo vazio; campos adicionais não são permitidos.");

/**
 * Carteirinha do atleta (RF-005/006, RN-011/013, PEN-020): o atleta consulta a própria; o presidente
 * consulta, invalida, reativa e substitui o QR da mesma carteirinha, com histórico. O QR apenas
 * identifica a carteirinha: não autentica nem autoriza operações (RNF-004).
 */
@Controller("carteirinhas")
@UseGuards(SessionGuard)
export class CarteirinhasController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private operar<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient, presidenteId: string) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // Presidente relido na transação: desativação concorrente aguarda ou é observada.
      const presidente = await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx, presidente.usuarioId);
    }).catch(error => { throw traduzirErroCarteirinha(error); });
  }

  @Get("minha")
  @Requer({ perfis: ["atleta"] })
  minha(@AtorAtual() ator: Ator) {
    return consultarPropria(this.prisma, ator.usuarioId);
  }

  /** Leitura do QR pelo presidente: identificação mínima. A arbitragem lê o QR no jogo (`/arbitragem/jogos/:jogoId/leitura-qr`, MAR-67). */
  @Post("leitura")
  @Requer(somentePresidente)
  @HttpCode(200)
  ler(@Body() body: unknown) {
    const { tokenQr } = validar(leituraQrSchema, body, "Informe somente tokenQr.");
    return identificarPorQr(this.prisma, tokenQr);
  }

  @Get("atleta/:atletaId")
  @Requer(somentePresidente)
  consultar(@Param("atletaId", uuidPipe) atletaId: string) {
    return consultarCarteirinha(this.prisma, atletaId.toLowerCase());
  }

  @Post("atleta/:atletaId/invalidacao")
  @Requer(somentePresidente)
  @HttpCode(200)
  invalidar(@AtorAtual() ator: Ator, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    exigirCorpoVazio(body);
    return this.operar(ator, (tx, presidenteId) => alterarStatus(tx, presidenteId, atletaId.toLowerCase(), "invalidada"));
  }

  @Post("atleta/:atletaId/reativacao")
  @Requer(somentePresidente)
  @HttpCode(200)
  reativar(@AtorAtual() ator: Ator, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    exigirCorpoVazio(body);
    return this.operar(ator, (tx, presidenteId) => alterarStatus(tx, presidenteId, atletaId.toLowerCase(), "ativa"));
  }

  @Post("atleta/:atletaId/substituicao-qr")
  @Requer(somentePresidente)
  @HttpCode(200)
  substituir(@AtorAtual() ator: Ator, @Param("atletaId", uuidPipe) atletaId: string, @Body() body: unknown) {
    const { versaoQr } = validar(substituicaoQrSchema, body, "Informe somente versaoQr, a versão do QR que deve deixar de valer.");
    return this.operar(ator, (tx, presidenteId) => substituirQr(tx, presidenteId, atletaId.toLowerCase(), versaoQr));
  }
}
