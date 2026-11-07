import { Injectable, UnauthorizedException } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { PrismaService } from "../../infrastructure/prisma.service.js";

@Injectable()
export class AuthService {
  readonly auth;
  readonly clientOrigin: string;

  constructor(private readonly prisma: PrismaService) {
    const baseURL = process.env.BETTER_AUTH_URL;
    const secret = process.env.BETTER_AUTH_SECRET;
    const origin = process.env.CLIENT_ORIGIN;
    if (!baseURL || !secret || secret.length < 32 || !origin) {
      throw new Error("Configure BETTER_AUTH_URL, CLIENT_ORIGIN e BETTER_AUTH_SECRET (mínimo 32 caracteres)");
    }
    this.clientOrigin = new URL(origin).origin;
    const secure = process.env.NODE_ENV === "production";
    if (secure && (!baseURL.startsWith("https://") || !origin.startsWith("https://"))) {
      throw new Error("Produção exige HTTPS na API e no cliente");
    }
    this.auth = betterAuth({
      baseURL,
      basePath: "/api/auth",
      secret,
      database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
      trustedOrigins: [this.clientOrigin],
      emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: false, revokeSessionsOnPasswordReset: true },
      user: { modelName: "AuthUser" },
      account: { modelName: "AuthAccount" },
      verification: { modelName: "AuthVerification" },
      session: { modelName: "AuthSession", cookieCache: { enabled: false }, disableSessionRefresh: true },
      // Explícito para valer também em desenvolvimento/teste; padrão do Better Auth no sign-in: 3 a cada 10 s por IP.
      rateLimit: { enabled: true },
      databaseHooks: { session: { create: { before: async session => {
        // Sem cadastro ativo no domínio, o sign-in responde 401 e não grava sessão.
        const usuario = await prisma.usuario.findUnique({ where: { authId: session.userId }, select: { ativo: true } });
        if (!usuario?.ativo) return false;
      } } } },
      advanced: { useSecureCookies: secure, defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure } },
    });
  }

  async sessao(headers: IncomingHttpHeaders) {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (!session) throw new UnauthorizedException("Entre para continuar");
    const usuario = await this.prisma.usuario.findUnique({ where: { authId: session.user.id }, select: {
      id: true, nomeCompleto: true, perfil: true, ativo: true,
      atleta: { select: { statusVerificacao: true } }, tecnico: { select: { statusVerificacao: true } }, presidente: { select: { usuarioId: true } },
    } });
    if (!usuario?.ativo || !usuario[usuario.perfil]) throw new UnauthorizedException("Cadastro indisponível");
    return { usuario: { id: usuario.id, nomeCompleto: usuario.nomeCompleto, perfil: usuario.perfil,
      statusVerificacao: usuario.atleta?.statusVerificacao ?? usuario.tecnico?.statusVerificacao ?? null }, expiresAt: session.session.expiresAt };
  }
}
