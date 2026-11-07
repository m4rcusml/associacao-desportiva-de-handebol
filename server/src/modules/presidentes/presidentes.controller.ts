import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { hashPassword } from "better-auth/crypto";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import { traduzirErroIdentidade } from "../autenticacao/identidade.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { criarPresidente, novoPresidenteSchema } from "./presidentes.js";

@Controller("presidentes")
export class PresidentesController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  /** Presidente ativo cria outro presidente (sucessão ou divisão de tarefas), registrando o criador. */
  @Post()
  @UseGuards(SessionGuard)
  @Requer({ perfis: ["presidente"] })
  async criar(@AtorAtual() ator: Ator, @Body() body: unknown) {
    const parsed = novoPresidenteSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe nome completo, e-mail e senha inicial de 8 a 128 caracteres; campos adicionais não são permitidos.");
    const { nomeCompleto, email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    try {
      const usuario = await this.prisma.$transaction(async tx => {
        // Criador relido na transação: desativação concorrente aguarda ou é observada.
        const criador = await this.autorizacao.revalidar(tx, ator, { perfis: ["presidente"] });
        return criarPresidente(tx, { nomeCompleto, email, passwordHash }, criador.usuarioId);
      });
      return { usuario: { id: usuario.id, nomeCompleto: usuario.nomeCompleto, perfil: usuario.perfil }, criadoPorPresidenteId: usuario.presidente!.criadoPorPresidenteId };
    } catch (error) {
      throw traduzirErroIdentidade(error);
    }
  }
}
