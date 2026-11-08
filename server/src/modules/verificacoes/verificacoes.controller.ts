import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { aprovar, filtroSolicitacoesSchema, listarSolicitacoes, rejeitar, solicitarNovamente, traduzirErroVerificacao } from "./verificacoes.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const corpoVazio = z.strictObject({}).optional();
const uuidPipe = new ParseUUIDPipe();

function exigirCorpoVazio(body: unknown) {
  // Aprovação e rejeição não recebem dados: presidente, data e carteirinha vêm do servidor.
  if (!corpoVazio.safeParse(body).success) throw new BadRequestException("Envie um corpo vazio; campos adicionais não são permitidos.");
}

/**
 * Verificação esportiva de atleta e técnico (RF-003/004, RN-002/011, PEN-013): presidente consulta,
 * aprova (emitindo a carteirinha do atleta na mesma transação) ou rejeita sem motivo; a pessoa
 * rejeitada solicita nova análise na mesma conta. Não há retirada de aprovação.
 */
@Controller("verificacoes")
@UseGuards(SessionGuard)
export class VerificacoesController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private decidir<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient, presidenteId: string) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // Presidente relido na transação: desativação concorrente aguarda ou é observada.
      const presidente = await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx, presidente.usuarioId);
    }).catch(error => { throw traduzirErroVerificacao(error); });
  }

  @Get()
  @Requer(somentePresidente)
  listar(@Query() query: unknown) {
    const parsed = filtroSolicitacoesSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Filtros inválidos. Use status (pendente, aprovado ou rejeitado) e, opcionalmente, perfil (atleta ou tecnico).");
    return listarSolicitacoes(this.prisma, parsed.data);
  }

  /** A própria conta rejeitada solicita nova análise. Declarada antes das rotas com `:usuarioId`. */
  @Post("solicitacao")
  @Requer({ perfis: ["atleta", "tecnico"] })
  @HttpCode(200)
  solicitar(@AtorAtual() ator: Ator, @Body() body: unknown) {
    exigirCorpoVazio(body);
    return this.prisma.$transaction(tx => solicitarNovamente(tx, ator.usuarioId)).catch(error => { throw traduzirErroVerificacao(error); });
  }

  @Post(":usuarioId/aprovacao")
  @Requer(somentePresidente)
  @HttpCode(200)
  aprovar(@AtorAtual() ator: Ator, @Param("usuarioId", uuidPipe) usuarioId: string, @Body() body: unknown) {
    exigirCorpoVazio(body);
    return this.decidir(ator, (tx, presidenteId) => aprovar(tx, presidenteId, usuarioId.toLowerCase()));
  }

  @Post(":usuarioId/rejeicao")
  @Requer(somentePresidente)
  @HttpCode(200)
  rejeitar(@AtorAtual() ator: Ator, @Param("usuarioId", uuidPipe) usuarioId: string, @Body() body: unknown) {
    exigirCorpoVazio(body);
    return this.decidir(ator, (tx, presidenteId) => rejeitar(tx, presidenteId, usuarioId.toLowerCase()));
  }
}
