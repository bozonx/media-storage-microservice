import { Test, type TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import type { PinoLogger } from 'nestjs-pino';
import { getLoggerToken } from 'nestjs-pino';
import { FileStatus as PrismaFileStatus } from '@prisma/client';
import { CleanupService } from '../../src/modules/cleanup/cleanup.service.js';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';

describe('CleanupService (unit)', () => {
  let service: CleanupService;
  let moduleRef: TestingModule;

  const loggerMock: Pick<PinoLogger, 'info' | 'warn' | 'error'> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const prismaMock: any = {
    file: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    thumbnail: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const storageMock: any = {
    deleteFile: jest.fn(),
  };

  const configServiceMock: any = {
    get: jest.fn((key: string) => {
      if (key === 'cleanup') {
        return {
          enabled: true,
          cron: '* * * * *',
          badStatusTtlDays: 30,
          thumbnailsTtlDays: 90,
          batchSize: 200,
        };
      }
      return undefined;
    }),
  };

  const schedulerRegistryMock: any = {
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaMock.$queryRaw.mockReset();
    prismaMock.file.findMany.mockReset();
    prismaMock.file.updateMany.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.thumbnail.findMany.mockReset();
    storageMock.deleteFile.mockReset();

    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.file.findMany.mockResolvedValue([]);
    prismaMock.thumbnail.findMany.mockResolvedValue([]);
    prismaMock.file.updateMany.mockResolvedValue({ count: 0 });
    storageMock.deleteFile.mockResolvedValue(undefined);

    moduleRef = await Test.createTestingModule({
      providers: [
        CleanupService,
        {
          provide: getLoggerToken(CleanupService.name),
          useValue: loggerMock,
        },
        {
          provide: PrismaService,
          useValue: prismaMock as PrismaService,
        },
        {
          provide: StorageService,
          useValue: storageMock as StorageService,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: SchedulerRegistry,
          useValue: schedulerRegistryMock,
        },
      ],
    }).compile();

    service = moduleRef.get(CleanupService);
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  describe('runCleanup', () => {
    it('does nothing when disabled', async () => {
      (service as any).config = {
        ...(service as any).config,
        enabled: false,
      };

      await service.runCleanup();

      expect(loggerMock.info).not.toHaveBeenCalled();
    });
  });

  describe('race-condition claim & transactional delete order', () => {
    it('claims file before deleting and deletes from storage before DB transaction', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      prismaMock.file.findMany.mockResolvedValue([
        {
          id: 'file-1',
          status: PrismaFileStatus.uploading,
          s3Key: 'k1',
          originalS3Key: 'ok1',
        },
      ]);

      prismaMock.file.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });

      prismaMock.thumbnail.findMany.mockResolvedValue([]);

      storageMock.deleteFile.mockResolvedValue(undefined);

      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          thumbnail: {
            deleteMany: jest.fn(async () => ({ count: 0 })),
          },
          file: {
            delete: jest.fn(async () => ({})),
          },
        };

        return fn(tx);
      });

      await service.runCleanup();

      expect(prismaMock.file.updateMany).toHaveBeenCalled();
      expect(storageMock.deleteFile).toHaveBeenCalledWith('k1');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      const storageCallOrder = storageMock.deleteFile.mock.invocationCallOrder[0];
      const txCallOrder = prismaMock.$transaction.mock.invocationCallOrder[0];
      expect(storageCallOrder).toBeLessThan(txCallOrder);
    });

    it('skips deletion when claim fails', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      prismaMock.file.findMany.mockResolvedValue([
        {
          id: 'file-1',
          status: PrismaFileStatus.failed,
          s3Key: 'k1',
          originalS3Key: null,
        },
      ]);

      prismaMock.file.updateMany.mockResolvedValue({ count: 0 });

      await service.runCleanup();

      expect(storageMock.deleteFile).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
