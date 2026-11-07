import { Module } from "@nestjs/common";
import { minutes, ThrottlerModule } from "@nestjs/throttler";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./infrastructure/prisma.service.js";
import { AuthService } from "./modules/autenticacao/auth.service.js";
import { AuthController } from "./modules/autenticacao/auth.controller.js";
import { SessionGuard } from "./modules/autenticacao/session.guard.js";
import { AutorizacaoService } from "./modules/autorizacao/autorizacao.service.js";
import { ContasController } from "./modules/contas/contas.controller.js";
import { PresidentesController } from "./modules/presidentes/presidentes.controller.js";

@Module({
  imports: [ThrottlerModule.forRoot({
    // Contadores em memória por IP; aplicado somente nas rotas com ThrottlerGuard.
    throttlers: [{ name: "cadastro", ttl: minutes(15), limit: 5 }],
    errorMessage: "Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.",
  })],
  controllers: [HealthController, AuthController, PresidentesController, ContasController],
  providers: [PrismaService, AuthService, SessionGuard, AutorizacaoService],
})
export class AppModule {}
