import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./infrastructure/prisma.service.js";
import { AuthService } from "./modules/autenticacao/auth.service.js";
import { AuthController } from "./modules/autenticacao/auth.controller.js";
import { SessionGuard } from "./modules/autenticacao/session.guard.js";

@Module({
  controllers: [HealthController, AuthController],
  providers: [PrismaService, AuthService, SessionGuard],
})
export class AppModule {}
