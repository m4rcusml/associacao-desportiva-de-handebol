import type { PerfilUsuario } from "./presidente";
import { uuidValido } from "./area-pessoal";

/** Login retorna à própria área ou à arbitragem por designação, sem URLs externas ou segmentos relativos. */
export function destinoDoPerfil(perfil: PerfilUsuario, retorno?: string | null): string {
  const area = `/${perfil}`;
  const jogoArbitragem = /^\/arbitragem\/jogos\/([^/]+)$/.exec(retorno ?? "");
  if (perfil !== "presidente" && jogoArbitragem && uuidValido(jogoArbitragem[1])) return retorno!;
  if (retorno && (retorno === area || retorno.startsWith(`${area}/`))
    && /^\/[a-z0-9/-]+$/i.test(retorno) && !retorno.includes("//")) return retorno;
  return area;
}
