import { BadRequestException, Body, Controller, Patch, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import { camposConta } from "../autenticacao/identidade.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual } from "../autorizacao/autorizacao.decorators.js";
import { editarNomeProprio } from "./contas.js";

/** Somente o nome: perfil, clube, aprovação, ativação, e-mail e senha não são aceitos (sem contrato aprovado). */
export const edicaoContaSchema = z.strictObject({ nomeCompleto: camposConta.shape.nomeCompleto });

/**
 * Edição de dados cadastrais pela própria conta, sem nova aprovação (requisitos, seção 11). A conta
 * vem da sessão, nunca da requisição; vale para qualquer perfil e situação de verificação, inclusive
 * rejeitado que corrige os dados antes de solicitar nova análise.
 */
@Controller("conta")
@UseGuards(SessionGuard)
export class ContaPropriaController {
  constructor(private readonly prisma: PrismaService) {}

  @Patch()
  editar(@AtorAtual() ator: Ator, @Body() body: unknown) {
    const parsed = edicaoContaSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Envie somente nomeCompleto, com 3 a 150 caracteres. Perfil, clube, aprovação, ativação, e-mail e senha não podem ser alterados aqui.");
    return this.prisma.$transaction(tx => editarNomeProprio(tx, ator.usuarioId, parsed.data.nomeCompleto));
  }
}
