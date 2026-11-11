import type { APIRequestContext } from '@playwright/test';

/** Erros brutos do Playwright podem incluir cookies e corpos no call log. */
export async function transporteQA<T>(etapa: string, executar: () => Promise<T>): Promise<T> {
  try { return await executar(); }
  catch { throw new Error(`Falha de transporte no QA: ${etapa}.`); }
}

/** A fixture só espera após 429 confirmado; falha de rede/escrita incerta nunca é repetida. */
export async function loginQA(cliente: APIRequestContext, api: string, origem: string, credencial: { email: string; password: string }) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const resposta = await transporteQA('POST /auth/sign-in/email', () => cliente.post(`${api}/auth/sign-in/email`, { headers: { Origin: origem }, data: credencial, timeout: 15_000 }));
    if (resposta.status() !== 429 || tentativa === 1) return resposta;
    await new Promise(resolve => setTimeout(resolve, 10_100));
  }
  throw new Error('Login de QA sem resposta');
}
