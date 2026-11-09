import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";

/** Sem caracteres confundíveis (0/O, 1/I/L): a senha é ditada ou copiada à mão entre a arbitragem. */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TAMANHO = 10; // ~49 bits; tentativas são limitadas por IP na rota de entrada.

/** Senha compartilhada gerada automaticamente (RN-028), em blocos de cinco: "ABCDE-FGH23". */
export function gerarSenha(): string {
  const caracteres = Array.from({ length: TAMANHO }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");
  return `${caracteres.slice(0, 5)}-${caracteres.slice(5)}`;
}

/** Ignora maiúsculas/minúsculas, espaços e hífens digitados; a senha só usa letras e dígitos. */
export function normalizarSenha(senha: string): string {
  return senha.replace(/[\s-]/g, "").toUpperCase();
}

export const hashSenha = (senha: string) => hashPassword(normalizarSenha(senha));
export const conferirSenha = (hash: string, senha: string) => verifyPassword({ hash, password: normalizarSenha(senha) });

/** Token opaco da sessão temporária; somente o SHA-256 é persistido. */
export function novoToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Cópia consultável da senha (PEN-021): AES-256-GCM com a chave `ARBITRAGEM_SENHA_CHAVE`, mantida fora do
 * banco e do repositório. O jogo entra como dado autenticado, de modo que a cópia de um jogo não decifra
 * como senha de outro. Formato: `v1.<iv>.<tag>.<cifra>` em base64url.
 */
@Injectable()
export class CofreSenhaArbitragem {
  private readonly chave: Buffer;

  constructor() {
    const valor = process.env.ARBITRAGEM_SENHA_CHAVE ?? "";
    const chave = /^[0-9a-f]{64}$/i.test(valor) ? Buffer.from(valor, "hex") : null;
    if (!chave) throw new Error("Configure ARBITRAGEM_SENHA_CHAVE com 32 bytes em hexadecimal (64 caracteres)");
    this.chave = chave;
  }

  cifrar(jogoId: string, senha: string): string {
    const iv = randomBytes(12);
    const cifra = createCipheriv("aes-256-gcm", this.chave, iv);
    cifra.setAAD(Buffer.from(jogoId));
    const dados = Buffer.concat([cifra.update(senha, "utf8"), cifra.final()]);
    return ["v1", iv, cifra.getAuthTag(), dados].map(p => typeof p === "string" ? p : p.toString("base64url")).join(".");
  }

  /** Falha (exceção) se a cópia foi alterada, pertence a outro jogo ou foi cifrada com outra chave. */
  decifrar(jogoId: string, cifrada: string): string {
    const [versao, iv, tag, dados] = cifrada.split(".");
    if (versao !== "v1" || !iv || !tag || !dados) throw new Error("Cópia cifrada da senha em formato desconhecido");
    const decifra = createDecipheriv("aes-256-gcm", this.chave, Buffer.from(iv, "base64url"));
    decifra.setAAD(Buffer.from(jogoId));
    decifra.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decifra.update(Buffer.from(dados, "base64url")), decifra.final()]).toString("utf8");
  }
}
