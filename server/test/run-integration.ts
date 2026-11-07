import "reflect-metadata";
import { spawn } from "node:child_process";
import { globSync } from "node:fs";
import { testDatabase } from "./support/database.ts";

// Validar antes de criar clientes ou executar migrações; o ambiente já vale para todos os arquivos.
process.env.DATABASE_URL = testDatabase(process.env);
process.env.NODE_ENV = "test";
process.env.INTEGRATION_TEST_RUNNER = "1";
const { PrismaService } = await import("../dist/infrastructure/prisma.service.js");
const prisma = new PrismaService();

async function run(args: string[], timeout: number) {
  const child = spawn(process.execPath, args, { stdio: "inherit", timeout });
  return new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Processo de integração falhou (${signal ?? code})`));
    });
  });
}

try {
  await prisma.$transaction(async tx => {
    // Lock por banco, compartilhado entre máquinas e liberado ao terminar a transação/conexão.
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(530053) AS acquired`;
    if (!lock.acquired) throw new Error("Outra suíte de integração já está usando este banco");
    const files = globSync("test/**/*.integration.ts").sort();
    if (files.length === 0) throw new Error("Nenhum arquivo de integração encontrado");
    await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], 60_000);
    await run(["--test", "--test-concurrency=1", ...files], 25 * 60_000);
  }, { timeout: 30 * 60_000 });
} finally {
  await prisma.$disconnect();
}
