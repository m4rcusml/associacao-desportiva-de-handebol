import { test, expect, request, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loginQA } from "./login-qa";

const fixture = process.env.HANDEBOL_QA_ACESSO;
const apiBase = process.env.HANDEBOL_QA_API ?? "http://localhost:3001/api";
const origem = process.env.HANDEBOL_QA_ORIGEM ?? "http://localhost:3000";
type Acesso = { email: string; password: string; clubes: { serra: { id: string }; vale: { id: string } }; usuarios: { ana: { id: string }; bruno: { id: string }; carla: { id: string } } };
type JogoTeste = { id: string; senha: string; base: string };
test.use({ trace: "off", video: "off", screenshot: "off" });

// Opt-in: estes testes gravam apenas cenários fictícios numa API local já preparada, sem reset.
test.describe("Arbitragem com API real", () => {
  test.skip(!fixture, "Defina HANDEBOL_QA_ACESSO com o arquivo local de dados fictícios; nunca use produção.");
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  let presidente: APIRequestContext;
  let acesso: Acesso;

  async function pedir<T>(cliente: APIRequestContext, path: string, data?: unknown, method = data === undefined ? "GET" : "POST"): Promise<T> {
    const resposta = await cliente.fetch(`${apiBase}${path}`, { method, ...(data === undefined ? {} : { data }), headers: { Origin: origem } });
    expect(resposta.ok(), `${method} ${path}: ${resposta.status()}`).toBeTruthy();
    return await resposta.json() as T;
  }

  test.beforeAll(async () => {
    if (!fixture) return;
    if ([apiBase, origem].some(url => !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))) throw new Error("QA da arbitragem aceita somente API e interface locais; não executa massa contra hospedagem.");
    acesso = JSON.parse((await readFile(fixture, "utf8")).replace(/^\uFEFF/, "")) as Acesso;
    presidente = await request.newContext();
    const login = await loginQA(presidente, apiBase, origem, { email: acesso.email, password: acesso.password });
    expect(login.ok(), `Login da fixture: ${login.status()}`).toBeTruthy();
  });
  test.afterAll(async () => { await presidente?.dispose(); });

  async function preparar(contexto: BrowserContext, prepararParticipantes = true): Promise<JogoTeste> {
    const campeonato = await pedir<{ id: string }>(presidente, "/campeonatos", { nome: `QA novo frontend ${randomUUID().slice(0, 8)}`, edicao: "2026", categoria: "Adulto" });
    for (const clubeId of [acesso.clubes.serra.id, acesso.clubes.vale.id]) await pedir(presidente, `/campeonatos/${campeonato.id}/inscricoes`, { clubeId });
    const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const jogo = await pedir<{ id: string }>(presidente, `/campeonatos/${campeonato.id}/jogos`, { clubeAId: acesso.clubes.serra.id, clubeBId: acesso.clubes.vale.id, inicioPrevisto: `${hoje}T17:00`, fusoHorario: "America/Sao_Paulo", local: "Ginásio fictício de QA frontend" });
    const senha = await pedir<{ senha: string }>(presidente, `/jogos/${jogo.id}/arbitragem/senha`);
    const base = `/arbitragem/jogos/${jogo.id}`;
    await pedir(contexto.request, `${base}/entrada/senha`, { nomeCompleto: "Mesa de QA frontend", senha: senha.senha, visualizacao: "banco" });
    if (prepararParticipantes) {
      for (const [atletaId, numeroCamisa] of [[acesso.usuarios.ana.id, 7], [acesso.usuarios.bruno.id, 9], [acesso.usuarios.carla.id, 11]]) await pedir(contexto.request, `${base}/credenciamentos`, { atletaId, numeroCamisa });
      await pedir(contexto.request, `${base}/inicio`, {});
    }
    return { id: jogo.id, senha: senha.senha, base };
  }

  async function abrir(page: Page, jogo: JogoTeste) {
    await page.goto(`${origem}/arbitragem/jogos/${jogo.id}`);
    await expect(page.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeEnabled({ timeout: 30_000 });
  }

  test("gol em um toque, exclusão em modo+camisa, POST preservado após falha da releitura e reenvio idempotente", async ({ page, context }) => {
    const jogo = await preparar(context);
    await abrir(page, jogo);
    await page.getByRole("button", { name: /^Gol, camisa 7,/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /Gol: camisa 7/ })).toBeVisible();
    await page.getByRole("button", { name: "Exclusão de 2 minutos", exact: true }).click();
    await page.getByRole("button", { name: /^Exclusão de 2 minutos, camisa 9,/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /Exclusão de 2 minutos: camisa 9/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Gol", exact: true })).toHaveAttribute("aria-pressed", "true");
    const antes = await pedir<{ lancamentos: unknown[] }>(context.request, `${jogo.base}/lancamentos`);
    expect(antes.lancamentos).toHaveLength(2);

    let falharGet = false;
    let perderResposta = false;
    const corpos: unknown[] = [];
    await page.route(`**/api${jogo.base}/lancamentos`, async route => {
      const requisicao = route.request();
      if (requisicao.method() === "GET" && falharGet) { await route.abort("failed"); return; }
      if (requisicao.method() === "POST" && perderResposta) {
        corpos.push(requisicao.postDataJSON());
        const resposta = await route.fetch();
        expect(resposta.ok()).toBeTruthy();
        perderResposta = false;
        await route.abort("failed"); return;
      }
      if (requisicao.method() === "POST" && corpos.length) corpos.push(requisicao.postDataJSON());
      await route.continue();
    });
    falharGet = true;
    await page.getByRole("button", { name: /^Gol, camisa 7,/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "desatualizados" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /Gol: camisa 7/ })).toBeVisible();
    await expect(page.getByLabel(/^Placar oficial\./)).toContainText("2");
    falharGet = false;
    const navegacao = page.getByRole("navigation", { name: "Áreas da arbitragem" });
    await navegacao.getByRole("button", { name: "Opções", exact: true }).click();
    await page.getByRole("button", { name: "Atualizar dados do jogo", exact: true }).click();
    await navegacao.getByRole("button", { name: "Jogo", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeEnabled();

    perderResposta = true;
    await page.getByRole("button", { name: /^Gol, camisa 7,/ }).click();
    await expect(page.getByRole("heading", { name: "Envio não confirmado" })).toBeVisible();
    const reenviar = page.getByRole("button", { name: "Reenviar a mesma operação" });
    await expect(reenviar).toBeEnabled();
    await reenviar.click();
    await expect(page.getByRole("heading", { name: "Envio não confirmado" })).toHaveCount(0);
    expect(corpos).toHaveLength(2);
    expect(corpos[1]).toEqual(corpos[0]);
    const registros = await pedir<{ lancamentos: { operacaoId: string }[] }>(context.request, `${jogo.base}/lancamentos`);
    expect(registros.lancamentos).toHaveLength(4);
    expect(registros.lancamentos.filter(l => l.operacaoId === (corpos[0] as { operacaoId: string }).operacaoId)).toHaveLength(1);
  });

  test("câmera negada oferece lista; credenciamento manual, camisa duplicada, entrada única, desfazer e interrupção", async ({ page, context }, testInfo) => {
    const jogo = await preparar(context, false);
    await context.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => { throw new DOMException("Permissão negada no teste", "NotAllowedError"); } });
    });
    await page.goto(`${origem}/arbitragem/jogos/${jogo.id}`);
    await expect(page.getByRole("heading", { name: "Conferir os atletas" })).toBeVisible();
    await page.getByRole("button", { name: "Ler QR da carteirinha", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("câmera não foi autorizada");
    await page.getByRole("dialog").getByRole("button", { name: "Usar lista de atletas" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    type Elenco = { clubes: { inscricaoId: string; clube: { nome: string }; atletas: { atleta: { id: string; nomeCompleto: string }; credenciamento: { numeroCamisa: number; entrouEmQuadraEm: string | null } | null }[] }[] };
    const elenco = await pedir<Elenco>(context.request, `${jogo.base}/atletas`);
    async function abrirFicha(atletaId: string, camisa?: number) {
      const clube = elenco.clubes.find(c => c.atletas.some(a => a.atleta.id === atletaId))!;
      const atleta = clube.atletas.find(a => a.atleta.id === atletaId)!;
      await page.getByRole("group", { name: "Clube para conferir" }).getByRole("button", { name: clube.clube.nome, exact: true }).click();
      await page.getByRole("button", { name: `${atleta.atleta.nomeCompleto}, ${camisa === undefined ? "não credenciado" : `camisa ${camisa}`}, ${clube.clube.nome}`, exact: true }).click();
      return page.getByRole("dialog");
    }
    let ficha = await abrirFicha(acesso.usuarios.ana.id);
    await ficha.getByRole("textbox", { name: /^Número da camisa\b/ }).fill("7");
    await ficha.getByRole("button", { name: "Revisar credenciamento" }).click();
    await ficha.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Atleta credenciado." })).toBeVisible();
    ficha = await abrirFicha(acesso.usuarios.bruno.id);
    await ficha.getByRole("textbox", { name: /^Número da camisa\b/ }).fill("7");
    await ficha.getByRole("button", { name: "Revisar credenciamento" }).click();
    await ficha.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(ficha.getByRole("alert")).toContainText("já está em uso");
    await ficha.getByRole("textbox", { name: /^Número da camisa\b/ }).fill("9");
    await ficha.getByRole("button", { name: "Revisar credenciamento" }).click();
    await ficha.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Iniciar jogo", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Iniciar jogo", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeEnabled();

    const navegacao = page.getByRole("navigation", { name: "Áreas da arbitragem" });
    await navegacao.getByRole("button", { name: "Credenciar", exact: true }).click();
    ficha = await abrirFicha(acesso.usuarios.ana.id, 7);
    await ficha.getByRole("button", { name: "Registrar entrada em quadra", exact: true }).click();
    await ficha.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Entrada em quadra registrada." })).toBeVisible();
    ficha = await abrirFicha(acesso.usuarios.ana.id, 7);
    await expect(ficha.getByRole("button", { name: "Registrar entrada em quadra", exact: true })).toHaveCount(0);
    await expect(ficha.getByText("Entrada registrada", { exact: true })).toBeVisible();
    await expect(ficha.getByRole("button", { name: "Desfazer credenciamento", exact: true })).toBeDisabled();
    await ficha.getByRole("button", { name: "Voltar à lista" }).click();
    const antes = await pedir<Elenco>(context.request, `${jogo.base}/atletas`);
    const entrada = antes.clubes.flatMap(c => c.atletas).find(a => a.atleta.id === acesso.usuarios.ana.id)!.credenciamento!.entrouEmQuadraEm;
    const repetida = await pedir<{ alterado: boolean; participacao: { entrouEmQuadraEm: string } }>(context.request, `${jogo.base}/credenciamentos/${acesso.usuarios.ana.id}/entrada`, {});
    expect(repetida.alterado).toBe(false);
    expect(repetida.participacao.entrouEmQuadraEm).toBe(entrada);

    await navegacao.getByRole("button", { name: "Jogo", exact: true }).click();
    await page.getByRole("button", { name: /^Gol, camisa 7,/ }).click();
    await page.getByRole("button", { name: /^Desfazer gol da camisa 7,/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /Gol da camisa 7.*anulado/ })).toBeVisible();
    const anulado = await pedir<{ lancamentos: { anuladoEm: string | null }[]; placar: { placarClubeA: number } }>(context.request, `${jogo.base}/lancamentos`);
    expect(anulado.lancamentos).toHaveLength(1);
    expect(anulado.lancamentos[0].anuladoEm).not.toBeNull();
    expect(anulado.placar.placarClubeA).toBe(0);
    await navegacao.getByRole("button", { name: "Opções", exact: true }).click();
    await page.getByRole("button", { name: "Interromper partida", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Interromper", exact: true }).click();
    await navegacao.getByRole("button", { name: "Jogo", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeDisabled();
    await navegacao.getByRole("button", { name: "Opções", exact: true }).click();
    await page.getByRole("button", { name: "Retomar partida", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retomar", exact: true }).click();
    await navegacao.getByRole("button", { name: "Jogo", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeEnabled();
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect.poll(() => page.getByRole("button", { name: /^Gol, camisa 7,/ }).evaluate(elemento => elemento.getBoundingClientRect().width)).toBeLessThanOrEqual(140);
      // Só a superfície operacional com dados fictícios: nenhum formulário, QR, foto ou segredo aberto.
      await page.screenshot({ path: testInfo.outputPath(`arbitragem-${width}.png`), fullPage: true });
    }
  });

  test("ingresso começa na Mesa, vermelho exige relatório explícito e encerramento conserva apenas recibo", async ({ page, context }) => {
    const jogo = await preparar(context);
    await context.clearCookies();
    await page.goto(`${origem}/arbitragem/jogos/${jogo.id}`);
    await expect(page.getByRole("heading", { name: "Entre no jogo" })).toBeVisible();
    await page.getByLabel("Seu nome completo", { exact: true }).fill("Arbitragem de ingresso QA");
    await page.getByLabel("Senha do jogo", { exact: true }).fill(jogo.senha);
    await page.getByRole("button", { name: "Entrar com senha do jogo" }).click();
    await expect(page.getByText("Mesa do jogo", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeEnabled();
    await page.getByRole("button", { name: "Cartão vermelho", exact: true }).click();
    await page.getByRole("button", { name: /^Cartão vermelho, camisa 7,/ }).click();
    const vermelho = page.getByRole("dialog");
    await expect(vermelho.getByRole("button", { name: "Confirmar cartão vermelho" })).toBeDisabled();
    await vermelho.getByLabel("Com relatório", { exact: true }).check();
    await vermelho.getByRole("button", { name: "Confirmar vermelho + relatório" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Cartão vermelho: camisa 7/ })).toBeVisible();
    const registros = await pedir<{ lancamentos: { tipo: string; relatorioDisciplinar: boolean }[] }>(context.request, `${jogo.base}/lancamentos`);
    expect(registros.lancamentos).toHaveLength(1);
    expect(registros.lancamentos[0]).toMatchObject({ tipo: "cartaoVermelho", relatorioDisciplinar: true });
    await page.getByRole("navigation", { name: "Áreas da arbitragem" }).getByRole("button", { name: "Opções", exact: true }).click();
    await page.getByRole("button", { name: "Encerrar jogo", exact: true }).click();
    const encerrar = page.getByRole("dialog");
    await encerrar.getByRole("button", { name: "Revisar resultado" }).click();
    await encerrar.getByRole("button", { name: "Encerrar definitivamente" }).click();
    await expect(page.getByRole("heading", { name: "Jogo encerrado", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Gol, camisa/ })).toHaveCount(0);
    expect([401, 403]).toContain((await context.request.get(`${apiBase}${jogo.base}/sessao`, { headers: { Origin: origem } })).status());
    await expect(page.getByRole("heading", { name: "Jogo encerrado", exact: true })).toBeVisible();
  });

  test("dois dispositivos releem, reconectam e não restauram dados com GET atrasado após revogação", async ({ browser }) => {
    const mesa = await browser.newContext();
    const linha = await browser.newContext();
    try {
      const jogo = await preparar(mesa);
      await pedir(linha.request, `${jogo.base}/entrada/senha`, { nomeCompleto: "Linha de QA frontend", senha: jogo.senha, visualizacao: "linha" });
      const paginaMesa = await mesa.newPage();
      const paginaLinha = await linha.newPage();
      await Promise.all([abrir(paginaMesa, jogo), abrir(paginaLinha, jogo)]);
      await paginaMesa.getByRole("button", { name: /^Gol, camisa 7,/ }).click();
      await expect(paginaLinha.getByLabel(/^Placar oficial\./)).toContainText("1");
      await linha.setOffline(true);
      await expect(paginaLinha.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeDisabled();
      await paginaMesa.getByRole("button", { name: /^Gol, camisa 7,/ }).click();
      await linha.setOffline(false);
      await expect(paginaLinha.getByRole("button", { name: /^Gol, camisa 7,/ })).toBeEnabled();
      await expect(paginaLinha.getByLabel(/^Placar oficial\./)).toContainText("2");
      let liberar!: () => void;
      const aguardar = new Promise<void>(resolve => { liberar = resolve; });
      let interceptou!: () => void;
      const interceptada = new Promise<void>(resolve => { interceptou = resolve; });
      let adiar = true;
      await paginaLinha.route(`**/api${jogo.base}/sessao`, async route => {
        if (!adiar) { await route.continue(); return; }
        adiar = false;
        const resposta = await route.fetch();
        interceptou();
        await aguardar;
        await route.fulfill({ response: resposta });
      });
      await paginaLinha.getByRole("navigation", { name: "Áreas da arbitragem" }).getByRole("button", { name: "Opções", exact: true }).click();
      await paginaLinha.getByRole("button", { name: "Atualizar dados do jogo" }).click();
      await interceptada;
      await pedir(presidente, `/jogos/${jogo.id}/arbitragem/senha/troca`, {});
      await expect(paginaLinha.getByRole("heading", { name: "Seu acesso terminou" })).toBeVisible();
      liberar();
      await expect(paginaLinha.getByRole("button", { name: /^Gol, camisa 7,/ })).toHaveCount(0);
      await expect(paginaLinha.getByLabel(/^Placar oficial\./)).toHaveCount(0);
      await expect(paginaMesa.getByRole("heading", { name: "Seu acesso terminou" })).toBeVisible();
    } finally { await Promise.all([mesa.close(), linha.close()]); }
  });
});
