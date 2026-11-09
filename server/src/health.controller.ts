import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./infrastructure/prisma.service.js";

/** Verificações da hospedagem; acessíveis sem o proxy público (proxy-confiavel.ts) e sem detalhes internos. */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Processo respondendo (liveness). */
  @Get()
  check() {
    return { status: "ok" };
  }

  /** Pronto para receber tráfego: consulta o banco (readiness; health check do Render). */
  @Get("ready")
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: "indisponivel" });
    }
    return { status: "ok" };
  }
}
