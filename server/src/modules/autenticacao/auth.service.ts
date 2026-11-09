import { Injectable, UnauthorizedException } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { type Ator, carregarAtor, exigirRequisito } from "../autorizacao/ator.js";

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
      session: {
        modelName: "AuthSession", cookieCache: { enabled: false }, disableSessionRefresh: true,
        additionalFields: { versaoAtivacao: { type: "number", required: false, input: false, returned: false } },
      },
      // Explícito para valer também em desenvolvimento/teste; padrão do Better Auth no sign-in: 3 a cada 10 s por IP.
      rateLimit: { enabled: true },
      databaseHooks: { session: { create: { before: async session => {
        // Sem cadastro ativo no domínio, o sign-in responde 401 e não grava sessão. A versão lida aqui
        // acompanha a sessão: o trigger do banco recusa a gravação se a conta foi desativada ou
        // reativada entre esta leitura e a inserção (migração sessao_conta_ativa).
        const usuario = await prisma.usuario.findUnique({ where: { authId: session.userId }, select: { ativo: true, versaoAtivacao: true } });
        if (!usuario?.ativo) return false;
        return { data: { versaoAtivacao: usuario.versaoAtivacao } };
      } } } },
      advanced: {
        useSecureCookies: secure, defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure },
        // Limite do sign-in por IP. Na implantação hospedada o cabeçalho é reescrito pelo backend com o IP
        // informado pelo proxy confiável (proxy-confiavel.ts); valor enviado pelo cliente é descartado.
        ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      },
    });
  }

  /** Ator do domínio para a sessão persistida (null sem cadastro ativo) e o id dessa sessão de conta. */
  async autenticar(headers: IncomingHttpHeaders): Promise<{ ator: Ator | null; authSessionId: string }> {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (!session) throw new UnauthorizedException("Entre para continuar");
    return { ator: await carregarAtor(this.prisma, { authId: session.user.id }), authSessionId: session.session.id };
  }

  async sessao(headers: IncomingHttpHeaders) {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (!session) throw new UnauthorizedException("Entre para continuar");
    const { usuarioId, nomeCompleto, perfil, statusVerificacao, aprovado, clubeId } = exigirRequisito(await carregarAtor(this.prisma, { authId: session.user.id }));
    return { usuario: { id: usuarioId, nomeCompleto, perfil, statusVerificacao, aprovado, clubeId }, expiresAt: session.session.expiresAt };
  }
}
