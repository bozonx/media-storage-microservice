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
    listObjects: jest.fn(),
  };

  const configServiceMock: any = {
    get: jest.fn((key: string) => {
      if (key === 'cleanup') {
        return {
          enabled: true,
          cron: '* * * * *',
          badStatusTtlDays: 7,
          softDeletedRetryDelayMinutes: 30,
          softDeletedStuckWarnDays: 3,
          thumbnailsTtlDays: 90,
          batchSize: 200,
          tmpTtlDays: 2,
          originalsTtlDays: 14,
          s3ListPageSize: 1000,
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
    storageMock.listObjects.mockResolvedValue({ items: [], nextContinuationToken: undefined });

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

    it('skips run when already running', async () => {
      (service as any).isRunning = true;

      await service.runCleanup();

      expect(loggerMock.warn).toHaveBeenCalled();
      expect(storageMock.listObjects).not.toHaveBeenCalled();
    });
  });

  describe('temporary objects cleanup (tmp/ and originals/)', () => {
    it('deletes only objects older than cutoff', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 3 * 24 * 60 * 60 * 1000);
      const veryOldDate = new Date(now - 20 * 24 * 60 * 60 * 1000);
      const freshDate = new Date(now - 1 * 60 * 60 * 1000);

      storageMock.listObjects
        .mockResolvedValueOnce({
          items: [
            { key: 'tmp/old', lastModified: oldDate },
            { key: 'tmp/fresh', lastModified: freshDate },
          ],
          nextContinuationToken: undefined,
        })
        .mockResolvedValueOnce({
          items: [
            { key: 'originals/old', lastModified: veryOldDate },
            { key: 'originals/fresh', lastModified: freshDate },
          ],
          nextContinuationToken: undefined,
        });

      storageMock.deleteFiles.mockResolvedValue({
        deletedKeys: new Set(['tmp/old', 'originals/old']),
        errors: [],
      });

      await service.runCleanup();

      expect(storageMock.listObjects).toHaveBeenCalledWith({
        prefix: 'tmp/',
        continuationToken: undefined,
        maxKeys: 1000,
      });
      expect(storageMock.listObjects).toHaveBeenCalledWith({
        prefix: 'originals/',
        continuationToken: undefined,
        maxKeys: 1000,
      });

      const deleteArgs = (storageMock.deleteFiles as jest.Mock).mock.calls.map(call => call[0]);
      expect(deleteArgs).toContainEqual(['tmp/old']);
      expect(deleteArgs).toContainEqual(['originals/old']);
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
          deletedAt: new Date('2020-01-01T00:00:00.000Z'),
          status: PrismaFileStatus.ready,
          statusChangedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ]);

      prismaMock.file.count.mockResolvedValue(0);
      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 1 });
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

    it('does not claim a deleting soft-deleted file before retry cutoff', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: 'file-1',
          s3Key: 'aa/bb/hash.jpg',
          originalS3Key: null,
          checksum: 'sha256:abc',
          mimeType: 'image/jpeg',
          deletedAt: new Date('2020-01-01T00:00:00.000Z'),
          status: PrismaFileStatus.deleting,
          statusChangedAt: new Date(),
        },
      ]);

      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.runCleanup();

      expect(storageMock.deleteFiles).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('skips deletion when claim fails for soft-deleted file', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: 'file-1',
          s3Key: 'aa/bb/hash.jpg',
          originalS3Key: null,
          checksum: 'sha256:abc',
          mimeType: 'image/jpeg',
          deletedAt: new Date('2020-01-01T00:00:00.000Z'),
          status: PrismaFileStatus.ready,
          statusChangedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ]);

      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.runCleanup();

      expect(storageMock.deleteFiles).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('skips blob deletion when other files still reference it', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: 'file-1',
          s3Key: 'aa/bb/hash.jpg',
          originalS3Key: null,
          checksum: 'sha256:abc',
          mimeType: 'image/jpeg',
          deletedAt: new Date('2020-01-01T00:00:00.000Z'),
          status: PrismaFileStatus.ready,
          statusChangedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ]);

      prismaMock.file.count.mockResolvedValue(2);
      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 1 });
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
          deletedAt: new Date('2020-01-01T00:00:00.000Z'),
          status: PrismaFileStatus.ready,
          statusChangedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ]);

      prismaMock.file.count.mockResolvedValue(1);
      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 1 });
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

    it('deleting status uses full delete (includes originals and thumbnails)', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      prismaMock.file.findMany.mockResolvedValue([
        {
          id: 'file-1',
          status: PrismaFileStatus.deleting,
          s3Key: 'k1',
          originalS3Key: 'ok1',
        },
      ]);

      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.thumbnail.findMany.mockResolvedValue([{ id: 't1', s3Key: 'th/t1' }]);

      storageMock.deleteFiles.mockResolvedValue({
        deletedKeys: new Set(['k1', 'ok1', 'th/t1']),
        errors: [],
      });

      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          thumbnail: { deleteMany: jest.fn(async () => ({ count: 1 })) },
          file: { delete: jest.fn(async () => ({})) },
        };
        return fn(tx);
      });

      await service.runCleanup();

      expect(storageMock.deleteFiles).toHaveBeenCalledWith(['th/t1', 'k1', 'ok1']);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });
  });

  describe('cleanupCorruptedRecords', () => {
    it('treats NULL s3Key/mimeType as corrupted', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'file-1',
          s3Key: null,
          originalS3Key: null,
        },
      ]);

      prismaMock.file.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.thumbnail.findMany.mockResolvedValue([]);
      storageMock.deleteFiles.mockResolvedValue({
        deletedKeys: new Set<string>(),
        errors: [],
      });

      await service.runCleanup();

      expect(prismaMock.file.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'file-1',
          status: {
            in: [PrismaFileStatus.ready, PrismaFileStatus.deleting],
          },
        },
        data: {
          status: PrismaFileStatus.deleting,
          deletedAt: expect.any(Date),
          statusChangedAt: expect.any(Date),
        },
      });
    });
  });
});
