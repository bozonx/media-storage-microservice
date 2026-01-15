import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/app.config.js';

async function bootstrap() {
  const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '104857600', 10);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: maxFileSize,
    }),
    {
      bufferLogs: true,
    },
  );

  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  const appConfig = configService.get<AppConfig>('app')!;

  await app.register(multipart, {
    limits: {
      fileSize: maxFileSize,
    },
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const publicPath = join(__dirname, '..', '..', 'public');

  await app.register(fastifyStatic, {
    root: publicPath,
    prefix: '/',
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const globalPrefix = appConfig.basePath ? `${appConfig.basePath}` : '';
  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix);
  }

  // Enable graceful shutdown
  app.enableShutdownHooks();

  await app.listen(appConfig.port, appConfig.host);

  const apiPath = globalPrefix ? `${globalPrefix}/api/v1` : 'api/v1';
  logger.log(
    `🚀 NestJS service is running on: http://${appConfig.host}:${appConfig.port}/${apiPath}`,
    'Bootstrap',
  );
  logger.log(`📊 Environment: ${appConfig.nodeEnv}`, 'Bootstrap');
  logger.log(`📝 Log level: ${appConfig.logLevel}`, 'Bootstrap');

  // Rely on enableShutdownHooks for graceful shutdown
}

void bootstrap();
