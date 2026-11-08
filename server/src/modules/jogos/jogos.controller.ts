import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual, Requer } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import {
  agendarJogo, designacaoSchema, designarArbitragem, detalharJogo, listarJogos, novoJogoSchema, retirarArbitragem, traduzirErroJogo,
} from "./jogos.js";

const somentePresidente = { perfis: ["presidente"] } as const;
const uuidPipe = new ParseUUIDPipe();

/**
 * Agendamento de jogos e designação da arbitragem (RF-015/024, RN-022/023/025, MAR-62): somente o
 * presidente. Mudança de data é adiamento e, com início, encerramento e cancelamento do jogo, fica na
 * MAR-69; acesso e sessões da arbitragem, na MAR-65.
 */
@Controller()
@UseGuards(SessionGuard)
@Requer(somentePresidente)
export class JogosController {
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService) {}

  private emTransacao<T>(ator: Ator, operacao: (tx: Prisma.TransactionClient, presidenteId: string) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      const presidente = await this.autorizacao.revalidar(tx, ator, somentePresidente);
      return operacao(tx, presidente.usuarioId);
    }).catch(error => { throw traduzirErroJogo(error); });
  }

  @Post("campeonatos/:campeonatoId/jogos")
  agendar(@AtorAtual() ator: Ator, @Param("campeonatoId", uuidPipe) campeonatoId: string, @Body() body: unknown) {
    const parsed = novoJogoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe clubeAId e clubeBId (UUIDs distintos), inicioPrevisto (AAAA-MM-DDTHH:mm, hora local), fusoHorario (nome IANA) e, opcionalmente, local (até 160 caracteres); campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, presidenteId) => agendarJogo(tx, campeonatoId.toLowerCase(), presidenteId, parsed.data));
  }

  @Get("campeonatos/:campeonatoId/jogos")
  listar(@Param("campeonatoId", uuidPipe) campeonatoId: string) {
    return listarJogos(this.prisma, campeonatoId.toLowerCase());
  }

  @Get("jogos/:jogoId")
  consultar(@Param("jogoId", uuidPipe) jogoId: string) {
    return detalharJogo(this.prisma, jogoId.toLowerCase());
  }

  @Post("jogos/:jogoId/arbitragens")
  designar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Body() body: unknown) {
    const parsed = designacaoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Dados inválidos. Informe usuarioId (UUID de atleta ou técnico) ou nomeCompleto (2 a 120 caracteres) de pessoa sem cadastro, nunca os dois; campos adicionais não são permitidos.");
    return this.emTransacao(ator, (tx, presidenteId) => designarArbitragem(tx, jogoId.toLowerCase(), presidenteId, parsed.data));
  }

  @Delete("jogos/:jogoId/arbitragens/:arbitragemId")
  @HttpCode(200)
  retirar(@AtorAtual() ator: Ator, @Param("jogoId", uuidPipe) jogoId: string, @Param("arbitragemId", uuidPipe) arbitragemId: string) {
    return this.emTransacao(ator, tx => retirarArbitragem(tx, jogoId.toLowerCase(), arbitragemId.toLowerCase()));
  }
}
