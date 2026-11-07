-- CreateEnum
CREATE TYPE "Perfil" AS ENUM ('atleta', 'tecnico', 'presidente');

-- CreateEnum
CREATE TYPE "StatusVerificacao" AS ENUM ('pendente', 'aprovado', 'rejeitado');

-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthVerification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "authId" TEXT NOT NULL,
    "nomeCompleto" TEXT NOT NULL,
    "perfil" "Perfil" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presidente" (
    "usuarioId" UUID NOT NULL,
    "criadoPorPresidenteId" UUID,

    CONSTRAINT "Presidente_pkey" PRIMARY KEY ("usuarioId")
);

-- CreateTable
CREATE TABLE "Atleta" (
    "usuarioId" UUID NOT NULL,
    "fotoChave" TEXT,
    "statusVerificacao" "StatusVerificacao" NOT NULL DEFAULT 'pendente',
    "verificacaoSolicitadaEm" TIMESTAMPTZ,
    "verificadoPorPresidenteId" UUID,
    "verificadoEm" TIMESTAMPTZ,

    CONSTRAINT "Atleta_pkey" PRIMARY KEY ("usuarioId")
);

-- CreateTable
CREATE TABLE "Tecnico" (
    "usuarioId" UUID NOT NULL,
    "clubeId" UUID,
    "statusVerificacao" "StatusVerificacao" NOT NULL DEFAULT 'pendente',
    "verificacaoSolicitadaEm" TIMESTAMPTZ,
    "verificadoPorPresidenteId" UUID,
    "verificadoEm" TIMESTAMPTZ,

    CONSTRAINT "Tecnico_pkey" PRIMARY KEY ("usuarioId")
);

-- CreateTable
CREATE TABLE "Clube" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cidade" TEXT,
    "criadoPorPresidenteId" UUID NOT NULL,

    CONSTRAINT "Clube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinculoClube" (
    "id" UUID NOT NULL,
    "atletaId" UUID NOT NULL,
    "clubeId" UUID NOT NULL,
    "inicio" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim" TIMESTAMPTZ,
    "definidoPorPresidenteId" UUID,

    CONSTRAINT "VinculoClube_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAccount_providerId_accountId_key" ON "AuthAccount"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_authId_key" ON "Usuario"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "Tecnico_clubeId_key" ON "Tecnico"("clubeId");

-- CreateIndex
CREATE INDEX "VinculoClube_clubeId_idx" ON "VinculoClube"("clubeId");

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presidente" ADD CONSTRAINT "Presidente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presidente" ADD CONSTRAINT "Presidente_criadoPorPresidenteId_fkey" FOREIGN KEY ("criadoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atleta" ADD CONSTRAINT "Atleta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atleta" ADD CONSTRAINT "Atleta_verificadoPorPresidenteId_fkey" FOREIGN KEY ("verificadoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tecnico" ADD CONSTRAINT "Tecnico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tecnico" ADD CONSTRAINT "Tecnico_clubeId_fkey" FOREIGN KEY ("clubeId") REFERENCES "Clube"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tecnico" ADD CONSTRAINT "Tecnico_verificadoPorPresidenteId_fkey" FOREIGN KEY ("verificadoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clube" ADD CONSTRAINT "Clube_criadoPorPresidenteId_fkey" FOREIGN KEY ("criadoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculoClube" ADD CONSTRAINT "VinculoClube_atletaId_fkey" FOREIGN KEY ("atletaId") REFERENCES "Atleta"("usuarioId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculoClube" ADD CONSTRAINT "VinculoClube_clubeId_fkey" FOREIGN KEY ("clubeId") REFERENCES "Clube"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculoClube" ADD CONSTRAINT "VinculoClube_definidoPorPresidenteId_fkey" FOREIGN KEY ("definidoPorPresidenteId") REFERENCES "Presidente"("usuarioId") ON DELETE SET NULL ON UPDATE CASCADE;
