import "reflect-metadata";
import { PrismaService } from "../dist/infrastructure/prisma.service.js";

const prisma = new PrismaService();
try {
  if (process.env.NODE_ENV === "production") throw new Error("Seed fictício somente para desenvolvimento/teste");
  await prisma.$transaction(async tx => {
    const authId = "seed-presidente-local";
    await tx.authUser.upsert({ where: { id: authId }, update: {}, create: {
      id: authId, name: "Presidente fictício", email: "presidente@handebol.example.invalid",
    } });
    const presidente = await tx.usuario.upsert({ where: { authId }, update: {}, create: {
      authId, nomeCompleto: "Presidente fictício", perfil: "presidente", presidente: { create: {} },
    } });
    await tx.clube.upsert({ where: { id: "00000000-0000-4000-8000-000000000001" }, update: {}, create: {
      id: "00000000-0000-4000-8000-000000000001", nome: "Clube Horizonte (fictício)", cidade: "Cidade Exemplo", criadoPorPresidenteId: presidente.id,
    } });
  });
  console.log("Seed local concluído: um presidente sem credencial de login e um clube fictício.");
} finally {
  await prisma.$disconnect();
}
