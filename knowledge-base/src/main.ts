import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';

import { AppModule } from './app.module.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const staticRoot = path.resolve(__dirname, 'frontend');
  app.useStaticAssets(staticRoot);
  app.setBaseViewsDir(staticRoot);

  const port = Number(process.env.KB_API_PORT || process.env.PORT || 3000);
  const host = process.env.KB_API_HOST || '127.0.0.1';
  await app.listen(port, host);
}

void bootstrap();
