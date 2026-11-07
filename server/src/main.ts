import "reflect-metadata";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { createApp } from "./app.js";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const app = await createApp();
await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
