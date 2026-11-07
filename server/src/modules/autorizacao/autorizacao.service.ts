import { Injectable } from "@nestjs/common";
import type { Perfil, Prisma } from "../../generated/prisma/client.js";
import { type Ator, carregarAtor, exigirAcessoClube, exigirRequisito, type Requisito } from "./ator.js";

/**
 * Revalidação dentro de transações sensíveis. O guard autoriza antes do handler; aqui o ator é relido
 * na própria transação com bloqueio compartilhado da linha `Usuario`. Convenção: operações que alteram
 * ativação, aprovação, perfil ou clube de uma conta bloqueiam essa linha com FOR UPDATE, de modo que
 * a mudança concorrente aguarda o commit (ou a transação aqui enxerga o estado já alterado).
 */
@Injectable()
export class AutorizacaoService {
  async revalidar(tx: Prisma.TransactionClient, ator: Pick<Ator, "usuarioId">, requisito: Requisito = {}): Promise<Ator> {
    await tx.$queryRaw`SELECT 1 FROM "Usuario" WHERE id = ${ator.usuarioId}::uuid FOR SHARE`;
    return exigirRequisito(await carregarAtor(tx, { id: ator.usuarioId }), requisito);
  }

  async revalidarClube(tx: Prisma.TransactionClient, ator: Pick<Ator, "usuarioId">, clubeId: string, perfis?: readonly Perfil[]): Promise<Ator> {
    return exigirAcessoClube(await this.revalidar(tx, ator), clubeId, perfis);
  }
}
