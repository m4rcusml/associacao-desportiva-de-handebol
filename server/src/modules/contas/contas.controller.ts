import { BadRequestException, Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { alterarAtivacao, bloquearAtivacao } from "./contas.js";

const corpoVazio = z.strictObject({}).optional();

/** Presidente desativa e reativa outras contas, preservando histórico e vínculos. Sem exclusão nem troca de perfil. */
@Controller("contas")
@UseGuards(SessionGuard)
@Requer({ perfis: ["presidente"] })
export class ContasController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  @Post(":usuarioId/desativacao")
  @HttpCode(200)
  desativar(@AtorAtual() ator: Ator, @Param("usuarioId", new ParseUUIDPipe()) usuarioId: string, @Body() body: unknown) {
    return this.alterar(ator, usuarioId, body, false);
  }

  @Post(":usuarioId/reativacao")
  @HttpCode(200)
  reativar(@AtorAtual() ator: Ator, @Param("usuarioId", new ParseUUIDPipe()) usuarioId: string, @Body() body: unknown) {
    return this.alterar(ator, usuarioId, body, true);
  }

  private alterar(ator: Ator, usuarioId: string, body: unknown, ativo: boolean) {
    if (!corpoVazio.safeParse(body).success) throw new BadRequestException("Envie um corpo vazio; campos adicionais não são permitidos.");
    return this.prisma.$transaction(async tx => {
      await bloquearAtivacao(tx);
      // Presidente relido após o lock: se foi desativado por operação concorrente já concluída, recebe 401.
      const presidente = await this.autorizacao.revalidar(tx, ator, { perfis: ["presidente"] });
      return alterarAtivacao(tx, presidente.usuarioId, usuarioId, ativo);
    });
  }
}
