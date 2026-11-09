import { Controller, Get, Header, Logger, NotFoundException, Param, ParseUUIDPipe, Put, Req, ServiceUnavailableException, StreamableFile, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { cookieArbitragem, lerCookie } from "../arbitragem/arbitragem.controller.js";
import { traduzirErroArbitragem } from "../arbitragem/acesso.js";
import { SessionGuard } from "../autenticacao/session.guard.js";
import type { Ator } from "../autorizacao/ator.js";
import { AtorAtual } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { ArmazenamentoFotos, ErroArmazenamento } from "./armazenamento.js";
import { chaveParaArbitragem, chaveParaConta, exigirAtleta, exigirEnvio, lerImagem, novaChave, registrarFoto } from "./fotos.js";

const uuidPipe = new ParseUUIDPipe();

async function noArmazenamento<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (error) {
    if (error instanceof ErroArmazenamento) throw new ServiceUnavailableException("Armazenamento de fotos indisponível no momento. Tente novamente mais tarde.");
    throw error;
  }
}

/**
 * Entrega a foto lida pela chave atual. Se outra substituição remover o objeto entre a leitura da chave e
 * a do arquivo, relê a chave uma vez. Sem URL pública ou assinada: o conteúdo só passa pela API.
 */
async function entregar(armazenamento: ArmazenamentoFotos, obterChave: () => Promise<string | null>) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const chave = await obterChave();
    if (!chave) throw new NotFoundException("Atleta sem foto.");
    const foto = await noArmazenamento(() => armazenamento.ler(chave));
    if (foto) return new StreamableFile(foto.conteudo, { type: foto.tipo, length: foto.conteudo.length, disposition: "inline" });
  }
  throw new NotFoundException("Foto indisponível no momento. Tente novamente.");
}

/**
 * Fotos privadas dos atletas (seção 11, MAR-75). Envio e substituição pelo próprio atleta ou por um
 * presidente; leitura pelo próprio atleta, presidentes e técnico atual do clube. O arquivo vai ao
 * Storage antes da troca no banco; falha em qualquer etapa preserva a foto atual.
 */
@Controller("atletas/:atletaId/foto")
@UseGuards(SessionGuard)
export class FotosController {
  private readonly logger = new Logger(FotosController.name);
  constructor(private readonly prisma: PrismaService, private readonly autorizacao: AutorizacaoService, private readonly armazenamento: ArmazenamentoFotos) {}

  @Put()
  async enviar(@AtorAtual() ator: Ator, @Param("atletaId", uuidPipe) atletaId: string, @Req() request: Request) {
    const id = atletaId.toLowerCase();
    exigirEnvio(ator, id);
    await exigirAtleta(this.prisma, id); // antes do envio, para não gerar arquivo de atleta inexistente
    const { conteudo, tipo } = await lerImagem(request);
    const chave = novaChave(id, tipo);
    await noArmazenamento(() => this.armazenamento.enviar(chave, conteudo, tipo));
    let anterior: string | null;
    try {
      ({ anterior } = await this.prisma.$transaction(async tx => registrarFoto(tx, await this.autorizacao.revalidar(tx, ator), id, chave)));
    } catch (error) {
      await this.descartarNaoReferenciada(id, chave);
      throw error;
    }
    if (anterior) {
      // Falha aqui deixa um órfão (objeto sem referência), nunca uma referência inválida; ver limpeza no README.
      await this.armazenamento.remover(anterior).catch(() => this.logger.warn(`Foto anterior do atleta ${id} não removida; sujeita à limpeza de órfãos.`));
    }
    return { atletaId: id, foto: { tipo, tamanho: conteudo.length }, substituida: anterior !== null };
  }

  /**
   * Compensação da falha na persistência: remove o arquivo novo somente se o banco confirmadamente não o
   * referencia (o erro pode ter ocorrido após o commit). Sem confirmação, prefere-se o órfão.
   */
  private async descartarNaoReferenciada(atletaId: string, chave: string) {
    try {
      const atual = await this.prisma.atleta.findUnique({ where: { usuarioId: atletaId }, select: { fotoChave: true } });
      if (atual?.fotoChave !== chave) await this.armazenamento.remover(chave);
    } catch {
      this.logger.warn(`Foto recusada do atleta ${atletaId} não removida; sujeita à limpeza de órfãos.`);
    }
  }

  @Get()
  @Header("X-Content-Type-Options", "nosniff")
  ler(@AtorAtual() ator: Ator, @Param("atletaId", uuidPipe) atletaId: string) {
    const id = atletaId.toLowerCase();
    return entregar(this.armazenamento, () => this.prisma.$transaction(async tx => chaveParaConta(tx, await this.autorizacao.revalidar(tx, ator), id)));
  }
}

/**
 * Leitura pela arbitragem autorizada do jogo (cookie `handebol.arbitragem.<jogoId>`), somente de atleta
 * escalado ou credenciado nele. A sessão é revalidada na transação que lê a chave.
 */
@Controller("arbitragem/jogos/:jogoId/atletas/:atletaId/foto")
export class FotosArbitragemController {
  constructor(private readonly prisma: PrismaService, private readonly armazenamento: ArmazenamentoFotos) {}

  @Get()
  @Header("X-Content-Type-Options", "nosniff")
  ler(@Req() request: Request, @Param("jogoId", uuidPipe) jogoId: string, @Param("atletaId", uuidPipe) atletaId: string) {
    const jogo = jogoId.toLowerCase();
    return entregar(this.armazenamento, () => this.prisma.$transaction(tx => chaveParaArbitragem(tx, jogo, lerCookie(request, cookieArbitragem(jogo)), atletaId.toLowerCase()))
      .catch(error => { throw traduzirErroArbitragem(error); }));
  }
}
