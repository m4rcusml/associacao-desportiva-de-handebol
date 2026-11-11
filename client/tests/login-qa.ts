import type { APIRequestContext } from '@playwright/test';

/** A fixture só espera após 429 confirmado; falha de rede/escrita incerta nunca é repetida. */
export async function loginQA(cliente: APIRequestContext, api: string, origem: string, credencial: { email: string; password: string }) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const resposta = await cliente.post(`${api}/auth/sign-in/email`, { headers: { Origin: origem }, data: credencial });
    if (resposta.status() !== 429 || tentativa === 1) return resposta;
    await new Promise(resolve => setTimeout(resolve, 10_100));
  }
  throw new Error('Login de QA sem resposta');
}
