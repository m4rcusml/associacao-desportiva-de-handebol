import "reflect-metadata";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";

/**
 * Procedimento restrito para criar o presidente inicial com credencial.
 * Uso: npm run presidente:inicial -- --nome "Nome Completo" --email pessoa@exemplo.org
 * A senha é lida da entrada padrão (oculta e confirmada no terminal; primeira linha quando redirecionada),
 * nunca de argumentos ou de valores versionados.
 * O script npm carrega `.env` sem sobrescrever variáveis já definidas no ambiente.
 */

async function lerSenha(): Promise<string> {
  if (!process.stdin.isTTY) return (await text(process.stdin)).split(/\r?\n/)[0] ?? "";
  let mudo = false;
  const saida = new Writable({ write(chunk, encoding, callback) { if (!mudo) process.stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: process.stdin, output: saida, terminal: true });
  const perguntar = async (rotulo: string) => {
    process.stdout.write(rotulo);
    mudo = true;
    const resposta = await rl.question("");
    mudo = false;
    process.stdout.write("\n");
    return resposta;
  };
  try {
    const senha = await perguntar("Senha do presidente inicial: ");
    if (senha !== await perguntar("Confirme a senha: ")) throw new Error("As senhas não conferem");
    return senha;
  } finally {
    rl.close();
  }
}

const { values } = parseArgs({ options: { nome: { type: "string" }, email: { type: "string" } }, strict: true });
if (!values.nome || !values.email) {
  console.error('Uso: npm run presidente:inicial -- --nome "Nome Completo" --email pessoa@exemplo.org (senha pela entrada padrão)');
  process.exit(2);
}

const { PrismaService } = await import("../infrastructure/prisma.service.js");
const { criarPresidenteInicial, PresidenteInicialRecusado } = await import("../modules/presidentes/presidentes.js");
const { traduzirErroIdentidade } = await import("../modules/autenticacao/identidade.js");
const prisma = new PrismaService();
try {
  const password = await lerSenha();
  const usuario = await criarPresidenteInicial(prisma, { nomeCompleto: values.nome, email: values.email, password });
  console.log(`Presidente inicial criado: ${usuario.id}. Entre com o e-mail informado.`);
} catch (error) {
  const traduzido = traduzirErroIdentidade(error);
  if (error instanceof PresidenteInicialRecusado || traduzido !== error || (error instanceof Error && error.message === "As senhas não conferem")) {
    console.error(`Presidente inicial não criado: ${(traduzido as Error).message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}
