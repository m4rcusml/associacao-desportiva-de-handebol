export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new ApiError("Muitas tentativas. Aguarde alguns minutos e tente novamente.", response.status);
    if (path === "/auth/sign-in/email") throw new ApiError("Não foi possível entrar. Confira seu e-mail e senha.", response.status);
    if (response.status === 401) throw new ApiError("Entre com seu e-mail e senha para continuar.", response.status);
    const message = (data as { message?: unknown } | null)?.message;
    throw new ApiError(typeof message === "string" ? message : "Não foi possível concluir. Tente novamente.", response.status);
  }
  if (data === null) throw new ApiError("Resposta inválida do servidor. Tente novamente.", response.status);
  return data as T;
}
