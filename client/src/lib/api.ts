export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data?: unknown) { super(message); }
}

export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function api<T>(path: string, body?: unknown, method?: ApiMethod): Promise<T> {
  const verbo = method ?? (body === undefined ? "GET" : "POST");
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: verbo,
      credentials: "include",
      cache: "no-store",
      ...(body === undefined || verbo === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.", 0);
  }
  let texto: string;
  try { texto = await response.text(); } catch {
    throw new ApiError("Não foi possível ler a resposta do servidor. Atualize os dados antes de tentar novamente.", 0);
  }
  let data: unknown;
  try { data = texto ? JSON.parse(texto) : undefined; } catch { data = undefined; }
  if (!response.ok) {
    if (response.status === 429) throw new ApiError("Muitas tentativas. Aguarde alguns minutos e tente novamente.", response.status, data);
    if (path === "/auth/sign-in/email") throw new ApiError("Não foi possível entrar. Confira seu e-mail e senha.", response.status, data);
    if (response.status === 401) throw new ApiError("Entre com seu e-mail e senha para continuar.", response.status, data);
    const message = (data as { message?: unknown } | null)?.message;
    throw new ApiError(typeof message === "string" ? message : "Não foi possível concluir. Tente novamente.", response.status, data);
  }
  if (response.status === 204 || (verbo === "DELETE" && texto.length === 0)) return undefined as T;
  if (data === undefined || data === null) throw new ApiError("Resposta inválida do servidor. Tente novamente.", response.status);
  return data as T;
}
