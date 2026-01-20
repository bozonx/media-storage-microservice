import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';

import { FileStatus, OptimizationStatus } from '../../src/generated/prisma/enums.js';
import { ExifService } from '../../src/modules/files/exif.service.js';
import { FileProblemDetector } from '../../src/modules/files/file-problem.detector.js';
import { FilesMapper } from '../../src/modules/files/files.mapper.js';
import { FilesService } from '../../src/modules/files/files.service.js';
import { ImageOptimizerService } from '../../src/modules/optimization/image-optimizer.service.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';

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
    validateAvailability: jest.fn(),
  } as unknown as jest.Mocked<Pick<ImageOptimizerService, 'compressImage' | 'validateAvailability'>>;

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
      if (key === 'imageProcessing.requestTimeoutMs') {
        return 60000;
      }
      if (key === 'upload') {
        return {
          imageMaxBytesMb: 25,
          videoMaxBytesMb: 25, // Using 25 for consistency with old behavior if needed
          audioMaxBytesMb: 25,
          documentMaxBytesMb: 25,
          maxFileSizeMb: 25,
        };
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    exifServiceMock.tryExtractFromBuffer.mockResolvedValue(undefined);
    exifServiceMock.tryExtractFromStorageKey.mockResolvedValue(undefined);
    imageOptimizerMock.validateAvailability.mockResolvedValue(undefined);

    storageMock.uploadFile.mockResolvedValue(undefined);
    (prismaMock as any).file.updateMany.mockResolvedValue({ count: 0 });
    
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'storage.bucket') return 'test-bucket';
      if (key === 'app.basePath') return '';
      if (key === 'BASE_PATH') return undefined;
      if (key === 'compression.forceEnabled') return false;
      if (key === 'imageProcessing.requestTimeoutMs') return 60000;
      if (key === 'upload') {
        return {
          imageMaxBytesMb: 25,
          videoMaxBytesMb: 25,
          audioMaxBytesMb: 25,
          documentMaxBytesMb: 25,
          maxFileSizeMb: 25,
        };
      }
      return undefined;
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
        FilesMapper,
        FileProblemDetector,
      ],
    }).compile();

    service = moduleRef.get<FilesService>(FilesService);
  });

  describe('ensureOptimized', () => {
    it('throws RequestTimeoutException when optimization does not finish in time', async () => {
      const timeoutConfigServiceMock: any = {
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
          if (key === 'imageProcessing.requestTimeoutMs') {
            return 1;
          }
          if (key === 'upload') {
            return {
              imageMaxBytesMb: 25,
              videoMaxBytesMb: 100,
              audioMaxBytesMb: 50,
              documentMaxBytesMb: 50,
              maxFileSizeMb: 100,
            };
          }
          return undefined;
        }),
      };

      await moduleRef.close();
      const moduleRef2 = await Test.createTestingModule({
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
          { provide: ConfigService, useValue: timeoutConfigServiceMock },
          { provide: ExifService, useValue: exifServiceMock },
          FilesMapper,
          FileProblemDetector,
        ],
      }).compile();

      const service2 = moduleRef2.get<FilesService>(FilesService);

      (prismaMock as any).file.updateMany.mockResolvedValue({ count: 0 });
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        status: FileStatus.ready,
        optimizationStatus: OptimizationStatus.processing,
      });

      await expect(service2.ensureOptimized('file-id')).rejects.toThrow(RequestTimeoutException);
    });
  });

  describe('downloadFileStream', () => {
    it('throws Conflict when optimizationStatus FAILED', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        filename: 'a.jpg',
        status: FileStatus.ready,
        optimizationStatus: OptimizationStatus.failed,
      });

      await expect(service.downloadFileStream('id')).rejects.toThrow(/Image optimization failed/);
    });

    it('waits for optimization (PENDING) via ensureOptimized and downloads optimized key', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        filename: 'a.jpg',
        status: FileStatus.ready,
        optimizationStatus: OptimizationStatus.pending,
        originalS3Key: 'originals/x',
        originalMimeType: 'image/jpeg',
        s3Key: '',
      });

      (service as any).ensureOptimized = jest.fn() as unknown as jest.Mock;
      (service as any).ensureOptimized.mockResolvedValue({
        id: 'id',
        filename: 'a.jpg',
        status: FileStatus.ready,
        optimizationStatus: OptimizationStatus.ready,
        s3Key: 'aa/bb/optimized.webp',
        mimeType: 'image/webp',
        size: 10n,
        checksum: 'sha256:abc',
      });

      storageMock.downloadStreamWithRange.mockResolvedValue({
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
          if (key === 'imageProcessing.requestTimeoutMs') {
            return 60000;
          }
          if (key === 'upload') {
            return {
              imageMaxBytesMb: 25,
              videoMaxBytesMb: 100,
              audioMaxBytesMb: 50,
              documentMaxBytesMb: 50,
              maxFileSizeMb: 100,
            };
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
          FilesMapper,
          FileProblemDetector,
        ],
      }).compile();

      const serviceWithBasePath = moduleWithBasePath.get<FilesService>(FilesService);

      const created = {
        id: 'created-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: null,
        originalSize: null,
        checksum: null,
        uploadedAt: null,
        status: FileStatus.uploading,
        s3Key: 'tmp/whatever',
      };

      const existing = {
        id: 'file-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: FileStatus.ready,
      };

      (prismaMock as any).file.create.mockResolvedValue(created);
      (storageMock.uploadStream as unknown as jest.Mock).mockImplementation(async (params: any) => {
        if (params?.body && typeof params.body[Symbol.asyncIterator] === 'function') {
          await drainStream(params.body);
        }
      });

      (prismaMock as any).file.findFirst.mockResolvedValue(existing);
      (prismaMock as any).file.delete.mockResolvedValue(undefined);
      storageMock.deleteFile.mockResolvedValue(undefined);

      const res = await serviceWithBasePath.uploadFile({
        buffer: Buffer.from('abc'),
        filename: 'a.png',
        mimeType: 'image/png',
      });

      expect(res.url).toBe('/media/api/v1/files/file-id/download');

      await moduleWithBasePath.close();
    });

    it('returns existing file (dedup) without uploading to storage', async () => {
      const created = {
        id: 'created-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: null,
        originalSize: null,
        checksum: null,
        uploadedAt: null,
        status: FileStatus.uploading,
        s3Key: 'tmp/whatever',
      };

      const existing = {
        id: 'file-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: FileStatus.ready,
        metadata: { a: 1 },
      };

      (prismaMock as any).file.create.mockResolvedValue(created);
      (prismaMock as any).file.findFirst.mockResolvedValue(existing);
      (prismaMock as any).file.delete.mockResolvedValue(undefined);
      storageMock.deleteFile.mockResolvedValue(undefined);

      const res = await service.uploadFile({
        buffer: Buffer.from('abc'),
        filename: 'a.png',
        mimeType: 'image/png',
      });

      expect(res).toMatchObject({
        id: 'file-id',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 3,
        originalSize: undefined,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: FileStatus.ready,
        metadata: { a: 1 },
        url: '/api/v1/files/file-id/download',
      });

      expect(storageMock.uploadStream).toHaveBeenCalledTimes(1);
      expect(storageMock.deleteFile).toHaveBeenCalledTimes(1);
      expect((prismaMock as any).file.delete).toHaveBeenCalledWith({
        where: { id: 'created-id' },
      });
    });

    it('creates record, uploads to storage and marks READY', async () => {
      const created = {
        id: 'new-id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: null,
        originalSize: null,
        checksum: null,
        uploadedAt: null,
        status: FileStatus.uploading,
        s3Key: 'tmp/whatever',
      };

      const updated = {
        id: 'new-id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 3n,
        originalSize: null,
        checksum: 'sha256:abc',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: FileStatus.ready,
      };

      (prismaMock as any).file.create.mockResolvedValue(created);
      (prismaMock as any).file.findFirst.mockResolvedValue(null);
      storageMock.copyObject.mockResolvedValue(undefined);
      storageMock.deleteFile.mockResolvedValue(undefined);
      (prismaMock as any).file.update.mockResolvedValue(updated);

      const res = await service.uploadFile({
        buffer: Buffer.from('abc'),
        filename: 'a.txt',
        mimeType: 'text/plain',
      });

      expect(storageMock.uploadStream).toHaveBeenCalledTimes(1);
      expect(storageMock.copyObject).toHaveBeenCalledTimes(1);
      expect(storageMock.deleteFile).toHaveBeenCalledTimes(1);
      expect((prismaMock as any).file.update).toHaveBeenCalledWith({
        where: { id: 'new-id' },
        data: expect.objectContaining({
          status: FileStatus.ready,
          statusChangedAt: expect.any(Date),
          uploadedAt: expect.any(Date),
        }),
      });

      expect(res.id).toBe('new-id');
      expect(res.url).toBe('/api/v1/files/new-id/download');
    });

    it('marks FAILED when storage upload throws', async () => {
      const created = {
        id: 'new-id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: null,
        originalSize: null,
        checksum: null,
        uploadedAt: null,
        status: FileStatus.uploading,
        s3Key: 'tmp/whatever',
      };

      (prismaMock as any).file.findFirst.mockResolvedValue(null);
      (prismaMock as any).file.create.mockResolvedValue(created);
      storageMock.uploadStream.mockRejectedValue(new Error('S3 down'));
      storageMock.deleteFile.mockResolvedValue(undefined);

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
          status: FileStatus.failed,
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
        status: FileStatus.ready,
      };

      const created = {
        id: 'created-id',
        filename: 'a.bin',
        mimeType: 'application/octet-stream',
        size: null,
        originalSize: null,
        checksum: null,
        uploadedAt: null,
        status: FileStatus.uploading,
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
      configServiceMock.get.mockImplementation((key: string) => {
        if (key === 'storage.bucket') {
          return 'test-bucket';
        }
        if (key === 'app.basePath') {
          return '';
        }
        if (key === 'compression.forceEnabled') {
          return true;
        }
        if (key === 'imageProcessing.requestTimeoutMs') {
          return 60000;
        }
        if (key === 'upload') {
          return {
            imageMaxBytesMb: 25,
            videoMaxBytesMb: 100,
            audioMaxBytesMb: 50,
            documentMaxBytesMb: 50,
            maxFileSizeMb: 100,
          };
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
          FilesMapper,
          FileProblemDetector,
        ],
      }).compile();
      service = moduleRef.get<FilesService>(FilesService);

      const created = {
        id: 'created-id',
        filename: 'a.jpg',
        status: FileStatus.uploading,
      };
      const updated = {
        id: 'created-id',
        filename: 'a.jpg',
        status: FileStatus.ready,
        originalS3Key: 'originals/abc',
        originalMimeType: 'image/jpeg',
        originalSize: 3n,
        originalChecksum: 'sha256:abc',
        optimizationStatus: OptimizationStatus.pending,
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
          status: FileStatus.ready,
          statusChangedAt: expect.any(Date),
          uploadedAt: expect.any(Date),
        },
      });

      expect(res.id).toBe('created-id');
    });

    it('skips optimization when empty optimize object is provided and forceCompression is disabled', async () => {
      const configMock: any = {
        get: jest.fn((key: string) => {
          if (key === 'compression.forceEnabled') return false;
          if (key === 'storage.bucket') return 'test-bucket';
          if (key === 'upload') return { imageMaxBytesMb: 25 };
          return undefined;
        }),
      };

      const testModule = await Test.createTestingModule({
        providers: [
          FilesService,
          { provide: getLoggerToken(FilesService.name), useValue: { info: jest.fn(), error: jest.fn() } },
          { provide: PrismaService, useValue: prismaMock },
          { provide: StorageService, useValue: storageMock },
          { provide: ImageOptimizerService, useValue: imageOptimizerMock },
          { provide: ConfigService, useValue: configMock },
          { provide: ExifService, useValue: exifServiceMock },
          FilesMapper,
          FileProblemDetector,
        ],
      }).compile();

      const localService = testModule.get<FilesService>(FilesService);

      const created = { id: 'new-id', filename: 'a.jpg', status: FileStatus.uploading };
      (prismaMock as any).file.create.mockResolvedValue(created);
      (prismaMock as any).file.findFirst.mockResolvedValue(null);
      storageMock.copyObject.mockResolvedValue(undefined);
      (prismaMock as any).file.update.mockResolvedValue({ 
        ...created, 
        status: FileStatus.ready, 
        mimeType: 'image/jpeg',
        originalMimeType: 'image/jpeg' 
      });

      const stream = (await import('stream')).Readable.from([Buffer.from('abc')]);
      
      await localService.uploadFileStream({
        stream,
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        compressParams: {}, // Empty object
      });

      // wantsOptimization should be false, so it should NOT have optimizationStatus: pending
      expect((prismaMock as any).file.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          optimizationStatus: null,
          optimizationParams: null,
        }),
      }));
    });

    it('applies optimization when at least one parameter is provided', async () => {
      const created = { id: 'new-id', filename: 'a.jpg', status: FileStatus.uploading };
      (prismaMock as any).file.create.mockResolvedValue(created);
      (prismaMock as any).file.update.mockResolvedValue({ 
        ...created, 
        status: FileStatus.ready, 
        mimeType: 'image/jpeg',
        originalMimeType: 'image/jpeg'
      });

      const stream = (await import('stream')).Readable.from([Buffer.from('abc')]);
      
      await service.uploadFileStream({
        stream,
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        compressParams: { quality: 80 } as any, 
      });

      expect((prismaMock as any).file.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          optimizationStatus: OptimizationStatus.pending,
          optimizationParams: { quality: 80 },
        }),
      }));
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
        status: FileStatus.ready,
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
        status: FileStatus.ready,
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
          originalMimeType: 'text/plain',
          mimeType: 'text/plain',
          size: 1n,
          originalSize: null,
          checksum: 'sha256:x',
          uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
          statusChangedAt: new Date('2020-01-01T00:00:10.000Z'),
          status: FileStatus.ready,
          metadata: { a: 1 },
          optimizationStatus: null,
          optimizationError: null,
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
      expect(res.items[0]?.status).toBe(FileStatus.ready);
      expect(res.items[0]?.metadata).toEqual({ a: 1 });
      expect(res.items[0]?.statusChangedAt).toBeInstanceOf(Date);
      expect(res.items[0]?.originalMimeType).toBe('text/plain');
      expect(res.items[0]?.optimizationStatus).toBeUndefined();
      expect(res.items[0]?.optimizationError).toBeUndefined();
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
          status: FileStatus.ready,
          deletedAt: null,
          appId: 'app-1',
          userId: 'user-1',
        },
        orderBy: {
          createdAt: 'asc',
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

  describe('reprocessFile', () => {
    it('throws NotFoundException if file does not exist', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue(null);
      await expect(service.reprocessFile('id', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if file is not READY', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({ id: 'id', status: FileStatus.uploading });
      await expect(service.reprocessFile('id', { format: 'webp' })).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if file is not an image', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        status: FileStatus.ready,
        mimeType: 'application/pdf',
      });
      await expect(service.reprocessFile('id', { format: 'webp' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if params are empty and forceCompression is disabled', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        status: FileStatus.ready,
        mimeType: 'image/jpeg',
      });
      // default config sets forceCompression=false
      await expect(service.reprocessFile('id', {})).rejects.toThrow(BadRequestException);
    });

    it('reprocesses file and returns new file response', async () => {
      const originalFile = {
        id: 'id',
        status: FileStatus.ready,
        mimeType: 'image/jpeg',
        filename: 'test.jpg',
        s3Key: 'aa/bb/orig.jpg',
        size: 1000n,
        checksum: 'sha256:orig',
      };
      (prismaMock as any).file.findUnique.mockResolvedValue(originalFile);

      const stream = (await import('stream')).Readable.from([Buffer.from('data')]);
      storageMock.downloadStream.mockResolvedValue({ stream });

      imageOptimizerMock.compressImage.mockResolvedValue({
        buffer: Buffer.from('compressed'),
        size: 500,
        format: 'image/webp',
      });

      (prismaMock as any).file.findFirst.mockResolvedValue(null); // No existing file with same checksum

      const newFile = {
        ...originalFile,
        id: 'new-id',
        mimeType: 'image/webp',
        size: 500n,
        checksum: 'sha256:new',
        s3Key: 'cc/dd/new.webp',
      };
      (prismaMock as any).file.create.mockResolvedValue(newFile);
      exifServiceMock.tryExtractFromStorageKey.mockResolvedValue({ some: 'exif' });

      const result = await service.reprocessFile('id', { format: 'webp' });

      expect(storageMock.downloadStream).toHaveBeenCalledWith('aa/bb/orig.jpg');
      expect(imageOptimizerMock.compressImage).toHaveBeenCalled();
      expect((prismaMock as any).file.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          checksum: 'sha256:9da308c2e4bc33afa72df5c088b5fc5673c477f3ef21d6bdaa358393834f9804',
          size: BigInt(500),
          originalS3Key: 'aa/bb/orig.jpg',
          originalChecksum: 'sha256:orig',
          originalSize: 1000n,
        }),
      }));
      expect(result.id).toBe('new-id');
      expect(result.mimeType).toBe('image/webp');
    });

    it('returns existing file if checksum matches (deduplication)', async () => {
      const originalFile = {
        id: 'id',
        status: FileStatus.ready,
        mimeType: 'image/jpeg',
        filename: 'test.jpg',
        s3Key: 'aa/bb/orig.jpg',
      };
      (prismaMock as any).file.findUnique.mockResolvedValue(originalFile);

      storageMock.downloadStream.mockResolvedValue({
        stream: (await import('stream')).Readable.from([Buffer.from('data')]),
      });

      imageOptimizerMock.compressImage.mockResolvedValue({
        buffer: Buffer.from('compressed'),
        size: 500,
        format: 'image/webp',
      });

      const existingFile = {
        id: 'existing-id',
        status: FileStatus.ready,
        mimeType: 'image/webp',
        checksum: 'sha256:4d616335123d4529f55e5d3269b247f0bf0885c398337894a86f917578be4d5f', // hash of 'compressed'
        size: 500n,
        uploadedAt: new Date(),
        statusChangedAt: new Date(),
      };
      (prismaMock as any).file.findFirst.mockResolvedValue(existingFile);

      const result = await service.reprocessFile('id', { format: 'webp' });

      expect(result.id).toBe('existing-id');
      expect((prismaMock as any).file.create).not.toHaveBeenCalled();
    });
  });
});
