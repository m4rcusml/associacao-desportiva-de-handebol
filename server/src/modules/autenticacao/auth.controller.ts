import { BadRequestException, Body, ConflictException, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Request } from "express";
import { ThrottlerGuard } from "@nestjs/throttler";
import { PrismaService } from "../../infrastructure/prisma.service.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AuthService } from "./auth.service.js";
import { SessionGuard } from "./session.guard.js";
import { type Ator, exigirAcessoClube } from "../autorizacao/ator.js";
import { AtorAtual, Requer, RequerAprovado } from "../autorizacao/autorizacao.decorators.js";
import { AutorizacaoService } from "../autorizacao/autorizacao.service.js";
import { z } from "zod";

const camposConta = z.strictObject({
  nomeCompleto: z.string().trim().min(3).max(150),
  email: z.email().max(254).toLowerCase(),
  password: z.string().min(8).max(128),
});
const cadastroSchema = z.discriminatedUnion("perfil", [
  camposConta.extend({ perfil: z.literal("atleta"), clubeId: z.uuid() }),
  camposConta.extend({ perfil: z.literal("tecnico") }),
]);

@Controller()
export class AuthController {
  constructor(private readonly prisma: PrismaService, private readonly authService: AuthService, private readonly autorizacao: AutorizacaoService) {}

  @Get("openapi.json")
  openapi() {
    const json = (schema: object) => ({ content: { "application/json": { schema } } });
    const resposta = (description: string) => ({ description });
    const security = [{ sessionCookie: [] }];
    return {
      openapi: "3.1.0", info: { title: "Handebol — cadastro e sessão", version: "0.1.0" }, servers: [{ url: "/api" }],
      components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}better-auth.session_token` } } },
      paths: {
        "/clubes": { get: { summary: "Clubes disponíveis para cadastro", responses: { "200": resposta("Lista de id, nome e cidade") } } },
        "/cadastros": { post: { summary: "Cadastro público com solicitação de verificação pendente", requestBody: { required: true, ...json(z.toJSONSchema(cadastroSchema)) }, responses: {
          "201": resposta("Usuário e perfil criados atomicamente; faça login em seguida"), "400": resposta("Cadastro ou clube inválido"), "403": resposta("Origem não autorizada"), "409": resposta("E-mail já cadastrado ou conflito com restrições do cadastro"), "429": resposta("Limite de 5 tentativas por IP a cada 15 minutos"),
        } } },
        "/auth/sign-in/email": { post: { summary: "Login Better Auth; emite cookie HttpOnly", requestBody: { required: true, ...json(z.toJSONSchema(camposConta.omit({ nomeCompleto: true }))) }, responses: { "200": resposta("Sessão criada"), "401": resposta("Credenciais inválidas ou cadastro inativo"), "429": resposta("Limite de tentativas de login do Better Auth"), "403": resposta("Origem não autorizada") } } },
        "/auth/get-session": { get: { summary: "Sessão técnica Better Auth ou null", responses: { "200": resposta("Sessão técnica persistida ou null; não concede autorização de domínio") } } },
        "/sessao": { get: { summary: "Sessão com cadastro ativo no domínio", security, responses: { "200": resposta("usuario: id, nomeCompleto, perfil, statusVerificacao, aprovado, clubeId; expiresAt"), "401": resposta("Sessão ou cadastro indisponível") } } },
        "/protegida": { get: { summary: "Prova de acesso autenticado; não exige aprovação esportiva", security, responses: { "200": resposta("message: Acesso autenticado confirmado pelo servidor."), "401": resposta("Sessão ou cadastro indisponível") } } },
        "/protegida/aprovado": { get: { summary: "Demonstração: exige aprovação esportiva (presidente ou atleta/técnico aprovado)", security, responses: { "200": resposta("perfil, aprovado"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Cadastro pendente ou rejeitado") } } },
        "/protegida/presidente": { get: { summary: "Demonstração: exige perfil presidente", security, responses: { "200": resposta("perfil"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão") } } },
        "/protegida/clubes/{clubeId}": { get: { summary: "Demonstração: presidente acessa qualquer clube; atleta/técnico aprovado somente o próprio", security, parameters: [{ name: "clubeId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": resposta("perfil, clubeId"), "400": resposta("clubeId inválido"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Sem aprovação ou clube de outro"), } } },
        "/auth/sign-out": { post: { summary: "Revoga a sessão atual no PostgreSQL e remove cookie", security, requestBody: { required: true, ...json({ type: "object" }) }, responses: { "200": resposta("Logout concluído"), "403": resposta("Origem não autorizada") } } },
      },
    };
  }

  @Get("clubes")
  clubes() {
    return this.prisma.clube.findMany({ select: { id: true, nome: true, cidade: true }, orderBy: { nome: "asc" } });
  }

  @Post("cadastros")
  @UseGuards(ThrottlerGuard)
  async cadastrar(@Body() body: unknown) {
    const parsed = cadastroSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Cadastro inválido. Confira nome, e-mail, senha de 8 a 128 caracteres e perfil. Atleta exige clube; técnico não escolhe clube. Campos adicionais não são permitidos.");
    const data = parsed.data;
    const { nomeCompleto, email, password, perfil } = data;

    const passwordHash = await hashPassword(password);
    try {
      return await this.prisma.$transaction(async tx => {
        const authId = randomUUID();
        await tx.authUser.create({ data: { id: authId, name: nomeCompleto, email } });
        await tx.authAccount.create({ data: { id: randomUUID(), userId: authId, accountId: authId, providerId: "credential", password: passwordHash } });
        const solicitadaEm = new Date();
        const usuario = await tx.usuario.create({ data: {
          authId, nomeCompleto, perfil,
          ...(data.perfil === "atleta"
            ? { atleta: { create: { verificacaoSolicitadaEm: solicitadaEm, vinculos: { create: { clubeId: data.clubeId } } } } }
            : { tecnico: { create: { verificacaoSolicitadaEm: solicitadaEm } } }),
        }, select: { id: true, nomeCompleto: true, perfil: true } });
        return { usuario, statusVerificacao: "pendente" };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") throw new ConflictException("E-mail já cadastrado. Entre com sua senha.");
        if (error.code === "P2003") throw new BadRequestException("Clube não encontrado");
      }
      // CHECK, EXCLUDE e triggers diferidos chegam sem código Prisma próprio: no comando, dentro de
      // meta.driverAdapterError; no COMMIT, como DriverAdapterError direto.
      type ErroDriver = { cause?: { originalCode?: string } };
      const driver = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as ErroDriver | undefined : error as ErroDriver;
      const codigo = driver?.cause?.originalCode;
      if (codigo === "23514" || codigo === "23P01") throw new ConflictException("Não foi possível concluir o cadastro por conflito com os dados existentes.");
      throw error;
    }
  }

  @Get("sessao")
  sessao(@Req() request: Request) { return this.authService.sessao(request.headers); }

  @Get("protegida")
  @UseGuards(SessionGuard)
  protegida() { return { message: "Acesso autenticado confirmado pelo servidor." }; }

  // Rotas de demonstração da autorização de domínio; não concedem nem alteram dados esportivos.
  @Get("protegida/aprovado")
  @UseGuards(SessionGuard)
  @RequerAprovado()
  protegidaAprovado(@AtorAtual() ator: Ator) { return { perfil: ator.perfil, aprovado: ator.aprovado }; }

  @Get("protegida/presidente")
  @UseGuards(SessionGuard)
  @Requer({ perfis: ["presidente"] })
  protegidaPresidente(@AtorAtual() ator: Ator) { return { perfil: ator.perfil }; }

  @Get("protegida/clubes/:clubeId")
  @UseGuards(SessionGuard)
  @RequerAprovado()
  async protegidaClube(@AtorAtual() ator: Ator, @Param("clubeId", new ParseUUIDPipe()) clubeId: string) {
    exigirAcessoClube(ator, clubeId);
    // Revalida na transação, como farão as operações de escrita dos módulos esportivos.
    const revalidado = await this.prisma.$transaction(tx => this.autorizacao.revalidarClube(tx, ator, clubeId));
    return { perfil: revalidado.perfil, clubeId };
  }
}
