import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loginQA } from './login-qa';

const fixture = process.env.HANDEBOL_QA_ACESSO;
const acesso: { email: string; password: string } | null = fixture ? JSON.parse(readFileSync(fixture, 'utf8')) : null;
const api = process.env.HANDEBOL_QA_API ?? 'http://localhost:3001/api';
const origem = process.env.HANDEBOL_QA_URL ?? 'http://localhost:3000';

async function chamar<T>(request: APIRequestContext, caminho: string, corpo?: unknown, esperado = 200): Promise<T> {
  const resposta = caminho === '/auth/sign-in/email'
    ? await loginQA(request, api, origem, corpo as { email: string; password: string })
    : await request.fetch(`${api}${caminho}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: { Origin: origem },
    ...(corpo === undefined ? {} : { data: corpo }),
  });
  expect(resposta.status(), `API real: ${caminho}`).toBe(esperado);
  return resposta.json() as Promise<T>;
}

test('presidente: ficha direta, concorrência, releitura e gestão com API real', async ({ page, request }, testInfo) => {
  test.skip(!acesso, 'Defina HANDEBOL_QA_ACESSO com a credencial fictícia de QA para executar a integração real.');
  test.setTimeout(240_000);
  expect(['localhost', '127.0.0.1']).toContain(new URL(api).hostname);
  const tag = randomUUID().slice(0, 8);
  const nomeAtleta = `QA ${tag} Atleta com nome completo extenso para testar identificação e leitura em telas pequenas`;
  const nomeTecnico = `QA ${tag} Técnico`;
  const senhaQA = randomUUID();

  const entrada = await loginQA(page.request, api, origem, acesso!);
  expect(entrada.status()).toBe(200);
  await page.goto('/presidente');
  await expect(page.getByRole('heading', { name: 'Cadastros para aprovar' })).toBeVisible();

  const clube = await chamar<{ id: string; nome: string }>(page.request, '/clubes', { nome: `QA ${tag} Clube de nome extenso para conferência da associação`, cidade: 'Cidade de teste' }, 201);
  const outroClube = await chamar<{ id: string; nome: string }>(page.request, '/clubes', { nome: `QA ${tag} Segundo clube`, cidade: 'Cidade de teste' }, 201);
  const atleta = await chamar<{ usuario: { id: string } }>(request, '/cadastros', { nomeCompleto: nomeAtleta, email: `qa-${tag}-atleta@example.invalid`, password: senhaQA, perfil: 'atleta', clubeId: clube.id }, 201);
  const tecnico = await chamar<{ usuario: { id: string } }>(request, '/cadastros', { nomeCompleto: nomeTecnico, email: `qa-${tag}-tecnico@example.invalid`, password: senhaQA, perfil: 'tecnico' }, 201);

  await page.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
  await page.getByLabel('Buscar solicitação').fill(nomeAtleta);
  await expect(page.getByRole('heading', { name: nomeAtleta, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar e emitir carteirinha' })).toBeVisible();

  for (const largura of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width: largura, height: largura < 500 ? 844 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByRole('button', { name: 'Aprovar e emitir carteirinha' }).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`presidente-cadastros-${largura}.png`), fullPage: true });
  }

  const padraoConsultas = /\/api\/verificacoes\?status=/;
  let retidas = 0;
  let liberadas = 0;
  let liberar!: () => void;
  const aguardar = new Promise<void>(resolve => { liberar = resolve; });
  await page.route(padraoConsultas, async route => {
    const resposta = await route.fetch();
    retidas++;
    await aguardar;
    await route.fulfill({ response: resposta });
    liberadas++;
  });
  await page.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
  await expect.poll(() => retidas).toBe(3);
  const aprovacao = page.waitForResponse(r => r.url().includes(`/verificacoes/${atleta.usuario.id}/aprovacao`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Aprovar e emitir carteirinha' }).click();
  expect((await aprovacao).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: `Cadastro de ${nomeAtleta} aprovado` })).toBeVisible();
  liberar();
  await expect.poll(() => liberadas).toBe(3);
  await page.unroute(padraoConsultas);
  await expect(page.getByRole('button', { name: 'Aprovar e emitir carteirinha' })).toHaveCount(0);

  await page.route(padraoConsultas, route => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'A lista anterior foi mantida' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: `Cadastro de ${nomeAtleta} aprovado` })).toBeVisible();
  await page.unroute(padraoConsultas);

  await page.getByLabel('Buscar solicitação').fill(nomeTecnico);
  await page.getByRole('button', { name: 'Rejeitar cadastro', exact: true }).click();
  const confirmacao = page.getByRole('dialog');
  await expect(confirmacao.getByRole('button', { name: 'Voltar', exact: true })).toBeFocused();
  await confirmacao.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rejeitar cadastro', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Rejeitar cadastro', exact: true }).click();
  await confirmacao.getByRole('button', { name: 'Confirmar rejeição' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Cadastro de ${nomeTecnico} rejeitado` })).toBeVisible();

  await chamar(request, '/auth/sign-in/email', { email: `qa-${tag}-tecnico@example.invalid`, password: senhaQA });
  await chamar(request, '/verificacoes/solicitacao', {});
  await page.getByRole('button', { name: 'Atualizar fila', exact: true }).click();
  await expect(page.getByRole('heading', { name: nomeTecnico, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rejeitar cadastro', exact: true }).click();
  await chamar(page.request, `/verificacoes/${tecnico.usuario.id}/aprovacao`, {});
  const conflito = page.waitForResponse(r => r.url().includes(`/verificacoes/${tecnico.usuario.id}/rejeicao`) && r.request().method() === 'POST');
  await confirmacao.getByRole('button', { name: 'Confirmar rejeição' }).click();
  expect((await conflito).status()).toBe(409);
  await expect(confirmacao).not.toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Confira a situação atual' })).toBeVisible();

  await page.goto('/presidente/pessoas');
  await page.getByLabel('Buscar por nome', { exact: true }).fill(nomeAtleta);
  await page.getByRole('link').filter({ hasText: nomeAtleta }).click();
  await expect(page.getByRole('heading', { name: nomeAtleta, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver carteirinha', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Carteirinha', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar QR', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar à ficha', exact: true }).click();
  await page.getByRole('button', { name: 'Acesso da conta' }).click();
  await expect(page.getByRole('button', { name: 'Desativar conta', exact: true })).toBeVisible();

  await page.goto(`/presidente/clubes/${clube.id}`);
  await expect(page.getByRole('heading', { name: clube.nome, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Gerir técnico', exact: true }).click();
  await page.getByLabel('Atribuir técnico', { exact: true }).selectOption(tecnico.usuario.id);
  await page.getByRole('button', { name: 'Atribuir técnico', exact: true }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Atribuir técnico', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `${nomeTecnico} é o técnico do clube.` })).toBeVisible();

  await page.goto('/presidente/campeonatos');
  await page.getByRole('button', { name: 'Novo campeonato', exact: true }).click();
  const formulario = page.getByRole('dialog');
  const nomeCampeonato = `QA ${tag} Campeonato`;
  await formulario.getByLabel('Nome', { exact: true }).fill(nomeCampeonato);
  await formulario.getByLabel('Edição', { exact: true }).fill('QA 2026');
  await formulario.getByLabel('Categoria', { exact: true }).fill('Livre QA');
  await formulario.getByRole('button', { name: 'Criar campeonato', exact: true }).click();
  await expect(page.getByRole('heading', { name: nomeCampeonato, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clubes inscritos', exact: true }).click();
  for (const inscrito of [clube, outroClube]) {
    await page.getByRole('button', { name: 'Inscrever clube', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Clube', { exact: true }).selectOption(inscrito.id);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar inscrição', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Agendar jogo', exact: true }).first().click();
  const agendamento = page.getByRole('dialog');
  await agendamento.getByLabel('Clube A', { exact: true }).selectOption(clube.id);
  await agendamento.getByLabel('Clube B', { exact: true }).selectOption(outroClube.id);
  const instante = new Date(Date.now() + 30 * 60_000);
  const dataLocal = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instante).replace(' ', 'T');
  await agendamento.getByLabel('Data e hora local', { exact: true }).fill(dataLocal);
  await agendamento.getByLabel('Local (opcional)', { exact: true }).fill(`Ginásio QA ${tag} com endereço extenso para verificar o fluxo vertical`);
  await agendamento.getByRole('button', { name: 'Agendar jogo', exact: true }).click();
  await expect(agendamento).not.toBeVisible();
  await page.getByRole('button', { name: 'Jogos', exact: true }).click();
  await page.getByRole('link').filter({ hasText: clube.nome }).filter({ hasText: outroClube.nome }).click();
  await expect(page.getByRole('heading', { name: 'Preparar jogo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Arbitragem e agenda', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mostrar senha', exact: true })).toBeVisible();
  for (const largura of [320, 1024, 1440]) {
    await page.setViewportSize({ width: largura, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`presidente-jogo-${largura}.png`), fullPage: true });
  }
  await page.goto('/presidente/conta');
  await expect(page.getByRole('button', { name: 'Criar outro presidente' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerir outros presidentes' })).toBeVisible();
});
