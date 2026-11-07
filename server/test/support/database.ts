export function testDatabase(env: NodeJS.ProcessEnv): string {
  if (!env.TEST_DATABASE_URL || !env.DATABASE_URL) {
    throw new Error("Configure DATABASE_URL e TEST_DATABASE_URL com bancos separados");
  }
  let test: URL;
  let development: URL;
  try {
    test = new URL(env.TEST_DATABASE_URL);
    development = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("URLs de banco inválidas");
  }
  const name = decodeURIComponent(test.pathname);
  if (!["postgres:", "postgresql:"].includes(test.protocol) || !/^\/[^/]+_test$/.test(name) || test.search || test.hash) {
    throw new Error("TEST_DATABASE_URL deve apontar para PostgreSQL terminado em _test, sem parâmetros ou fragmento");
  }
  if (name === decodeURIComponent(development.pathname)) {
    throw new Error("Não use o banco de desenvolvimento nos testes");
  }
  return env.TEST_DATABASE_URL;
}
