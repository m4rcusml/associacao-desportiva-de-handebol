import assert from "node:assert/strict";
import { test } from "node:test";
import { verificarBucketPrivado } from "../scripts/smoke-storage.ts";

assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");

test("smoke consulta o bucket autenticado e só aprova a configuração privada esperada", async () => {
  const pedir: typeof fetch = async (url, init) => {
    assert.equal(url, "https://storage.example/storage/v1/bucket/fotos-atletas");
    assert.deepEqual(init?.headers, { apikey: "chave-ficticia", Authorization: "Bearer chave-ficticia" });
    assert.equal(init?.redirect, "error");
    return Response.json({ id: "fotos-atletas", public: false });
  };
  await verificarBucketPrivado("https://storage.example", "fotos-atletas", "chave-ficticia", pedir);
});

test("smoke recusa bucket público, ausente, resposta incompleta e falhas do Storage", async () => {
  for (const [status, corpo] of [
    [200, { id: "fotos-atletas", public: true }],
    [200, { id: "outro-bucket", public: false }],
    [200, { id: "fotos-atletas" }],
    [200, null],
    [401, { message: "Unauthorized" }],
    [404, { message: "Bucket not found" }],
    [500, { message: "Internal error" }],
  ] as const) {
    await assert.rejects(verificarBucketPrivado("https://storage.example", "fotos-atletas", "chave-ficticia", async () => Response.json(corpo, { status })));
  }
});
