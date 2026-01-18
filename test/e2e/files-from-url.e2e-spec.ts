import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { AppModule } from '../../src/app.module.js';
import { FilesService } from '../../src/modules/files/files.service.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';

describe('Files from url (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let baseUrl: string;

  const filesServiceMock: any = {
    uploadFileStream: async (params: any) => ({
      id: 'id',
      filename: params.filename,
      mimeType: params.mimeType,
      size: 3,
      checksum: 'sha256:x',
      uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
      statusChangedAt: new Date('2020-01-01T00:00:00.000Z'),
      url: '/api/v1/files/id/download',
    }),
  };

  beforeEach(async () => {
    process.env.URL_UPLOAD_BLOCK_UNSAFE_CONNECTIONS = 'false';
    process.env.URL_UPLOAD_TIMEOUT_MS = '5000';
    process.env.URL_UPLOAD_MAX_BYTES_MB = '5';

    server = createServer((req, res) => {
      res.statusCode = 200;
      if (req.url?.endsWith('.jpg')) {
        res.setHeader('Content-Type', 'image/jpeg');
      } else {
        res.setHeader('Content-Type', 'text/plain');
      }
      res.end('abc');
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

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
      .useValue(filesServiceMock)
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
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('POST /api/v1/files/from-url streams remote content when optimize is not provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/from-url',
      payload: {
        url: `${baseUrl}/file.txt`,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({
      id: 'id',
      filename: 'file.txt',
      mimeType: 'text/plain',
      size: 3,
      checksum: 'sha256:x',
      uploadedAt: '2020-01-01T00:00:00.000Z',
      statusChangedAt: '2020-01-01T00:00:00.000Z',
      url: '/api/v1/files/id/download',
    });
  });

  it('POST /api/v1/files/from-url streams remote content when optimize is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/from-url',
      payload: {
        url: `${baseUrl}/x.jpg`,
        optimize: {
          format: 'webp',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({
      id: 'id',
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
      size: 3,
      checksum: 'sha256:x',
      uploadedAt: '2020-01-01T00:00:00.000Z',
      statusChangedAt: '2020-01-01T00:00:00.000Z',
      url: '/api/v1/files/id/download',
    });
  });
});
