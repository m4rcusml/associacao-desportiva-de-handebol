import "reflect-metadata";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix("api");
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
