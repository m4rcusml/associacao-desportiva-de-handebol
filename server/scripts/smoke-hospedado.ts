/**
 * Smoke da implantação de teste (MAR-76): encaminhamento Vercel → Render, segredo do proxy, origem, cookies,
 * limites de tentativa com IP forjado, Socket.IO por long-polling, readiness e Storage privado.
 *
 * Uso (dados fictícios; credenciais nunca no repositório):
 *   SMOKE_URL_PUBLICA=https://<client>.vercel.app SMOKE_URL_API_DIRETA=https://<api>.onrender.com npm run smoke:hospedado
 * Opcionais: SMOKE_EMAIL e SMOKE_SENHA (conta fictícia ativa, para cookies e sessão); SMOKE_ATLETA_ID com essas
 * credenciais de presidente (envio e leitura de foto); SMOKE_SUPABASE_URL e SMOKE_FOTOS_BUCKET (bucket não público).
 * Os limites de tentativa ficam bloqueados por alguns segundos para o IP de quem executa.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { io } from "socket.io-client";

const publica = obrigatoria("SMOKE_URL_PUBLICA");
const direta = obrigatoria("SMOKE_URL_API_DIRETA");
const { SMOKE_EMAIL: email, SMOKE_SENHA: senha, SMOKE_ATLETA_ID: atletaId, SMOKE_SUPABASE_URL: supabase, SMOKE_FOTOS_BUCKET: bucket } = process.env;
const https = publica.startsWith("https://");
const origemIntrusa = "https://intruso.example";
const falhas: string[] = [];

function obrigatoria(nome: string) {
  const valor = process.env[nome];
  if (!valor) { console.error(`Defina ${nome}`); process.exit(2); }
  return new URL(valor).origin;
}

async function verificar(nome: string, prova: () => Promise<string | void>) {
  try {
    const detalhe = await prova();
    console.log(`ok    ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (error) {
    falhas.push(nome);
    console.log(`FALHA ${nome} — ${(error as Error).message}`);
  }
}

function exigir(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new Error(mensagem);
}

const pedir = (base: string, caminho: string, init: RequestInit & { origem?: string | null } = {}) => {
  const { origem = publica, headers, ...resto } = init;
  return fetch(`${base}/api${caminho}`, { redirect: "manual", ...resto, headers: { ...(origem ? { Origin: origem } : {}), ...headers } });
};
const json = { "Content-Type": "application/json" };
const forjados = () => ({ "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 250) + 1}`, "X-Real-IP": `198.51.100.${Math.floor(Math.random() * 250) + 1}`, "X-Cliente-IP": "192.0.2.10" });
const status = async (resposta: Response) => `${resposta.status} ${(await resposta.text()).slice(0, 120)}`;

await verificar("liveness e readiness pelo domínio público", async () => {
  for (const caminho of ["/health", "/health/ready"]) {
    const resposta = await pedir(publica, caminho);
    exigir(resposta.status === 200, `${caminho}: ${await status(resposta)}`);
  }
});

await verificar("readiness direto no Render (health check da hospedagem)", async () => {
  const resposta = await pedir(direta, "/health/ready", { origem: null });
  exigir(resposta.status === 200, await status(resposta));
});

await verificar("acesso direto ao Render sem o segredo do proxy é recusado", async () => {
  for (const headers of [{}, { "X-Proxy-Segredo": "x".repeat(40), ...forjados() }]) {
    const resposta = await pedir(direta, "/openapi.json", { headers });
    exigir(resposta.status === 403, `esperado 403, veio ${await status(resposta)}`);
  }
});

await verificar("API pelo domínio público, sem cache", async () => {
  const resposta = await pedir(publica, "/openapi.json");
  exigir(resposta.status === 200, await status(resposta));
  exigir(resposta.headers.get("cache-control")?.includes("no-store"), `Cache-Control: ${resposta.headers.get("cache-control")}`);
  return `servidor ${resposta.headers.get("server") ?? "?"}`;
});

await verificar("escrita com origem estranha é recusada", async () => {
  const resposta = await pedir(publica, "/auth/sign-in/email", { method: "POST", origem: origemIntrusa, headers: json, body: JSON.stringify({ email: "x@example.invalid", password: "x".repeat(12) }) });
  exigir(resposta.status === 403, `esperado 403, veio ${await status(resposta)}`);
});

await verificar("corpo de 5 MB atravessa o encaminhamento (resposta do backend, não da Vercel)", async () => {
  const resposta = await pedir(publica, `/atletas/${randomUUID()}/foto`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(5 * 1024 * 1024 - 1) });
  exigir(!resposta.headers.get("x-vercel-error"), `Vercel recusou: ${resposta.headers.get("x-vercel-error")} (${resposta.status})`);
  exigir(resposta.status === 401, `esperado 401 sem sessão, veio ${await status(resposta)}`);
});

if (email && senha) {
  await verificar("login emite cookies seguros e sessão isolada; logout revoga", async () => {
    const entrada = await pedir(publica, "/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password: senha }) });
    exigir(entrada.status === 200, await status(entrada));
    const cookies = entrada.headers.getSetCookie();
    exigir(cookies.length > 0, "sem Set-Cookie");
    for (const cookie of cookies) {
      exigir(/HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie), `atributos: ${cookie.split(";").slice(1).join(";")}`);
      exigir(!/;\s*Domain=/i.test(cookie), "cookie com Domain (deve ficar restrito ao domínio público)");
      if (https) exigir(/;\s*Secure/i.test(cookie) && cookie.startsWith("__Secure-"), `cookie sem Secure/__Secure-: ${cookie.split("=")[0]}`);
    }
    const cookie = cookies.map(valor => valor.split(";")[0]).join("; ");
    const sessao = await pedir(publica, "/sessao", { headers: { Cookie: cookie } });
    exigir(sessao.status === 200, `sessão: ${await status(sessao)}`);
    const anonima = await pedir(publica, "/sessao");
    exigir(anonima.status === 401, `sem cookie: ${await status(anonima)}`);
    if (atletaId) {
      const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#2a6" } }).png().toBuffer();
      const envio = await pedir(publica, `/atletas/${atletaId}/foto`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "image/png" }, body: new Uint8Array(png) });
      exigir(envio.status === 200, `envio da foto: ${await status(envio)}`);
      const leitura = await pedir(publica, `/atletas/${atletaId}/foto`, { headers: { Cookie: cookie } });
      exigir(leitura.status === 200 && leitura.headers.get("content-type")?.startsWith("image/"), `leitura da foto: ${await status(leitura)}`);
      const semSessao = await pedir(publica, `/atletas/${atletaId}/foto`);
      exigir(semSessao.status === 401, `foto sem sessão: ${await status(semSessao)}`);
    }
    const saida = await pedir(publica, "/auth/sign-out", { method: "POST", headers: { Cookie: cookie, ...json }, body: "{}" });
    exigir(saida.status === 200, `logout: ${await status(saida)}`);
    const depois = await pedir(publica, "/sessao", { headers: { Cookie: cookie } });
    exigir(depois.status === 401, `cookie após logout: ${await status(depois)}`);
    return `${cookies.length} cookie(s)${atletaId ? "; foto enviada e lida" : ""}`;
  });
}

await verificar("limite do login usa o IP real: cabeçalhos forjados não o contornam", async () => {
  const conta = `${randomUUID()}@example.invalid`;
  const respostas: number[] = [];
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const resposta = await pedir(publica, "/auth/sign-in/email", { method: "POST", headers: { ...json, ...forjados() }, body: JSON.stringify({ email: conta, password: "Senha-errada-123" }) });
    respostas.push(resposta.status);
  }
  exigir(respostas.includes(429), `nenhum 429 com IPs forjados: ${respostas.join(", ")}`);
  return respostas.join(", ");
});

await verificar("Socket.IO por long-polling no domínio público (handshake, ping de 25 s)", async () => {
  const caminho = "/socket.io/?EIO=4&transport=polling";
  const abertura = await pedir(publica, caminho);
  const texto = await abertura.text();
  exigir(abertura.status === 200 && texto.startsWith("0{"), `abertura: ${abertura.status} ${texto.slice(0, 80)}`);
  const { sid, pingInterval } = JSON.parse(texto.slice(1)) as { sid: string; pingInterval: number };
  const inicio = Date.now();
  const espera = await pedir(publica, `${caminho}&sid=${sid}`, { signal: AbortSignal.timeout(pingInterval + 20_000) });
  const ping = await espera.text();
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  exigir(espera.status === 200 && ping === "2", `long-poll: ${espera.status} "${ping.slice(0, 80)}" após ${segundos}s`);
  const pong = await pedir(publica, `${caminho}&sid=${sid}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "3" });
  exigir(pong.status === 200, `pong: ${await status(pong)}`);
  return `ping após ${segundos}s`;
});

const conectar = (base: string, origem: string) => new Promise<string>(resolve => {
  const socket = io(base, { path: "/api/socket.io", transports: ["polling"], reconnection: false, timeout: 15_000, extraHeaders: { Origin: origem }, auth: { jogoId: randomUUID() } });
  socket.on("connect", () => { socket.close(); resolve("conectado"); });
  socket.on("connect_error", erro => { socket.close(); resolve(erro.message); });
});

await verificar("Socket.IO autoriza só pelo domínio e pela origem do client", async () => {
  const valida = await conectar(publica, publica);
  exigir(valida === "acesso_indisponivel", `origem do client sem sessão de arbitragem: ${valida}`);
  const intrusa = await conectar(publica, origemIntrusa);
  exigir(intrusa !== "acesso_indisponivel" && intrusa !== "conectado", `origem estranha: ${intrusa}`);
  const semProxy = await conectar(direta, publica);
  exigir(semProxy !== "acesso_indisponivel" && semProxy !== "conectado", `direto no Render: ${semProxy}`);
  return `válida: ${valida}; estranha: ${intrusa}; direto: ${semProxy}`;
});

if (supabase && bucket) {
  await verificar("bucket de fotos não é público", async () => {
    const base = new URL(supabase).origin;
    for (const url of [`${base}/storage/v1/object/public/${bucket}/inexistente.jpg`, `${base}/storage/v1/bucket/${bucket}`]) {
      const resposta = await fetch(url);
      exigir(resposta.status !== 200, `${url} respondeu 200`);
    }
  });
}

if (falhas.length) {
  console.log(`\n${falhas.length} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log("\nTodas as verificações passaram.");
}
