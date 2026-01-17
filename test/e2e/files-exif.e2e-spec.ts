import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { FilesService } from '../../src/modules/files/files.service.js';

describe('Files EXIF (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
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
      .overrideProvider(FilesService)
      .useValue({
        getFileExif: async () => ({ Make: 'Canon' }),
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        logger: false,
      }),
    );

    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    const basePath = (process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');
    const globalPrefix = basePath ? `${basePath}` : '';
    if (globalPrefix) {
      app.setGlobalPrefix(globalPrefix);
    }

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api/v1/files/:id/exif returns exif', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/files/id/exif',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      exif: {
        Make: 'Canon',
      },
    });
  });
});
