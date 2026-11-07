import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { atribuicaoSchema, atribuirTecnico, desvincularTecnico, detalharClube, edicaoClubeSchema, novoClubeSchema, traduzirErroClube } from "./clubes.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const uuidPipe = new ParseUUIDPipe();

/**
 * Administração de clubes pelo presidente (RF-009/010, RN-004/005). A listagem mínima pública usada
 * no cadastro continua em `GET /api/clubes`. Não há exclusão nem desativação de clubes.
 */
@Controller("clubes")
@UseGuards(SessionGuard)
@Requer(somentePresidente)
export class ClubesController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private emTransacao<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient, presidenteId: string) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // Presidente relido na transação: desativação concorrente aguarda ou é observada.
      const presidente = await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx, presidente.usuarioId);
    }).catch(error => { throw traduzirErroClube(error); });
  }

  @Post()
  async criar(@AtorAtual() ator: Ator, @Body() body: unknown) {
    const parsed = novoClubeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe nome de 2 a 120 caracteres e, opcionalmente, cidade de 2 a 120 caracteres; campos adicionais não são permitidos.");
    return this.emTransacao(ator, async (tx, presidenteId) => {
      const clube = await tx.clube.create({ data: { ...parsed.data, criadoPorPresidenteId: presidenteId }, select: { id: true } });
      return detalharClube(tx, clube.id);
    });
  }

  @Get(":clubeId")
  consultar(@Param("clubeId", uuidPipe) clubeId: string) {
    return detalharClube(this.prisma, clubeId.toLowerCase());
  }

  @Patch(":clubeId")
  async editar(@AtorAtual() ator: Ator, @Param("clubeId", uuidPipe) clubeId: string, @Body() body: unknown) {
    const parsed = edicaoClubeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe nome e/ou cidade (2 a 120 caracteres; cidade pode ser null); campos adicionais não são permitidos.");
    const id = clubeId.toLowerCase();
    return this.emTransacao(ator, async tx => {
      await detalharClube(tx, id);
      await tx.clube.update({ where: { id }, data: parsed.data });
      return detalharClube(tx, id);
    });
  }

  /** Atribui técnico ao clube sem técnico ou substitui o atual (informando-o em `substituirTecnicoId`). */
  @Put(":clubeId/tecnico")
  async atribuir(@AtorAtual() ator: Ator, @Param("clubeId", uuidPipe) clubeId: string, @Body() body: unknown) {
    const parsed = atribuicaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe tecnicoId e, para substituir, substituirTecnicoId (UUIDs); campos adicionais não são permitidos.");
    return this.emTransacao(ator, tx => atribuirTecnico(tx, clubeId.toLowerCase(), parsed.data));
  }

  /** Desvincula o técnico informado; o clube fica sem técnico. */
  @Delete(":clubeId/tecnico/:tecnicoId")
  @HttpCode(200)
  async desvincular(@AtorAtual() ator: Ator, @Param("clubeId", uuidPipe) clubeId: string, @Param("tecnicoId", uuidPipe) tecnicoId: string) {
    return this.emTransacao(ator, tx => desvincularTecnico(tx, clubeId.toLowerCase(), tecnicoId.toLowerCase()));
  }
}
