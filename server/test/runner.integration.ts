import "reflect-metadata";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { testDatabase } from "./support/database.ts";

test("runner rejeita banco ausente, de desenvolvimento, sem sufixo ou com parâmetros", () => {
  const development = "postgresql://localhost/handebol";
  for (const candidate of [undefined, "inválida", development, "postgresql://localhost/outro", "postgresql://localhost/handebol_test?database=handebol", "postgresql://localhost/handebol_test#fragmento", "https://localhost/handebol_test"]) {
    assert.throws(() => testDatabase({ DATABASE_URL: development, TEST_DATABASE_URL: candidate }));
  }
  assert.throws(() => testDatabase({ TEST_DATABASE_URL: "postgresql://localhost/handebol_test" }));
  assert.throws(() => testDatabase({ DATABASE_URL: "postgresql://localhost/handebol_test", TEST_DATABASE_URL: "postgresql://127.0.0.1/handebol%5Ftest" }));
  const dedicated = "postgresql://localhost/handebol_test";
  assert.equal(testDatabase({ DATABASE_URL: development, TEST_DATABASE_URL: dedicated }), dedicated);
});

test("runner recusa segunda execução no mesmo banco antes de migrar ou iniciar testes", () => {
  assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration");
  const result = spawnSync(process.execPath, ["test/run-integration.ts"], {
    env: { ...process.env, DATABASE_URL: "postgresql://localhost/handebol" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Outra suíte de integração já está usando este banco/);
});
