import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import {
  criarCampeonato, detalharCampeonato, inscreverClube, inscricaoSchema, listarCampeonatos, novoCampeonatoSchema,
  retirarInscricao, traduzirErroCampeonato, transicionarCampeonato, type Transicao,
} from "./campeonatos.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const uuidPipe = new ParseUUIDPipe();

/**
 * Campeonatos e inscrições (RF-013/014, RN-022, MAR-61): somente o presidente cria, consulta e
 * conduz o ciclo. Visibilidade para outros perfis será definida com as tarefas que dependem dela
 * (MAR-64/MAR-74). Não há exclusão de campeonatos; agendamento de jogos fica na MAR-62.
 */
@Controller("campeonatos")
@UseGuards(SessionGuard)
@Requer(somentePresidente)
export class CampeonatosController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private emTransacao<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient, presidenteId: string) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // Presidente relido na transação: desativação concorrente aguarda ou é observada.
      const presidente = await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx, presidente.usuarioId);
    }).catch(error => { throw traduzirErroCampeonato(error); });
  }

  @Post()
  criar(@AtorAtual() ator: Ator, @Body() body: unknown) {
    const parsed = novoCampeonatoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe nome (2 a 120 caracteres), edicao e categoria (1 a 60) e, opcionalmente, inicio e fim (AAAA-MM-DD, fim não anterior ao início); campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, presidenteId) => criarCampeonato(tx, presidenteId, parsed.data));
  }

  @Get()
  listar() {
    return listarCampeonatos(this.prisma);
  }

  @Get(":campeonatoId")
  consultar(@Param("campeonatoId", uuidPipe) campeonatoId: string) {
    return detalharCampeonato(this.prisma, campeonatoId.toLowerCase());
  }

  @Post(":campeonatoId/inscricoes")
  inscrever(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string, @Body() body: unknown) {
    const parsed = inscricaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe clubeId (UUID); campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, presidenteId) => inscreverClube(tx, campeonatoId.toLowerCase(), presidenteId, parsed.data));
  }

  @Delete(":campeonatoId/inscricoes/:inscricaoId")
  @HttpCode(200)
  retirar(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string, @Param("inscricaoId", uuidPipe) inscricaoId: string) {
    return this.emTransacao(ator, tx => retirarInscricao(tx, campeonatoId.toLowerCase(), inscricaoId.toLowerCase()));
  }

  @Post(":campeonatoId/iniciar")
  @HttpCode(200)
  iniciar(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string) {
    return this.transicionar(ator, campeonatoId, "iniciar");
  }

  @Post(":campeonatoId/encerrar")
  @HttpCode(200)
  encerrar(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string) {
    return this.transicionar(ator, campeonatoId, "encerrar");
  }

  @Post(":campeonatoId/cancelar")
  @HttpCode(200)
  cancelar(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string) {
    return this.transicionar(ator, campeonatoId, "cancelar");
  }

  private transicionar(ator: Ator, campeonatoId: string, transicao: Transicao) {
    return this.emTransacao(ator, tx => transicionarCampeonato(tx, campeonatoId.toLowerCase(), transicao));
  }
}
