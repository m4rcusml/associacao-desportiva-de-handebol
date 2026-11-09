import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { io } from "socket.io-client";

// Implantação hospedada (MAR-76): somente o proxy público chega à API e informa o IP do cliente.
assert.equal(process.env.INTEGRATION_TEST_RUNNER, "1", "Use npm run test:integration para preparar e bloquear o banco");
const segredo = "segredo-de-proxy-somente-para-teste-0123456789";
process.env.PROXY_SEGREDO = segredo;
const { createApp } = await import("../dist/app.js");
const { lerSegredoProxy } = await import("../dist/infrastructure/proxy-confiavel.js");

const origin = process.env.CLIENT_ORIGIN!;
const app = await createApp();
let raiz: string;
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
const doProxy = (ipCliente: string) => ({ "X-Proxy-Segredo": segredo, "X-Cliente-IP": ipCliente });
const pedir = (path: string, headers: Record<string, string> = {}, body?: unknown) => fetch(`${raiz}/api${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

before(async () => {
  await app.listen(0, "127.0.0.1");
  raiz = (await app.getUrl()).replace("[::1]", "127.0.0.1");
});
after(() => app.close());

test("configuração exige segredo longo e o torna obrigatório em produção", () => {
  assert.equal(lerSegredoProxy({}), null);
  assert.throws(() => lerSegredoProxy({ NODE_ENV: "production" }), /PROXY_SEGREDO/);
  assert.throws(() => lerSegredoProxy({ PROXY_SEGREDO: "curto" }), /32 caracteres/);
  assert.equal(lerSegredoProxy({ PROXY_SEGREDO: segredo, NODE_ENV: "production" }), segredo);
});

test("liveness e readiness respondem sem o proxy; o restante exige segredo e IP válidos", async () => {
  for (const path of ["/health", "/health/ready"]) {
    const resposta = await pedir(path);
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { status: "ok" });
  }
  for (const headers of [{}, { "X-Proxy-Segredo": "errado".repeat(8), "X-Cliente-IP": ip() }, { "X-Proxy-Segredo": segredo }, { ...doProxy("não-é-ip") }] as Record<string, string>[]) {
    const resposta = await pedir("/openapi.json", headers);
    assert.equal(resposta.status, 403);
    assert.deepEqual(await resposta.json(), { message: "Acesso somente pelo domínio público" });
  }
  assert.equal((await pedir("/openapi.json", doProxy(ip()))).status, 200);
  assert.equal((await pedir("/openapi.json", doProxy("2001:db8::1"))).status, 200);
  // A verificação de origem continua valendo atrás do proxy.
  assert.equal((await pedir("/auth/sign-in/email", { ...doProxy(ip()), Origin: "https://intruso.example" }, { email: "x@example.invalid", password: "Senha-errada-123" })).status, 403);
});

test("limite do login segue o IP do proxy e ignora X-Forwarded-For do cliente", async () => {
  const cliente = ip();
  const login = (headers: Record<string, string>) => pedir("/auth/sign-in/email", headers, { email: `${randomUUID()}@example.invalid`, password: "Senha-errada-123" });
  const respostas = [];
  for (let tentativa = 0; tentativa < 4; tentativa += 1) {
    respostas.push((await login({ ...doProxy(cliente), "X-Forwarded-For": ip() })).status);
  }
  assert.deepEqual(respostas, [401, 401, 401, 429]);
  // Outro IP informado pelo proxy tem contador próprio.
  assert.equal((await login({ ...doProxy(ip()), "X-Forwarded-For": cliente })).status, 401);
});

test("limite do cadastro segue o IP do proxy, não o do socket", async () => {
  const cliente = ip();
  const cadastro = (ipCliente: string) => pedir("/cadastros", doProxy(ipCliente), { nomeCompleto: "Pessoa Fictícia", email: "invalido", password: "Senha-local-de-teste-2026", perfil: "tecnico" });
  const respostas = [];
  for (let tentativa = 0; tentativa < 6; tentativa += 1) respostas.push((await cadastro(cliente)).status);
  assert.deepEqual(respostas, [400, 400, 400, 400, 400, 429]);
  assert.equal((await cadastro(ip())).status, 400);
});

test("Socket.IO exige o segredo do proxy além da origem do client", async () => {
  const conectar = (headers: Record<string, string>) => new Promise<string>(resolve => {
    const socket = io(raiz, { path: "/api/socket.io", transports: ["polling"], reconnection: false, extraHeaders: headers, auth: { jogoId: randomUUID() } });
    socket.on("connect", () => { socket.close(); resolve("conectado"); });
    socket.on("connect_error", erro => { socket.close(); resolve(erro.message); });
  });
  // Com o segredo, a conexão chega à validação da sessão de arbitragem (ausente aqui).
  assert.equal(await conectar({ Origin: origin, ...doProxy(ip()) }), "acesso_indisponivel");
  assert.notEqual(await conectar({ Origin: origin }), "acesso_indisponivel");
  assert.notEqual(await conectar({ Origin: "https://intruso.example", ...doProxy(ip()) }), "acesso_indisponivel");
});
