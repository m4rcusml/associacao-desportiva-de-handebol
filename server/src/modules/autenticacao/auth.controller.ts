import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
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
import { camposConta, criarIdentidade, traduzirErroIdentidade } from "./identidade.js";
import { openapiClubes } from "../clubes/clubes.openapi.js";
import { openapiVerificacoes } from "../verificacoes/verificacoes.openapi.js";
import { openapiCarteirinhas } from "../carteirinhas/carteirinhas.openapi.js";
import { openapiContaPropria } from "../contas/contas.openapi.js";
import { openapiCampeonatos } from "../campeonatos/campeonatos.openapi.js";
import { openapiJogos } from "../jogos/jogos.openapi.js";
import { openapiAtletas } from "../atletas/atletas.openapi.js";
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
        ...openapiClubes,
        ...openapiVerificacoes,
        ...openapiCarteirinhas,
        ...openapiContaPropria,
        ...openapiCampeonatos,
        ...openapiJogos,
        ...openapiAtletas,
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
        "/presidentes": { post: { summary: "Presidente ativo cria outro presidente com senha inicial; registra o criador", security, requestBody: { required: true, ...json(z.toJSONSchema(camposConta)) }, responses: {
          "201": resposta("usuario: id, nomeCompleto, perfil; criadoPorPresidenteId"), "400": resposta("Dados inválidos ou campos adicionais"), "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão ou origem não autorizada"), "409": resposta("E-mail já cadastrado ou conflito com restrições do cadastro"),
        } } },
        ...Object.fromEntries((["desativacao", "reativacao"] as const).map(operacao => [`/contas/{usuarioId}/${operacao}`, { post: {
          summary: operacao === "desativacao"
            ? "Presidente desativa outra conta: bloqueia login e operações e revoga as sessões abertas; histórico e vínculos preservados"
            : "Presidente reativa outra conta; sessões anteriores continuam revogadas e a pessoa entra novamente",
          security, parameters: [{ name: "usuarioId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: { required: false, ...json({ type: "object", additionalProperties: false }) },
          responses: {
            "200": resposta("usuario: id, perfil, ativo; alterado false quando a conta já estava no estado pedido"), "400": resposta("usuarioId inválido ou corpo com campos"),
            "401": resposta("Sessão ou cadastro indisponível"), "403": resposta("Perfil sem permissão, própria conta ou origem não autorizada"), "404": resposta("Conta não encontrada"),
            ...(operacao === "desativacao" ? { "409": resposta("Último presidente ativo com credencial") } : {}),
          },
        } }])),
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
        const authId = await criarIdentidade(tx, { nomeCompleto, email, passwordHash });
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw new BadRequestException("Clube não encontrado");
      throw traduzirErroIdentidade(error);
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
