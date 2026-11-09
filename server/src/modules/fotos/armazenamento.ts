import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type TipoImagem = "image/jpeg" | "image/png" | "image/webp";

export const extensoes: Record<TipoImagem, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const tipoPorExtensao = Object.fromEntries(Object.entries(extensoes).map(([tipo, extensao]) => [extensao, tipo])) as Record<string, TipoImagem>;

/** Chaves geradas pelo backend: `atletas/<uuid>/<uuid>.<ext>`. Qualquer outra é recusada (sem travessia de caminho). */
const formatoChave = /^atletas\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function tipoDaChave(chave: string): TipoImagem {
  if (!formatoChave.test(chave)) throw new ErroArmazenamento("Chave de foto inválida");
  return tipoPorExtensao[chave.slice(chave.lastIndexOf(".") + 1)];
}

/** Falha do serviço de arquivos. A mensagem nunca inclui conteúdo, chave completa ou credenciais. */
export class ErroArmazenamento extends Error {}

/**
 * Armazenamento privado das fotos dos atletas (seção 11). O backend é o único cliente: as fotos não têm
 * URL pública nem assinada, e toda leitura passa pela autorização da API.
 */
export abstract class ArmazenamentoFotos {
  /** Envia um objeto novo; nunca sobrescreve uma chave existente. */
  abstract enviar(chave: string, conteudo: Buffer, tipo: TipoImagem): Promise<void>;
  /** Conteúdo do objeto, ou null quando ele não existe. */
  abstract ler(chave: string): Promise<{ conteudo: Buffer; tipo: TipoImagem } | null>;
  /** Remove o objeto; remover objeto inexistente não é erro. */
  abstract remover(chave: string): Promise<void>;
}

/** Sem configuração: as rotas de fotos respondem 503, sem impedir o restante da aplicação. */
export class ArmazenamentoNaoConfigurado extends ArmazenamentoFotos {
  private falhar(): never { throw new ErroArmazenamento("Armazenamento de fotos não configurado"); }
  async enviar(): Promise<void> { this.falhar(); }
  async ler(): Promise<null> { this.falhar(); }
  async remover(): Promise<void> { this.falhar(); }
}

/** Diretório local, somente fora de produção: desenvolvimento e testes de integração. */
export class ArmazenamentoLocal extends ArmazenamentoFotos {
  private readonly raiz: string;
  constructor(diretorio: string) { super(); this.raiz = resolve(diretorio); }

  private caminho(chave: string) { tipoDaChave(chave); return join(this.raiz, ...chave.split("/")); }

  async enviar(chave: string, conteudo: Buffer) {
    const caminho = this.caminho(chave);
    await mkdir(join(caminho, ".."), { recursive: true });
    await writeFile(caminho, conteudo, { flag: "wx" }).catch(() => { throw new ErroArmazenamento("Falha ao gravar a foto"); });
  }

  async ler(chave: string) {
    const caminho = this.caminho(chave);
    try {
      return { conteudo: await readFile(caminho), tipo: tipoDaChave(chave) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new ErroArmazenamento("Falha ao ler a foto");
    }
  }

  async remover(chave: string) {
    await rm(this.caminho(chave), { force: true }).catch(() => { throw new ErroArmazenamento("Falha ao remover a foto"); });
  }
}

/**
 * Supabase Storage pela API REST, com bucket privado e chave secreta somente no backend (ignora RLS).
 * Leitura pelo endpoint autenticado; o endpoint público nunca é usado. Prova hospedada na MAR-76.
 */
export class ArmazenamentoSupabase extends ArmazenamentoFotos {
  private readonly base: string;
  constructor(url: string, private readonly chaveSecreta: string, private readonly bucket: string, private readonly timeoutMs = 15_000) {
    super();
    this.base = `${url.replace(/\/+$/, "")}/storage/v1/object`;
  }

  private async chamar(metodo: "GET" | "POST" | "DELETE", rota: string, chave: string, init: { body?: Buffer; headers?: Record<string, string> } = {}) {
    tipoDaChave(chave);
    try {
      return await fetch(`${this.base}${rota}/${encodeURIComponent(this.bucket)}/${chave}`, {
        method: metodo,
        headers: { apikey: this.chaveSecreta, Authorization: `Bearer ${this.chaveSecreta}`, ...init.headers },
        ...(init.body ? { body: new Uint8Array(init.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ErroArmazenamento("Serviço de fotos indisponível");
    }
  }

  /** O Storage pode responder 400 com `statusCode: "404"` para objeto inexistente. */
  private static async inexistente(resposta: Response) {
    if (resposta.status === 404) return true;
    if (resposta.status !== 400) return false;
    const corpo = await resposta.clone().json().catch(() => null) as { statusCode?: string } | null;
    return corpo?.statusCode === "404";
  }

  async enviar(chave: string, conteudo: Buffer, tipo: TipoImagem) {
    const resposta = await this.chamar("POST", "", chave, { body: conteudo, headers: { "Content-Type": tipo, "x-upsert": "false", "Cache-Control": "no-store" } });
    if (!resposta.ok) throw new ErroArmazenamento(`Envio da foto recusado pelo Storage (${resposta.status})`);
  }

  async ler(chave: string) {
    const resposta = await this.chamar("GET", "/authenticated", chave);
    if (await ArmazenamentoSupabase.inexistente(resposta)) return null;
    if (!resposta.ok) throw new ErroArmazenamento(`Leitura da foto recusada pelo Storage (${resposta.status})`);
    return { conteudo: Buffer.from(await resposta.arrayBuffer()), tipo: tipoDaChave(chave) };
  }

  async remover(chave: string) {
    const resposta = await this.chamar("DELETE", "", chave);
    if (!resposta.ok && !await ArmazenamentoSupabase.inexistente(resposta)) throw new ErroArmazenamento(`Remoção da foto recusada pelo Storage (${resposta.status})`);
  }
}

/**
 * Supabase quando `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_FOTOS_BUCKET` estão definidas; senão,
 * fora de produção, `FOTOS_DIRETORIO`; sem nenhuma, as rotas de fotos respondem 503.
 */
export function criarArmazenamentoFotos(env: NodeJS.ProcessEnv = process.env): ArmazenamentoFotos {
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: chave, SUPABASE_FOTOS_BUCKET: bucket, FOTOS_DIRETORIO: diretorio } = env;
  if (url && chave && bucket) return new ArmazenamentoSupabase(url, chave, bucket);
  if (url || chave || bucket) throw new Error("Configure SUPABASE_URL, SUPABASE_SECRET_KEY e SUPABASE_FOTOS_BUCKET juntas");
  if (diretorio && env.NODE_ENV !== "production") return new ArmazenamentoLocal(diretorio);
  return new ArmazenamentoNaoConfigurado();
}
