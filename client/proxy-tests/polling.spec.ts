import { expect, test } from '@playwright/test';

const origem = 'http://localhost:3000';
const polling = '/api/socket.io/?EIO=4&transport=polling';

test('polling real do navegador pelo mesmo domínio chega ao Engine.IO sem Origin nativo', async ({ page }) => {
  await page.goto('/login');
  const resposta = page.waitForResponse(response => response.url().includes('/api/socket.io/'));
  const dados = await page.evaluate(async caminho => {
    const response = await fetch(caminho, { credentials: 'include' });
    return { status: response.status, corpo: await response.text() };
  }, polling);
  const headers = await (await resposta).request().allHeaders();
  expect(headers.origin).toBeUndefined();
  expect(headers['sec-fetch-site']).toBe('same-origin');
  expect(new URL(headers.referer).origin).toBe(origem);
  expect(dados.status).toBe(200);
  expect(dados.corpo.startsWith('0{')).toBe(true);
});

test('origem explícita estranha e GET sem prova de mesma origem continuam recusados', async ({ request }) => {
  const casos: Record<string, string>[] = [
    {},
    { 'sec-fetch-site': 'same-origin' },
    { referer: `${origem}/login` },
    { 'sec-fetch-site': 'cross-site', referer: `${origem}/login` },
    { 'sec-fetch-site': 'same-origin', referer: 'http://outro.local/login' },
    { 'sec-fetch-site': 'same-origin', referer: 'invalido' },
    { 'sec-fetch-site': 'same-origin', referer: `${origem}/login`, origin: 'http://outro.local' },
    { 'sec-fetch-site': 'same-origin', referer: `${origem}/login`, origin: 'null' },
    { 'sec-fetch-site': 'same-origin', referer: `${origem}/login`, origin: '' },
  ];
  for (const headers of casos) {
    const response = await request.get(polling, { headers });
    expect(response.status()).toBe(403);
  }
});

test('normalizar polling não autoriza escritas sem Origin nem sessão de jogo ausente', async ({ page, request }) => {
  const escrita = await request.post('/api/protegida', { headers: { 'sec-fetch-site': 'same-origin', referer: `${origem}/login` }, data: {} });
  expect(escrita.status()).toBe(403);
  await page.goto('/login');
  const resposta = await page.evaluate(async caminho => {
    const inicial = await fetch(caminho, { credentials: 'include' });
    if (!inicial.ok) return { inicio: inicial.status, pacote: '' };
    const { sid } = JSON.parse((await inicial.text()).slice(1));
    const destino = `${caminho}&sid=${encodeURIComponent(sid)}`;
    await fetch(destino, { method: 'POST', credentials: 'include', body: '40{"jogoId":"00000000-0000-4000-8000-000000000001"}' });
    const poll = await fetch(destino, { credentials: 'include' });
    const pacote = await poll.text();
    await fetch(destino, { method: 'POST', credentials: 'include', body: '1' });
    return { inicio: inicial.status, pacote };
  }, polling);
  expect(resposta.inicio).toBe(200);
  expect(resposta.pacote).toContain('44');
  expect(resposta.pacote).toContain('acesso_indisponivel');
});
