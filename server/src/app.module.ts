import { Module } from "@nestjs/common";
import { minutes, ThrottlerModule } from "@nestjs/throttler";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./infrastructure/prisma.service.js";
import { AuthService } from "./modules/autenticacao/auth.service.js";
import { AuthController } from "./modules/autenticacao/auth.controller.js";
import { SessionGuard } from "./modules/autenticacao/session.guard.js";
import { AutorizacaoService } from "./modules/autorizacao/autorizacao.service.js";
import { ContasController } from "./modules/contas/contas.controller.js";
import { ContaPropriaController } from "./modules/contas/conta-propria.controller.js";
import { PresidentesController } from "./modules/presidentes/presidentes.controller.js";
import { ClubesController } from "./modules/clubes/clubes.controller.js";
import { VerificacoesController } from "./modules/verificacoes/verificacoes.controller.js";
import { CarteirinhasController } from "./modules/carteirinhas/carteirinhas.controller.js";
import { CampeonatosController } from "./modules/campeonatos/campeonatos.controller.js";
import { JogosController } from "./modules/jogos/jogos.controller.js";
import { CicloJogoController } from "./modules/jogos/ciclo.controller.js";
import { AtletasController } from "./modules/atletas/atletas.controller.js";
import { EscalacaoController } from "./modules/participacoes/escalacao.controller.js";
import { CredenciamentoController, CredenciamentoPresidenteController } from "./modules/participacoes/credenciamento.controller.js";
import { ArbitragemController } from "./modules/arbitragem/arbitragem.controller.js";
import { CofreSenhaArbitragem } from "./modules/arbitragem/senha.js";
import { SuspensoesController } from "./modules/suspensoes/suspensoes.controller.js";
import { LancamentosController, LancamentosPresidenteController } from "./modules/resultados/lancamentos.controller.js";

@Module({
  imports: [ThrottlerModule.forRoot({
    // Contadores em memória por IP; aplicado somente nas rotas com ThrottlerGuard.
    // Cada rota com ThrottlerGuard dispensa (SkipThrottle) os limites que não são seus.
    throttlers: [{ name: "cadastro", ttl: minutes(15), limit: 5 }, { name: "arbitragem", ttl: minutes(10), limit: 10 }],
    errorMessage: context => context.getClass().name === "ArbitragemController"
      ? "Muitas tentativas de entrada na arbitragem. Aguarde alguns minutos e tente novamente."
      : "Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.",
  })],
  controllers: [HealthController, AuthController, PresidentesController, ContasController, ContaPropriaController, ClubesController, VerificacoesController, CarteirinhasController, CampeonatosController, JogosController, AtletasController, EscalacaoController, ArbitragemController, CredenciamentoController, CredenciamentoPresidenteController, SuspensoesController, LancamentosController, LancamentosPresidenteController, CicloJogoController],
  providers: [PrismaService, AuthService, SessionGuard, AutorizacaoService, CofreSenhaArbitragem],
})
export class AppModule {}
