import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import type { NextFunction, Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { AppModule } from "./app.module.js";
import { AuthService } from "./modules/autenticacao/auth.service.js";
import { NotificacoesService } from "./modules/notificacoes/notificacoes.service.js";
import { CABECALHO_IP_CLIENTE, CABECALHO_SEGREDO_PROXY, ipDoCliente, lerSegredoProxy, ROTAS_SAUDE, segredoConfere } from "./infrastructure/proxy-confiavel.js";

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const auth = app.get(AuthService);
  const segredoProxy = lerSegredoProxy();
  app.setGlobalPrefix("api");
  if (segredoProxy) {
    // Implantação hospedada: somente o proxy público chega à API, e o IP do cliente vem dele (proxy-confiavel.ts).
    // `X-Forwarded-For` é reescrito com esse IP, lido pelo throttler (req.ip) e pelo Better Auth.
    (app.getHttpAdapter().getInstance() as { set(nome: string, valor: unknown): void }).set("trust proxy", true);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (ROTAS_SAUDE.has(req.path) && ["GET", "HEAD"].includes(req.method)) return next();
      const ip = ipDoCliente(req.headers);
      if (!segredoConfere(req.headers, segredoProxy) || !ip) {
        res.status(403).json({ message: "Acesso somente pelo domínio público" });
        return;
      }
      req.headers["x-forwarded-for"] = ip;
      delete req.headers[CABECALHO_SEGREDO_PROXY];
      delete req.headers[CABECALHO_IP_CLIENTE];
      next();
    });
  }
  app.enableCors({ origin: auth.clientOrigin, credentials: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin !== auth.clientOrigin) {
      res.status(403).json({ message: "Origem não autorizada" });
      return;
    }
    next();
  });
  const handler = toNodeHandler(auth.auth);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/auth/")) return next();
    const allowed = (req.method === "POST" && ["/api/auth/sign-in/email", "/api/auth/sign-out"].includes(req.path)) ||
      (req.method === "GET" && req.path === "/api/auth/get-session");
    if (!allowed) { res.status(404).json({ message: "Rota não disponível" }); return; }
    return handler(req, res);
  });
  app.use(json({ limit: "16kb" }));
  app.use(urlencoded({ extended: false, limit: "16kb" }));
  // Socket.IO no mesmo servidor HTTP, em caminho próprio (MAR-73); o Express não processa essas requisições.
  app.get(NotificacoesService).anexar(app.getHttpServer(), segredoProxy);
  app.enableShutdownHooks();
  return app;
}
