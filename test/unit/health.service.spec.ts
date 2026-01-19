import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';

import { HealthService } from '../../src/modules/health/health.service.js';
import { ImageProcessingClient } from '../../src/modules/image-processing/image-processing.client.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';

describe('HealthService (unit)', () => {
  let service: HealthService;
  let moduleRef: TestingModule;

  const prismaMock = {
    $queryRaw: jest.fn(),
  } as unknown as PrismaService;

  const storageMock = {
    checkConnection: jest.fn(),
  } as unknown as StorageService;

  const imageProcessingClientMock = {
    health: jest.fn(),
  } as unknown as ImageProcessingClient;

  beforeEach(async () => {
    jest.clearAllMocks();

    moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: getLoggerToken(HealthService.name),
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            trace: jest.fn(),
            fatal: jest.fn(),
          },
        },
        { provide: PrismaService, useValue: prismaMock },
        { provide: StorageService, useValue: storageMock },
        { provide: ImageProcessingClient, useValue: imageProcessingClientMock },
      ],
    }).compile();

    service = moduleRef.get<HealthService>(HealthService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('check', () => {
    it('returns ok when all services are healthy', async () => {
      (prismaMock.$queryRaw as jest.Mock<any>).mockResolvedValue(1);
      (storageMock.checkConnection as jest.Mock<any>).mockResolvedValue(true);
      (imageProcessingClientMock.health as jest.Mock<any>).mockResolvedValue({
        status: 'ok',
        queue: { size: 0, pending: 0 },
      });

      const result = await service.check();

      expect(result.status).toBe('ok');
      expect(result.storage.database).toBe('connected');
      expect(result.storage.s3).toBe('connected');
      expect(result.imageProcessing.status).toBe('connected');
    });

    it('returns degraded when database is down', async () => {
      (prismaMock.$queryRaw as jest.Mock<any>).mockRejectedValue(new Error('DB down'));
      (storageMock.checkConnection as jest.Mock<any>).mockResolvedValue(true);
      (imageProcessingClientMock.health as jest.Mock<any>).mockResolvedValue({
        status: 'ok',
        queue: { size: 0, pending: 0 },
      });

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.storage.database).toBe('disconnected');
    });

    it('returns degraded when s3 is down', async () => {
      (prismaMock.$queryRaw as jest.Mock<any>).mockResolvedValue(1);
      (storageMock.checkConnection as jest.Mock<any>).mockResolvedValue(false);
      (imageProcessingClientMock.health as jest.Mock<any>).mockResolvedValue({
        status: 'ok',
        queue: { size: 0, pending: 0 },
      });

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.storage.s3).toBe('disconnected');
    });

    it('returns degraded when image processing is down', async () => {
      (prismaMock.$queryRaw as jest.Mock<any>).mockResolvedValue(1);
      (storageMock.checkConnection as jest.Mock<any>).mockResolvedValue(true);
      (imageProcessingClientMock.health as jest.Mock<any>).mockRejectedValue(new Error('IP down'));

      const result = await service.check();

      expect(result.status).toBe('degraded');
      expect(result.imageProcessing.status).toBe('disconnected');
    });
  });
});
