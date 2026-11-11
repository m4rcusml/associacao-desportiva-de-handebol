import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const fixture = process.env.HANDEBOL_QA_ACESSO;
const acesso = fixture ? JSON.parse(readFileSync(fixture, 'utf8')) : null;
const api = process.env.HANDEBOL_QA_API ?? 'http://localhost:3001/api';
if (acesso && [api, process.env.HANDEBOL_QA_URL ?? 'http://localhost:3000'].some(url => !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))) throw new Error('A massa local de cadastro não pode ser usada contra hospedagem.');

for (const largura of [320, 390, 1024, 1440]) {
  test(`acesso: composição e teclado em ${largura}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: largura, height: largura < 500 ? 844 : 900 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Entre na associação' })).toBeVisible();
    await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
    await page.getByLabel('E-mail', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Senha', { exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const botoes = page.getByRole('button', { name: 'Entrar', exact: true });
    expect(await botoes.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`acesso-${largura}.png`), fullPage: true });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await page.evaluate(() => [...document.querySelectorAll('main input, main button, main a')].every(el => {
      const rect = el.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth + 1;
    })), 'Controles continuam acessíveis com zoom CSS de 200%').toBe(true);
  });
}

test('cadastro: validação junto ao campo mantém perfil, clube e valores', async ({ page }) => {
  await page.goto('/cadastro');
  await expect(page.getByRole('button', { name: 'Clube inicial' })).toBeEnabled();
  await page.getByRole('button', { name: 'Clube inicial' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo.getByRole('searchbox', { name: 'Buscar por nome ou cidade' })).toBeFocused();
  const primeiro = dialogo.locator('ul button').first();
  await primeiro.click();
  await expect(dialogo).not.toBeVisible();
  const nomeClube = await page.locator('#clubeId').textContent();
  await page.getByLabel('Nome completo', { exact: true }).fill('Nome longo de atleta para verificar o retorno das validações');
  await page.getByLabel('E-mail', { exact: true }).fill('email-invalido');
  await page.getByLabel('Senha', { exact: true }).fill('uma-senha-de-qa');
  await page.getByRole('button', { name: 'Solicitar cadastro' }).click();
  await expect(page.getByLabel('E-mail', { exact: true })).toBeFocused();
  await expect(page.getByText('Informe um e-mail válido, com até 254 caracteres.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atleta', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#clubeId').textContent()).toBe(nomeClube);
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue('Nome longo de atleta para verificar o retorno das validações');
  expect(await page.getByLabel('Senha', { exact: true }).evaluate((el: HTMLInputElement) => el.value.length)).toBe(15);
  await page.getByRole('button', { name: 'Técnico', exact: true }).click();
  await expect(page.locator('#clubeId')).toHaveCount(0);
  await page.getByRole('button', { name: 'Solicitar cadastro' }).click();
  await expect(page.getByRole('button', { name: 'Técnico', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue('Nome longo de atleta para verificar o retorno das validações');
});

test('acesso: erro de rede multilinha preserva campos e não transborda em 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill('qa@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('uma-senha-de-qa');
  await page.route('**/api/auth/sign-in/email', route => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível conectar' })).toBeVisible();
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('qa@example.invalid');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('cadastro real dos dois perfis', () => {
  test.skip(!acesso, 'Defina HANDEBOL_QA_ACESSO para dados fictícios locais; sem fixture este grupo não escreve.');
  for (const perfil of ['atleta', 'tecnico']) {
    test(`${perfil}: solicitação real, login e destino por sessão`, async ({ page, request }) => {
      const email = `qa-ui-${perfil}-${randomUUID()}@example.invalid`;
      await page.goto('/cadastro');
      if (perfil === 'tecnico') await page.getByRole('button', { name: 'Técnico', exact: true }).click();
      await page.getByLabel('Nome completo', { exact: true }).fill(`Pessoa fictícia QA ${perfil}`);
      await page.getByLabel('E-mail', { exact: true }).fill(email);
      await page.getByLabel('Senha', { exact: true }).fill(acesso.password);
      if (perfil === 'atleta') {
        await page.getByRole('button', { name: 'Clube inicial' }).click();
        await page.getByRole('dialog').locator('ul button').first().click();
      }
      await page.getByRole('button', { name: 'Solicitar cadastro' }).click();
      await expect(page.getByRole('heading', { name: 'Cadastro recebido' })).toBeVisible();
      await page.getByRole('link', { name: 'Entrar na conta', exact: true }).click();
      await page.getByLabel('E-mail', { exact: true }).fill(email);
      await page.getByLabel('Senha', { exact: true }).fill(acesso.password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${perfil}$`));
      await expect(page.getByText(/aguardando|pendente/i).first()).toBeVisible();
      if (perfil === 'atleta') {
        const sessao = await (await page.request.get(`${api}/sessao`)).json();
        await page.goto('/atleta/conta');
        await page.locator('summary').filter({ hasText: 'Minha foto' }).click();
        const arquivo = page.getByLabel('Escolher foto', { exact: true });
        await expect(arquivo).toBeEnabled();
        await arquivo.setInputFiles({ name: 'foto-grande.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
        await expect(page.getByRole('alert').filter({ hasText: /4/ })).toBeVisible();
        const png = await page.evaluate(() => {
          const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
          const contexto = canvas.getContext('2d')!; contexto.fillStyle = '#174f42'; contexto.fillRect(0, 0, 2, 2);
          return canvas.toDataURL('image/png').split(',')[1];
        });
        await arquivo.setInputFiles({ name: 'foto-ficticia-qa.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
        await page.getByRole('button', { name: 'Salvar foto', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Foto salva.' })).toBeVisible();
        const foto = await page.request.get(`${api}/atletas/${sessao.usuario.id}/foto`);
        expect(foto.status()).toBe(200);
        expect((await foto.body()).equals(Buffer.from(png, 'base64'))).toBe(true);
        expect((await request.get(`${api}/atletas/${sessao.usuario.id}/foto`)).status()).toBe(401);
      }
    });
  }
});

test('cadastro: resposta perdida orienta login sem afirmar que a conta não existe', async ({ page }) => {
  await page.goto('/cadastro');
  await page.getByRole('button', { name: 'Técnico', exact: true }).click();
  await page.getByLabel('Nome completo', { exact: true }).fill('Cadastro fictício de recuperação');
  await page.getByLabel('E-mail', { exact: true }).fill('recuperacao@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('uma-senha-de-qa');
  await page.route('**/api/cadastros', route => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Solicitar cadastro' }).click();
  await expect(page.getByText('A resposta não foi confirmada.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Técnico', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue('Cadastro fictício de recuperação');
});
