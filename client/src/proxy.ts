import { NextResponse, type NextRequest } from "next/server";

/**
 * Encaminhamento público de `/api` (REST e Socket.IO por long-polling) ao backend no Render (MAR-76).
 *
 * Mantém API e cookies no domínio do client. Acrescenta o segredo compartilhado com o backend e o IP do
 * cliente lido pela Vercel, que sobrescreve `x-real-ip`/`x-forwarded-for` recebidos do navegador; o backend
 * recusa requisições sem o segredo. Sem `API_ORIGEM` e `PROXY_SEGREDO` (desenvolvimento local), não atua:
 * o client chama a API diretamente por `NEXT_PUBLIC_API_URL`.
 */
export function proxy(request: NextRequest) {
  const origem = process.env.API_ORIGEM;
  const segredo = process.env.PROXY_SEGREDO;
  if (!origem || !segredo) return NextResponse.next();
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const headers = new Headers(request.headers);
  headers.set("x-proxy-segredo", segredo);
  headers.set("x-cliente-ip", ip);
  const destino = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, origem);
  return NextResponse.rewrite(destino, { request: { headers } });
}

export const config = { matcher: "/api/:path*" };
