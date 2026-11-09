/** Confere a configuração do bucket pelo endpoint autenticado; um objeto ausente não prova privacidade. */
export async function verificarBucketPrivado(url: string, bucket: string, chave: string, pedir: typeof fetch = fetch) {
  const resposta = await pedir(`${new URL(url).origin}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (resposta.status !== 200) throw new Error(`Consulta autenticada do bucket recusada (${resposta.status})`);
  const dados = await resposta.json() as { id?: unknown; public?: unknown } | null;
  if (dados?.id !== bucket || dados.public !== false) throw new Error("O Storage não confirmou o bucket esperado como privado");
}
