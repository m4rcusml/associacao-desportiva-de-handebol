import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Executa os helpers TypeScript reais usando o compilador já instalado, sem runner adicional.
const memoria = new Map();
const storage = { getItem: chave => memoria.get(chave) ?? null, setItem: (chave, valor) => memoria.set(chave, valor) };
function carregar(arquivo, dependencias = {}) {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, "../../lib", arquivo), "utf8");
  const codigo = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const contexto = { exports: {}, require: nome => { assert.ok(nome in dependencias, `Import inesperado: ${nome}`); return dependencias[nome]; }, URL, Intl, localStorage: storage };
  vm.runInNewContext(codigo, contexto);
  return contexto.exports;
}
const area = carregar("area-pessoal.ts");
const tecnico = carregar("tecnico.ts", { "./area-pessoal": area });
const destino = carregar("destino-perfil.ts", { "./area-pessoal": area });
const id = "d08d7c7c-2133-4292-90e8-e66e83ac80db";
const origem = "http://localhost:3000";
for (const perfil of ["atleta", "tecnico"]) {
  assert.equal(destino.destinoDoPerfil(perfil, `/arbitragem/jogos/${id}`), `/arbitragem/jogos/${id}`);
  for (const retorno of ["/arbitragem/jogos/errado", `/arbitragem/jogos/${id}?senha=segredo`, `//outro.test/arbitragem/jogos/${id}`, `/arbitragem/jogos/${id}/../../login`, `/presidente`, "javascript:alert(1)"]) assert.equal(destino.destinoDoPerfil(perfil, retorno), `/${perfil}`);
}
assert.equal(destino.destinoDoPerfil("presidente", `/arbitragem/jogos/${id}`), "/presidente");
assert.equal(area.uuidValido(id), true);
assert.equal(area.uuidValido(id.toUpperCase()), true);
for (const invalido of ["", "qualquer", `${id}/x`, ` ${id}`, "00000000-0000-0000-0000-000000000000"]) assert.equal(area.uuidValido(invalido), false);
for (const entrada of [id, ` ${id.toUpperCase()} `, `/tecnico/jogos/${id}`, `${origem}/tecnico/jogos/${id}/?adversario=inventado#x`]) assert.equal(tecnico.identificarJogo(entrada, origem), id);
for (const entrada of [`https://outro.test/tecnico/jogos/${id}`, `//outro.test/tecnico/jogos/${id}`, `javascript:alert(1)`, `/presidente/jogos/${id}`, `/tecnico/jogos/${id}/editar`, `${origem}/tecnico/jogos/errado`]) assert.equal(tecnico.identificarJogo(entrada, origem), null);
assert.ok(area.horarioJogo("2026-11-11T22:30:00Z", "America/Manaus").includes("18:30"));
assert.equal(area.horarioJogo(null, "America/Manaus"), "Horário não informado");
assert.equal(area.secaoPessoal("atleta", "/atleta/conta"), "/atleta/conta");
for (const caminho of ["/atleta/clubes", `/atleta/clubes/${id}`]) assert.equal(area.secaoPessoal("atleta", caminho), "/atleta/clubes");
assert.equal(area.secaoPessoal("atleta", "/atleta/historico"), "/atleta/historico");
assert.equal(area.secaoPessoal("atleta", "/atleta"), "/atleta");
for (const caminho of ["/tecnico/clube", `/tecnico/atletas/${id}`]) assert.equal(area.secaoPessoal("tecnico", caminho), "/tecnico/clube");
for (const caminho of ["/tecnico/conta", "/tecnico/clubes", `/tecnico/clubes/${id}`]) assert.equal(area.secaoPessoal("tecnico", caminho), "/tecnico/conta");
assert.equal(area.secaoPessoal("tecnico", `/tecnico/jogos/${id}`), "/tecnico");
const referencia = { id, rotulo: "Copa, 11/11 18:30", status: "finalizado", tokenQr: "nao-persistir" };
tecnico.salvarAtalhos("usuario1", "clube1", [referencia, referencia, { id: "invalido", rotulo: "Erro" }]);
assert.equal(tecnico.lerAtalhos("usuario1", "clube1").length, 1);
assert.equal(tecnico.lerAtalhos("usuario1", "clube2").length, 0);
assert.equal(tecnico.lerAtalhos("usuario2", "clube1").length, 0);
assert.deepEqual(Object.keys(tecnico.lerAtalhos("usuario1", "clube1")[0]), ["id", "rotulo"]);
assert.ok([...memoria.keys()][0].includes(":v1:"));
const muitos = Array.from({ length: 14 }, (_, i) => ({ id: `d08d7c7c-2133-4292-90e8-${String(i).padStart(12, "0")}`, rotulo: `Jogo ${i}` }));
assert.equal(tecnico.normalizarAtalhos(muitos).length, 8);
assert.equal(tecnico.normalizarAtalhos(null).length, 0);
assert.equal(tecnico.normalizarAtalhos([{ id, rotulo: "x".repeat(300) }])[0].rotulo.length, 200);
for (const chave of memoria.keys()) memoria.set(chave, "{quebrado");
assert.equal(tecnico.lerAtalhos("usuario1", "clube1").length, 0);
storage.getItem = () => { throw new Error("Storage bloqueado"); };
storage.setItem = () => { throw new Error("Quota excedida"); };
assert.equal(tecnico.lerAtalhos("usuario1", "clube1").length, 0);
assert.doesNotThrow(() => tecnico.salvarAtalhos("usuario1", "clube1", [referencia]));
console.log("Contratos locais: UUID, links, fuso, isolamento, limite e falhas de armazenamento aprovados.");
