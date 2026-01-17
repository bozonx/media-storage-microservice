import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import { FilesService } from '../../src/modules/files/files.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { ImageOptimizerService } from '../../src/modules/optimization/image-optimizer.service.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { FileStatus } from '../../src/modules/files/file-status.js';
import { getLoggerToken } from 'nestjs-pino';
import { OptimizationStatus } from '../../src/modules/files/optimization-status.js';
import { ExifService } from '../../src/modules/files/exif.service.js';

async function drainStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // drain
  }
}

describe('FilesService (unit)', () => {
  let service: FilesService;
  let moduleRef: TestingModule;

  const prismaMock = {
    file: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const storageMock: any = {
    uploadFile: jest.fn(),
    uploadStream: jest.fn(),
    downloadStream: jest.fn(),
    downloadStreamWithRange: jest.fn(),
    deleteFile: jest.fn(),
    copyObject: jest.fn(),
  };

  const exifServiceMock: jest.Mocked<
    Pick<ExifService, 'tryExtractFromBuffer' | 'tryExtractFromStorageKey'>
  > = {
    tryExtractFromBuffer: jest.fn<ExifService['tryExtractFromBuffer']>(),
    tryExtractFromStorageKey: jest.fn<ExifService['tryExtractFromStorageKey']>(),
  };

  const imageOptimizerMock = {
    compressImage: jest.fn(),
  } as unknown as jest.Mocked<Pick<ImageOptimizerService, 'compressImage'>>;

  const configServiceMock: any = {
    get: jest.fn((key: string) => {
      if (key === 'storage.bucket') {
        return 'test-bucket';
      }
      if (key === 'app.basePath') {
        return '';
      }
      if (key === 'BASE_PATH') {
        return undefined;
      }
      if (key === 'compression.forceEnabled') {
        return false;
      }
      if (key === 'heavyTasksQueue.timeoutMs') {
        return 30000;
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    exifServiceMock.tryExtractFromBuffer.mockResolvedValue(undefined);
    exifServiceMock.tryExtractFromStorageKey.mockResolvedValue(undefined);

    (storageMock.uploadFile as any).mockResolvedValue(undefined);
    (storageMock.uploadStream as unknown as jest.Mock).mockImplementation(async (params: any) => {
      if (params?.body && typeof params.body[Symbol.asyncIterator] === 'function') {
        await drainStream(params.body);
      }
    });

    moduleRef = await Test.createTestingModule({
      providers: [
        FilesService,
        {
          provide: getLoggerToken(FilesService.name),
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
        { provide: ImageOptimizerService, useValue: imageOptimizerMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: ExifService, useValue: exifServiceMock },
      ],
    }).compile();

    service = moduleRef.get<FilesService>(FilesService);
  });

  describe('downloadFileStream', () => {
    it('throws Conflict when optimizationStatus FAILED', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        filename: 'a.jpg',
        status: FileStatus.READY,
        optimizationStatus: OptimizationStatus.FAILED,
      });

      await expect(service.downloadFileStream('id')).rejects.toBeInstanceOf(ConflictException);
    });

    it('waits for optimization (PENDING) via ensureOptimized and downloads optimized key', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        filename: 'a.jpg',
        status: FileStatus.READY,
        optimizationStatus: OptimizationStatus.PENDING,
        originalS3Key: 'originals/x',
        originalMimeType: 'image/jpeg',
        s3Key: '',
      });

      (service as any).ensureOptimized = jest.fn() as unknown as jest.Mock;
      (service as any).ensureOptimized.mockResolvedValue({
        id: 'id',
        filename: 'a.jpg',
        status: FileStatus.READY,
        optimizationStatus: OptimizationStatus.READY,
        s3Key: 'aa/bb/optimized.webp',
        mimeType: 'image/webp',
        size: 10n,
        checksum: 'sha256:abc',
      });

      (storageMock.downloadStreamWithRange as any).mockResolvedValue({
        stream: (await import('stream')).Readable.from([Buffer.from('x')]),
        etag: 'etag',
        contentLength: 1,
        isPartial: false,
        contentRange: undefined,
      });

      const res = await service.downloadFileStream('id');

      expect((service as any).ensureOptimized).toHaveBeenCalledWith('id');
      expect(storageMock.downloadStreamWithRange).toHaveBeenCalledWith({
        key: 'aa/bb/optimized.webp',
        range: undefined,
      });
      expect(res.mimeType).toBe('image/webp');
    });
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadFile', () => {
    it('includes base path in url when app.basePath is set', async () => {
      const basePathConfigServiceMock: any = {
        get: jest.fn((key: string) => {
          if (key === 'storage.bucket') {
            return 'test-bucket';
          }
          if (key === 'app.basePath') {
            return 'media';
          }
          if (key === 'BASE_PATH') {
            return undefined;
          }
          if (key === 'compression.forceEnabled') {
            return false;
          }
          if (key === 'IMAGE_OPTIMIZATION_WAIT_TIMEOUT_MS') {
            return '30000';
          }
          return undefined;
        }),
      };

      const moduleWithBasePath = await Test.createTestingModule({
        providers: [
          FilesService,
          {
            provide: getLoggerToken(FilesService.name),
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
          { provide: ImageOptimizerService, useValue: imageOptimizerMock },
          { provide: ConfigService, useValue: basePathConfigServiceMock },
          { provide: ExifService, useValue: exifServiceMock },
        ],
      }).compile();

      const serviceWithBasePath = moduleWithBasePath.get<FilesService>(FilesService);

      const existing = {
        id: 'file-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: FileStatus.READY,
      };

      (prismaMock as any).file.findFirst.mockResolvedValue(existing);

      const res = await serviceWithBasePath.uploadFile({
        buffer: Buffer.from('abc'),
        filename: 'a.png',
        mimeType: 'image/png',
      });

      expect(res.url).toBe('/media/api/v1/files/file-id/download');

      await moduleWithBasePath.close();
    });

    it('returns existing file (dedup) without uploading to storage', async () => {
      const existing = {
        id: 'file-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: FileStatus.READY,
      };

      (prismaMock as any).file.findFirst.mockResolvedValue(existing);

      const res = await service.uploadFile({
        buffer: Buffer.from('abc'),
        filename: 'a.png',
        mimeType: 'image/png',
      });

      expect(res).toEqual({
        id: 'file-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 3,
        originalSize: undefined,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        url: '/api/v1/files/file-id/download',
      });

      expect((storageMock.uploadFile as jest.Mock).mock.calls).toHaveLength(0);
      expect((prismaMock as any).file.create).not.toHaveBeenCalled();
    });

    it('creates record, uploads to storage and marks READY', async () => {
      const created = {
        id: 'new-id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: null,
        status: FileStatus.UPLOADING,
      };

      const updated = {
        ...created,
        status: FileStatus.READY,
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
      };

      (prismaMock as any).file.findFirst.mockResolvedValue(null);
      (prismaMock as any).file.create.mockResolvedValue(created);
      (prismaMock as any).file.update.mockResolvedValue(updated);

      const res = await service.uploadFile({
        buffer: Buffer.from('abc'),
        filename: 'a.txt',
        mimeType: 'text/plain',
      });

      expect(storageMock.uploadFile).toHaveBeenCalledTimes(1);
      expect((prismaMock as any).file.update).toHaveBeenCalledWith({
        where: { id: 'new-id' },
        data: {
          status: FileStatus.READY,
          statusChangedAt: expect.any(Date),
          uploadedAt: expect.any(Date),
        },
      });

      expect(res.id).toBe('new-id');
      expect(res.url).toBe('/api/v1/files/new-id/download');
    });

    it('marks FAILED when storage upload throws', async () => {
      const created = {
        id: 'new-id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: null,
        status: FileStatus.UPLOADING,
      };

      (prismaMock as any).file.findFirst.mockResolvedValue(null);
      (prismaMock as any).file.create.mockResolvedValue(created);
      (storageMock.uploadFile as any).mockRejectedValue(new Error('S3 down'));

      await expect(
        service.uploadFile({
          buffer: Buffer.from('abc'),
          filename: 'a.txt',
          mimeType: 'text/plain',
        }),
      ).rejects.toThrow('S3 down');

      expect((prismaMock as any).file.update).toHaveBeenCalledWith({
        where: { id: 'new-id' },
        data: {
          status: FileStatus.FAILED,
          statusChangedAt: expect.any(Date),
        },
      });
    });
  });

  describe('uploadFileStream', () => {
    it('returns existing file (dedup) and deletes temp objects', async () => {
      const existing = {
        id: 'existing-id',
        filename: 'a.bin',
        mimeType: 'application/octet-stream',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: FileStatus.READY,
      };

      const created = {
        id: 'created-id',
        filename: 'a.bin',
        mimeType: 'application/octet-stream',
        size: null,
        originalSize: null,
        checksum: null,
        uploadedAt: null,
        status: FileStatus.UPLOADING,
        s3Key: 'tmp/whatever',
      };

      (prismaMock as any).file.create.mockResolvedValue(created);
      (storageMock.uploadStream as jest.Mock).mockImplementation(async ({ body }: any) => {
        await drainStream(body);
      });
      (prismaMock as any).file.findFirst.mockResolvedValue(existing);

      const stream = (await import('stream')).Readable.from([
        Buffer.from('a'),
        Buffer.from('b'),
        Buffer.from('c'),
      ]);

      const res = await service.uploadFileStream({
        stream,
        filename: 'a.bin',
        mimeType: 'application/octet-stream',
      });

      expect(storageMock.uploadStream).toHaveBeenCalledTimes(1);
      expect(storageMock.deleteFile).toHaveBeenCalledTimes(1);
      expect((prismaMock as any).file.delete).toHaveBeenCalledWith({ where: { id: 'created-id' } });
      expect(res.id).toBe('existing-id');
    });

    it('creates READY record with original* fields when forced optimization enabled for images', async () => {
      (configServiceMock.get as any).mockImplementation((key: string) => {
        if (key === 'storage.bucket') {
          return 'test-bucket';
        }
        if (key === 'app.basePath') {
          return '';
        }
        if (key === 'compression.forceEnabled') {
          return true;
        }
        if (key === 'IMAGE_OPTIMIZATION_WAIT_TIMEOUT_MS') {
          return '30000';
        }
        return undefined;
      });

      await moduleRef.close();
      moduleRef = await Test.createTestingModule({
        providers: [
          FilesService,
          {
            provide: getLoggerToken(FilesService.name),
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
          { provide: ImageOptimizerService, useValue: imageOptimizerMock },
          { provide: ConfigService, useValue: configServiceMock },
          { provide: ExifService, useValue: exifServiceMock },
        ],
      }).compile();
      service = moduleRef.get<FilesService>(FilesService);

      const created = {
        id: 'created-id',
        filename: 'a.jpg',
        status: FileStatus.UPLOADING,
      };
      const updated = {
        id: 'created-id',
        filename: 'a.jpg',
        status: FileStatus.READY,
        originalS3Key: 'originals/abc',
        originalMimeType: 'image/jpeg',
        originalSize: 3n,
        originalChecksum: 'sha256:abc',
        optimizationStatus: OptimizationStatus.PENDING,
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
      };

      (prismaMock as any).file.create.mockResolvedValue(created);
      (prismaMock as any).file.update.mockResolvedValue(updated);

      const stream = (await import('stream')).Readable.from([
        Buffer.from('a'),
        Buffer.from('b'),
        Buffer.from('c'),
      ]);

      const res = await service.uploadFileStream({
        stream,
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
      });

      expect(storageMock.uploadStream).toHaveBeenCalledTimes(1);
      expect((prismaMock as any).file.update).toHaveBeenCalledWith({
        where: { id: 'created-id' },
        data: {
          originalChecksum: expect.stringContaining('sha256:'),
          originalSize: BigInt(3),
          status: FileStatus.READY,
          statusChangedAt: expect.any(Date),
          uploadedAt: expect.any(Date),
        },
      });

      expect(res.id).toBe('created-id');
    });
  });

  describe('deleteFile', () => {
    it('throws NotFound when missing', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue(null);
      await expect(service.deleteFile('id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is idempotent when already soft-deleted', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        s3Key: 'aa/bb',
        status: FileStatus.READY,
        deletedAt: new Date('2020-01-01T00:00:00.000Z'),
      });

      await service.deleteFile('id');

      expect((prismaMock as any).file.update).not.toHaveBeenCalled();
      expect(storageMock.deleteFile).not.toHaveBeenCalled();
    });

    it('marks file with deletedAt (soft delete)', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        s3Key: 'aa/bb',
        status: FileStatus.READY,
        deletedAt: null,
      });

      (prismaMock as any).file.update.mockResolvedValue({});

      await service.deleteFile('id');

      expect((prismaMock as any).file.update).toHaveBeenCalledWith({
        where: { id: 'id' },
        data: {
          deletedAt: expect.any(Date),
        },
      });
      expect(storageMock.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('listFiles', () => {
    it('returns items and pagination', async () => {
      const items = [
        {
          id: 'id1',
          filename: 'a.txt',
          appId: 'app-1',
          userId: 'user-1',
          purpose: 'avatar',
          mimeType: 'text/plain',
          size: 1n,
          originalSize: null,
          checksum: 'sha256:x',
          uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ];

      (prismaMock as any).$transaction.mockResolvedValue([items, 1]);

      const res = await service.listFiles({
        limit: 10,
        offset: 0,
        sortBy: 'uploadedAt',
        order: 'desc',
      });

      expect(res.total).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.id).toBe('id1');
      expect(res.items[0]?.appId).toBe('app-1');
      expect(res.items[0]?.userId).toBe('user-1');
      expect(res.items[0]?.purpose).toBe('avatar');
    });
  });

  describe('bulkDeleteFiles', () => {
    it('requires at least one tag filter', async () => {
      await expect(service.bulkDeleteFiles({} as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('supports dryRun and does not update records', async () => {
      (prismaMock as any).file.findMany.mockResolvedValue([{ id: 'id1' }, { id: 'id2' }]);

      const res = await service.bulkDeleteFiles({
        appId: 'app-1',
        dryRun: true,
        limit: 100,
      } as any);

      expect(res).toEqual({ matched: 2, deleted: 0 });
      expect((prismaMock as any).file.updateMany).not.toHaveBeenCalled();
    });

    it('soft deletes up to limit and returns counters', async () => {
      (prismaMock as any).file.findMany.mockResolvedValue([{ id: 'id1' }, { id: 'id2' }]);
      (prismaMock as any).file.updateMany.mockResolvedValue({ count: 2 });

      const res = await service.bulkDeleteFiles({
        appId: 'app-1',
        userId: 'user-1',
        limit: 10,
      } as any);

      expect((prismaMock as any).file.findMany).toHaveBeenCalledWith({
        where: {
          status: FileStatus.READY,
          deletedAt: null,
          appId: 'app-1',
          userId: 'user-1',
        },
        take: 10,
        select: { id: true },
      });
      expect((prismaMock as any).file.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['id1', 'id2'] }, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(res).toEqual({ matched: 2, deleted: 2 });
    });
  });
});
