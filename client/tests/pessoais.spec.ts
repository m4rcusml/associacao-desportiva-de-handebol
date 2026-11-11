import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { loginQA } from "./login-qa";

type Acesso = { email: string; password: string; usuarios: Record<string, { id: string }>; clubes: Record<string, { id: string }>; campeonatos: Record<string, { id: string }> };
const caminho = process.env.HANDEBOL_QA_ACESSO;
const acesso: Acesso | null = caminho && existsSync(caminho) ? JSON.parse(readFileSync(caminho, "utf8")) : null;
const api = process.env.HANDEBOL_QA_API ?? "http://localhost:3001/api";
const origem = process.env.HANDEBOL_QA_URL ?? "http://localhost:3000";
if (acesso && [api, origem].some(url => !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))) throw new Error("A massa local de frontend só pode ser usada com API e navegador locais.");

test.skip(!acesso, "QA integrado requer HANDEBOL_QA_ACESSO com a massa fictícia local; não executa contra hospedagem.");

async function entrar(context: BrowserContext, chave: string) {
  const response = await loginQA(context.request, api, origem, { email: chave === "presidente" ? acesso!.email : `frontend-${chave}@example.invalid`, password: acesso!.password });
  expect(response.status(), "Login da massa fictícia local").toBe(200);
}

async function novoJogo(context: BrowserContext) {
  await entrar(context, "presidente");
  const campeonatoResponse = await context.request.post(`${api}/campeonatos`, { headers: { Origin: origem }, data: { nome: "QA novo frontend — escalação", edicao: String(Date.now()), categoria: "Fictícia" } });
  expect(campeonatoResponse.status()).toBe(201);
  const campeonato = await campeonatoResponse.json();
  for (const clubeId of [acesso!.clubes.serra.id, acesso!.clubes.vale.id]) {
    const inscricao = await context.request.post(`${api}/campeonatos/${campeonato.id}/inscricoes`, { headers: { Origin: origem }, data: { clubeId } });
    expect(inscricao.status()).toBe(201);
  }
  const response = await context.request.post(`${api}/campeonatos/${campeonato.id}/jogos`, {
    headers: { Origin: origem }, data: { clubeAId: acesso!.clubes.serra.id, clubeBId: acesso!.clubes.vale.id, inicioPrevisto: `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T18:00`, fusoHorario: "America/Sao_Paulo", local: "Ginásio fictício de QA do novo frontend" },
  });
  expect(response.status(), "Novo jogo isolado para testar escalação, sem alterar jogos da massa").toBe(201);
  const jogo = await response.json();
  await context.request.post(`${api}/auth/sign-out`, { headers: { Origin: origem }, data: {} });
  return jogo.id as string;
}

async function semOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function capturaPrivada(page: Page, path: string) {
  await page.screenshot({ path, fullPage: true, animations: "disabled", mask: [page.locator('svg[role="img"]'), page.locator('section[aria-label="Identificação do atleta"] svg'), page.locator('dialog svg'), page.locator('img[alt^="Foto de"]'), page.locator('img[alt="Prévia da foto escolhida"]')] });
}

test("atleta usa QR vigente, amplia com foco e navega em quatro destinos sem overflow", async ({ context, page }, info) => {
  await entrar(context, "ana");
  const cardResponse = await context.request.get(`${api}/carteirinhas/minha`);
  expect(cardResponse.status()).toBe(200);
  const card = await cardResponse.json();
  await page.goto("/atleta");
  await expect(page.getByRole("heading", { name: "Minha carteirinha", exact: true })).toBeVisible();
  const svg = page.locator('section[aria-label="Identificação do atleta"] svg');
  const esperado = renderToStaticMarkup(createElement(QRCodeSVG, { value: card.tokenQr, size: 288, marginSize: 4, level: "M" }));
  const pathsEsperados = [...esperado.matchAll(/ d="([^"]*)"/g)].map(m => m[1]);
  await expect(svg).toBeVisible();
  const pathsReais = await svg.locator("path").evaluateAll(paths => paths.map(p => p.getAttribute("d")));
  // Compara o QR sem imprimir token ou geometria codificada em falhas de teste.
  expect(JSON.stringify(pathsReais) === JSON.stringify(pathsEsperados), "QR renderizado corresponde ao token vigente retornado pela API").toBe(true);
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await semOverflow(page);
    await capturaPrivada(page, info.outputPath(`atleta-${width}.png`));
  }
  const ampliar = page.getByRole("button", { name: "Ampliar QR para leitura" });
  await ampliar.click();
  await expect(page.getByRole("button", { name: "Fechar QR ampliado" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(ampliar).toBeFocused();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route("**/api/carteirinhas/minha", async route => {
    const response = await route.fetch();
    const respostaReal = await response.json();
    await route.fulfill({ response, json: { ...respostaReal, nomeCompleto: "Nome fictício muito extenso para verificar que a identificação do atleta continua legível sem sobrepor o clube ou a carteirinha" } });
  });
  await page.getByRole("button", { name: "Atualizar carteirinha", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Nome fictício muito extenso/ })).toBeVisible();
  await semOverflow(page);
  await page.unroute("**/api/carteirinhas/minha");
  await page.route("**/api/carteirinhas/minha", route => route.fulfill({ status: 503, json: { message: "Falha de leitura simulada para QA. O servidor está temporariamente indisponível. Conecte-se à internet, confira a ligação de dados do dispositivo e use Atualizar carteirinha para consultar novamente sem perder o contexto." } }));
  await page.getByRole("button", { name: "Atualizar carteirinha", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Falha de leitura simulada para QA" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Nome fictício muito extenso/ })).toBeVisible();
  await semOverflow(page);
  await capturaPrivada(page, info.outputPath("atleta-320-nome-longo-erro-simulado.png"));
  await page.unroute("**/api/carteirinhas/minha");
  const nav = page.getByRole("navigation", { name: "Área do atleta" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await nav.getByRole("link", { name: "Histórico", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Meu histórico", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Histórico", exact: true })).toHaveAttribute("aria-current", "page");
  const participacao = page.getByRole("button", { name: /^Ver minha participação em / }).first();
  if (await participacao.count()) {
    await participacao.click();
    await expect(page.getByRole("dialog")).toContainText("Escalação, credenciamento e entrada são etapas distintas");
    await expect(page.getByRole("dialog")).toContainText(/Clube representado neste jogo/);
    await page.getByRole("button", { name: "Fechar participação" }).click();
    await expect(participacao).toBeFocused();
  }
  await nav.getByRole("link", { name: "Clubes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clubes da associação", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Clubes", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Conta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Minha conta", exact: true })).toBeVisible();
  await page.getByText("Editar nome", { exact: true }).click();
  await expect(page.getByLabel("Como você será identificado")).toBeVisible();
  await page.locator("summary").filter({ hasText: "Minha foto" }).click();
  await expect(page.getByLabel("Escolher foto")).toBeVisible();
});

test("técnico escala e retira em um toque; sucesso sobrevive à releitura falha e resposta perdida exige atualizar", async ({ context, page }, info) => {
  const jogoId = await novoJogo(context);
  await entrar(context, "marcos");
  await page.goto(`/tecnico/jogos/${jogoId}`);
  await expect(page.getByRole("heading", { name: "Escalação", exact: true })).toBeVisible();
  const escalar = page.getByRole("button", { name: /^Escalar / }).first();
  await expect(escalar).toBeEnabled();
  const nome = (await escalar.getAttribute("aria-label"))!.slice("Escalar ".length);
  let posts = 0;
  let deletes = 0;
  page.on("request", request => {
    if (request.url() === `${api}/jogos/${jogoId}/escalacao` && request.method() === "POST") posts++;
    if (request.url().startsWith(`${api}/jogos/${jogoId}/escalacao/`) && request.method() === "DELETE") deletes++;
  });
  let falharReleitura = true;
  await page.route(`**/api/jogos/${jogoId}/desempenho`, async route => { if (falharReleitura) { falharReleitura = false; await route.abort("failed"); } else await route.continue(); });
  await escalar.click();
  await expect(page.getByText(`${nome}: escalação confirmada.`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Retirar ${nome}`, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts).toBe(1);
  await expect(page.getByRole("alert").filter({ hasText: /^Desempenho:/ })).toBeVisible();
  await page.getByRole("button", { name: "Atualizar dados do jogo", exact: true }).click();
  const retirar = page.getByRole("button", { name: `Retirar ${nome}`, exact: true });
  await expect(retirar).toBeEnabled();
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await semOverflow(page);
    await capturaPrivada(page, info.outputPath(`tecnico-${width}.png`));
  }
  await retirar.click();
  await expect(page.getByText(`${nome}: retirado da escalação.`, { exact: true })).toBeVisible();
  expect(deletes).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let perderResposta = true;
  await page.route(`**/api/jogos/${jogoId}/escalacao`, async route => {
    if (route.request().method() === "POST" && perderResposta) { perderResposta = false; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: `Escalar ${nome}`, exact: true }).click();
  await expect(page.getByText("Atualize os dados antes de tentar outra alteração. Sua última tentativa pode ter sido recebida pelo servidor.", { exact: true })).toBeVisible();
  expect(posts).toBe(2);
  await page.getByRole("button", { name: "Atualizar dados do jogo", exact: true }).click();
  await expect(page.getByRole("button", { name: `Retirar ${nome}`, exact: true })).toBeEnabled();
  expect(posts).toBe(2);
});

test("cadastro rejeitado permanece sem carteirinha e resposta de sessão atrasada não restaura a conta após sair", async ({ context, page }) => {
  await entrar(context, "felipe");
  const sessao = await (await context.request.get(`${api}/sessao`)).json();
  test.skip(sessao.usuario.statusVerificacao !== "rejeitado", "A conta fictícia foi alterada em QA anterior; este teste preserva sua situação atual.");
  await page.goto("/atleta");
  await expect(page.getByRole("heading", { name: "Cadastro não aprovado", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ampliar QR para leitura" })).toHaveCount(0);
  await page.goto("/atleta/conta");
  await expect(page.getByRole("button", { name: "Atualizar situação", exact: true })).toBeVisible();
  let liberar!: () => void;
  let iniciou!: () => void;
  const pendente = new Promise<void>(resolve => { liberar = resolve; });
  const requisitou = new Promise<void>(resolve => { iniciou = resolve; });
  await page.route("**/api/sessao", async route => { const response = await route.fetch(); iniciou(); await pendente; await route.fulfill({ response }); });
  await page.getByRole("button", { name: "Atualizar situação", exact: true }).click();
  await requisitou;
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  liberar();
  await expect(page.getByRole("heading", { name: "Entre na associação", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Minha conta", exact: true })).toHaveCount(0);
});
