import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { exigirRequisito, type Requisito } from "../autorizacao/ator.js";
import { REQUISITO, type RequestComAtor } from "../autorizacao/autorizacao.decorators.js";
import { AuthService } from "./auth.service.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestComAtor>();
    const requisito = this.reflector.getAllAndOverride<Requisito | undefined>(REQUISITO, [context.getHandler(), context.getClass()]);
    request.ator = exigirRequisito(await this.auth.ator(request.headers), requisito);
    return true;
  }
}
