export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) throw new Error("Entre com seu e-mail e senha para continuar.");
    if (path === "/auth/sign-in/email") throw new Error("Não foi possível entrar. Confira seu e-mail e senha.");
    throw new Error(typeof data.message === "string" ? data.message : "Não foi possível concluir. Tente novamente.");
  }
  return data as T;
}
