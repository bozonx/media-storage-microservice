import 'reflect-metadata';

import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { LoggerErrorInterceptor } from 'nestjs-pino';
import { join } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { AppModule } from './app.module.js';
import { ShutdownService } from './common/shutdown/shutdown.service.js';
import type { AppConfig } from './config/app.config.js';

function resolveMaxFileSize(): number {
  const imageMaxMb = parseInt(process.env.IMAGE_MAX_BYTES_MB ?? '25', 10);
  const videoMaxMb = parseInt(process.env.VIDEO_MAX_BYTES_MB ?? '100', 10);
  const audioMaxMb = parseInt(process.env.AUDIO_MAX_BYTES_MB ?? '50', 10);
  const docMaxMb = parseInt(process.env.DOCUMENT_MAX_BYTES_MB ?? '50', 10);

  const maxMb = Math.max(
    Number.isNaN(imageMaxMb) ? 25 : imageMaxMb,
    Number.isNaN(videoMaxMb) ? 100 : videoMaxMb,
    Number.isNaN(audioMaxMb) ? 50 : audioMaxMb,
    Number.isNaN(docMaxMb) ? 50 : docMaxMb,
  );

  return maxMb * 1024 * 1024;
}

async function bootstrap() {
  const maxFileSize = resolveMaxFileSize();

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
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);
  const shutdownService = app.get(ShutdownService);

  const appConfig = configService.get<AppConfig>('app')!;

  const globalPrefix = appConfig.basePath ? `${appConfig.basePath}` : '';
  const basePathPrefix = globalPrefix ? `/${globalPrefix}` : '';
  const uiPrefix = `${basePathPrefix}/ui/`;

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
    prefix: uiPrefix,
  });

  const fastify = app.getHttpAdapter().getInstance();

  fastify.get(`${basePathPrefix}/ui`, async (_request: any, reply: any) => {
    reply.redirect(`${basePathPrefix}/ui/`, 302);
  });

  fastify.get(`${basePathPrefix}/ui/`, async (_request: any, reply: any) => {
    return reply.sendFile('index.html');
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix);
  }

  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (_request: any, reply: any, done: () => void) => {
      if (!shutdownService.isShuttingDown()) {
        done();
        return;
      }

      reply.status(503).send({
        statusCode: 503,
        message: 'Service is shutting down',
      });
    });

  await app.listen(appConfig.port, appConfig.host);

  const apiPath = globalPrefix ? `${globalPrefix}/api/v1` : 'api/v1';
  const uiPath = globalPrefix ? `${globalPrefix}/ui` : 'ui';
  logger.log(
    `🚀 NestJS service is running on: http://${appConfig.host}:${appConfig.port}/${apiPath}`,
    'Bootstrap',
  );
  logger.log(
    `🌐 UI is available at: http://${appConfig.host}:${appConfig.port}/${uiPath}`,
    'Bootstrap',
  );
  logger.log(`📊 Environment: ${appConfig.nodeEnv}`, 'Bootstrap');
  logger.log(`📝 Log level: ${appConfig.logLevel}`, 'Bootstrap');
}

void bootstrap();
