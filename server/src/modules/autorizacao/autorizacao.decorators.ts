import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { Perfil } from "../../generated/prisma/client.js";
import type { Ator, Requisito } from "./ator.js";

export const REQUISITO = "autorizacao:requisito";

/** Exige perfil e/ou aprovação esportiva; avaliado pelo SessionGuard. */
export const Requer = (requisito: Requisito) => SetMetadata(REQUISITO, requisito);
/** Atalho para módulos esportivos: conta ativa, perfil permitido e aprovação. */
export const RequerAprovado = (...perfis: Perfil[]) => Requer({ aprovado: true, ...(perfis.length ? { perfis } : {}) });

export type RequestComAtor = Request & { ator?: Ator };

/** Ator anexado pelo SessionGuard. */
export const AtorAtual = createParamDecorator((_: unknown, context: ExecutionContext): Ator => {
  const ator = context.switchToHttp().getRequest<RequestComAtor>().ator;
  if (!ator) throw new Error("AtorAtual exige SessionGuard na rota");
  return ator;
});
