import { Test, type TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import type { PinoLogger } from 'nestjs-pino';
import { getLoggerToken } from 'nestjs-pino';
import { FileStatus as PrismaFileStatus } from '../../src/generated/prisma/client.js';
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
      count: jest.fn(),
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
    deleteFiles: jest.fn(),
  };

  const configServiceMock: any = {
    get: jest.fn((key: string) => {
      if (key === 'cleanup') {
        return {
          enabled: true,
          cron: '* * * * *',
          badStatusTtlDays: 7,
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
    prismaMock.file.count.mockReset();
    prismaMock.file.findMany.mockReset();
    prismaMock.file.updateMany.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.thumbnail.findMany.mockReset();
    storageMock.deleteFiles.mockReset();

    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.file.count.mockResolvedValue(0);
    prismaMock.file.findMany.mockResolvedValue([]);
    prismaMock.thumbnail.findMany.mockResolvedValue([]);
    prismaMock.file.updateMany.mockResolvedValue({ count: 0 });
    storageMock.deleteFiles.mockResolvedValue({ deletedKeys: new Set<string>(), errors: [] });

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

  describe('cleanupSoftDeletedFiles', () => {
    it('deletes blob and record when no other files reference the same blob', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: 'file-1',
          s3Key: 'aa/bb/hash.jpg',
          originalS3Key: null,
          checksum: 'sha256:abc',
          mimeType: 'image/jpeg',
        },
      ]);

      prismaMock.file.count.mockResolvedValue(0);
      prismaMock.thumbnail.findMany.mockResolvedValue([]);
      storageMock.deleteFiles.mockResolvedValue({
        deletedKeys: new Set(['aa/bb/hash.jpg']),
        errors: [],
      });

      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          thumbnail: { deleteMany: jest.fn(async () => ({ count: 0 })) },
          file: { delete: jest.fn(async () => ({})) },
        };
        return fn(tx);
      });

      await service.runCleanup();

      expect(prismaMock.file.count).toHaveBeenCalledWith({
        where: {
          checksum: 'sha256:abc',
          mimeType: 'image/jpeg',
          id: { not: 'file-1' },
          deletedAt: null,
        },
      });
      expect(storageMock.deleteFiles).toHaveBeenCalledWith(['aa/bb/hash.jpg']);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it('skips blob deletion when other files still reference it', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: 'file-1',
          s3Key: 'aa/bb/hash.jpg',
          originalS3Key: null,
          checksum: 'sha256:abc',
          mimeType: 'image/jpeg',
        },
      ]);

      prismaMock.file.count.mockResolvedValue(2);
      prismaMock.thumbnail.findMany.mockResolvedValue([]);

      storageMock.deleteFiles.mockResolvedValue({ deletedKeys: new Set<string>(), errors: [] });

      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          thumbnail: { deleteMany: jest.fn(async () => ({ count: 0 })) },
          file: { delete: jest.fn(async () => ({})) },
        };
        return fn(tx);
      });

      await service.runCleanup();

      expect(storageMock.deleteFiles).toHaveBeenCalledWith([]);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it('deletes thumbnails even when blob is shared', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: 'file-1',
          s3Key: 'aa/bb/hash.jpg',
          originalS3Key: null,
          checksum: 'sha256:abc',
          mimeType: 'image/jpeg',
        },
      ]);

      prismaMock.file.count.mockResolvedValue(1);
      prismaMock.thumbnail.findMany.mockResolvedValue([
        { id: 'thumb-1', s3Key: 'thumbnails/thumb1.jpg' },
        { id: 'thumb-2', s3Key: 'thumbnails/thumb2.jpg' },
      ]);

      storageMock.deleteFiles.mockResolvedValue({
        deletedKeys: new Set(['thumbnails/thumb1.jpg', 'thumbnails/thumb2.jpg']),
        errors: [],
      });

      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          thumbnail: { deleteMany: jest.fn(async () => ({ count: 2 })) },
          file: { delete: jest.fn(async () => ({})) },
        };
        return fn(tx);
      });

      await service.runCleanup();

      expect(storageMock.deleteFiles).toHaveBeenCalledWith([
        'thumbnails/thumb1.jpg',
        'thumbnails/thumb2.jpg',
      ]);
      expect(prismaMock.$transaction).toHaveBeenCalled();
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

      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.thumbnail.findMany.mockResolvedValue([]);

      storageMock.deleteFiles.mockResolvedValue({
        deletedKeys: new Set(['k1', 'ok1']),
        errors: [],
      });

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

      expect(prismaMock.file.updateMany).toHaveBeenCalledTimes(1);
      expect(storageMock.deleteFiles).toHaveBeenCalledWith(['k1', 'ok1']);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      const storageCallOrder = storageMock.deleteFiles.mock.invocationCallOrder[0];
      const txCallOrder = prismaMock.$transaction.mock.invocationCallOrder[0];
      expect(storageCallOrder).toBeLessThan(txCallOrder);
    });

    it('does not delete DB records when storage deletion fails', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      prismaMock.file.findMany.mockResolvedValue([
        {
          id: 'file-1',
          status: PrismaFileStatus.uploading,
          s3Key: 'k1',
          originalS3Key: null,
        },
      ]);

      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.thumbnail.findMany.mockResolvedValue([]);

      storageMock.deleteFiles.mockRejectedValueOnce(new Error('S3 outage'));

      await service.runCleanup();

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalled();
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

      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.runCleanup();

      expect(storageMock.deleteFiles).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
