import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { ImageProcessingClient } from '../../src/modules/image-processing/image-processing.client.js';

export async function createTestApp(): Promise<NestFastifyApplication> {
  process.env.S3_ACCESS_KEY_ID ??= 'test';
  process.env.S3_SECRET_ACCESS_KEY ??= 'test';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({
      $queryRaw: async () => 1,
    })
    .overrideProvider(StorageService)
    .useValue({
      checkConnection: async () => true,
    })
    .overrideProvider(ImageProcessingClient)
    .useValue({
      health: async () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        queue: { size: 0, pending: 0 },
      }),
      process: async () => ({
        buffer: Buffer.from('fake'),
        mimeType: 'image/webp',
      }),
      exif: async () => ({ exif: {} }),
    })
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({
      logger: false, // We'll use Pino logger instead
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Ensure defaults the same as in main.ts
  const basePath = (process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');
  const globalPrefix = basePath ? `${basePath}` : '';
  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix);
  }

  await app.init();
  // Ensure Fastify has completed plugin registration and routing before tests
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
