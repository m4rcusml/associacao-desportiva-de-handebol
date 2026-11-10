"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ApiError } from "../../lib/api";

/**
 * Trata o erro de uma chamada à API: sessão ausente ou revogada (401) leva ao login; nos demais casos
 * devolve a mensagem para exibir. Use `conflito(erro)` para decidir se a consulta deve ser recarregada (409).
 */
export function useErroApi() {
  const router = useRouter();
  return useCallback((erro: unknown) => {
    if (erro instanceof ApiError && erro.status === 401) router.replace("/login");
    return erro instanceof Error && erro.message ? erro.message : "Não foi possível concluir. Tente novamente.";
  }, [router]);
}

export function status(erro: unknown) {
  return erro instanceof ApiError ? erro.status : 0;
}

/** 409: o estado mudou no servidor; mostre a mensagem e recarregue a consulta afetada. */
export function conflito(erro: unknown) {
  return status(erro) === 409;
}
