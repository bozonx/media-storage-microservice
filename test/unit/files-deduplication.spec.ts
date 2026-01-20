import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';

import { FileStatus, OptimizationStatus } from '../../src/generated/prisma/enums.js';
import { ExifService } from '../../src/modules/files/exif.service.js';
import { FileProblemDetector } from '../../src/modules/files/file-problem.detector.js';
import { FilesMapper } from '../../src/modules/files/files.mapper.js';
import { FilesService } from '../../src/modules/files/files.service.js';
import { ImageOptimizerService } from '../../src/modules/optimization/image-optimizer.service.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';

describe('FilesService - Deduplication', () => {
  let service: FilesService;
  let prismaService: any;
  let storageService: any;
  let imageOptimizer: any;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        'storage.bucket': 'test-bucket',
        'app.basePath': '',
        BASE_PATH: '',
        'imageProcessing.requestTimeoutMs': 60000,
        'compression.forceEnabled': false,
        upload: {
          imageMaxBytesMb: 25,
          videoMaxBytesMb: 100,
          audioMaxBytesMb: 50,
          documentMaxBytesMb: 50,
          maxFileSizeMb: 100,
        },
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        {
          provide: 'PinoLogger:FilesService',
          useValue: mockLogger,
        },
        {
          provide: PrismaService,
          useValue: {
            file: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: StorageService,
          useValue: {
            uploadStream: jest.fn(),
            uploadFile: jest.fn(),
            copyObject: jest.fn(),
            deleteFile: jest.fn(),
            downloadStream: jest.fn(),
          },
        },
        {
          provide: ImageOptimizerService,
          useValue: {
            compressImage: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ExifService,
          useValue: {
            tryExtractFromBuffer: async () => undefined,
            tryExtractFromStorageKey: async () => undefined,
          },
        },
        FilesMapper,
        FileProblemDetector,
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    prismaService = module.get<PrismaService>(PrismaService);
    storageService = module.get<StorageService>(StorageService);
    imageOptimizer = module.get<ImageOptimizerService>(ImageOptimizerService);

    jest.clearAllMocks();
  });

  describe('uploadFile - concurrent uploads of identical content', () => {
    it('should deduplicate when second upload finds existing READY file', async () => {
      const buffer = Buffer.from('test content');
      const checksum = 'sha256:9a0364b9e99bb480dd25e1f0284c8555f0c8d9c8a8f5a5f5f5f5f5f5f5f5f5f5';

      const existingFile = {
        id: 'existing-id',
        filename: 'existing.txt',
        mimeType: 'text/plain',
        size: BigInt(buffer.length),
        originalSize: null,
        checksum,
        s3Key: 'ab/cd/abcd...txt',
        s3Bucket: 'test-bucket',
        status: FileStatus.ready,
        uploadedAt: new Date(),
      };

      const created = {
        id: 'created-id',
        filename: 'test.txt',
        mimeType: 'text/plain',
        size: null,
        originalSize: null,
        checksum: null,
        uploadedAt: null,
        status: FileStatus.uploading,
        s3Key: 'tmp/test-key',
      };

      prismaService.file.create.mockResolvedValue(created);
      storageService.uploadStream.mockImplementation(async ({ body }: any) => {
        for await (const _chunk of body) {
          // drain
        }
      });

      prismaService.file.findFirst.mockResolvedValue(existingFile);
      storageService.deleteFile.mockResolvedValue(undefined);
      prismaService.file.delete.mockResolvedValue(undefined);

      const result = await service.uploadFile({
        buffer,
        filename: 'test.txt',
        mimeType: 'text/plain',
      });

      expect(result.id).toBe('existing-id');
      expect(prismaService.file.create).toHaveBeenCalledTimes(1);
      expect(storageService.uploadStream).toHaveBeenCalledTimes(1);
      expect(storageService.deleteFile).toHaveBeenCalledTimes(1);
      expect(prismaService.file.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('uploadFileStream - promote race condition (P2002)', () => {
    it('should deduplicate when promoteUploadedFileToReady hits P2002 and READY file exists', async () => {
      const fileId = 'new-file-id';
      const checksum = 'sha256:abcd1234';

      const created = {
        id: fileId,
        s3Key: 'tmp/test-key',
        status: FileStatus.uploading,
      };

      const existingFile = {
        id: 'existing-id',
        filename: 'existing.txt',
        mimeType: 'text/plain',
        size: BigInt(100),
        originalSize: null,
        checksum,
        s3Key: 'ab/cd/abcd1234.txt',
        s3Bucket: 'test-bucket',
        status: FileStatus.ready,
        uploadedAt: new Date(),
      };

      prismaService.file.create.mockResolvedValue(created);
      storageService.uploadStream.mockImplementation(async ({ body }: any) => {
        for await (const _chunk of body) {
          // drain
        }
      });

      prismaService.file.findFirst.mockResolvedValueOnce(null);
      storageService.copyObject.mockResolvedValue(undefined);
      storageService.deleteFile.mockResolvedValue(undefined);

      prismaService.file.update.mockRejectedValueOnce({
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      });

      prismaService.file.findFirst.mockResolvedValueOnce(existingFile);
      prismaService.file.delete.mockResolvedValue(undefined);

      const stream = Readable.from([Buffer.from('test content')]);

      const result = await service.uploadFileStream({
        stream,
        filename: 'test.txt',
        mimeType: 'text/plain',
      });

      expect(result.id).toBe('existing-id');
      expect(prismaService.file.delete).toHaveBeenCalledWith({ where: { id: fileId } });
    });
  });

  describe('uploadFileStream - deduplication after upload', () => {
    it('should delete tmp file and DB record when existing READY file is found', async () => {
      const fileId = 'new-file-id';
      const checksum = 'sha256:abcd1234';
      const createdS3Key = 'tmp/test-key';

      const existingFile = {
        id: 'existing-id',
        filename: 'existing.txt',
        mimeType: 'text/plain',
        size: BigInt(100),
        originalSize: null,
        checksum,
        s3Key: 'ab/cd/abcd1234.txt',
        s3Bucket: 'test-bucket',
        status: FileStatus.ready,
        uploadedAt: new Date(),
      };

      prismaService.file.create.mockResolvedValue({
        id: fileId,
        s3Key: createdS3Key,
        status: FileStatus.uploading,
      });

      storageService.uploadStream.mockResolvedValue(undefined);
      prismaService.file.findFirst.mockResolvedValue(existingFile);
      storageService.deleteFile.mockResolvedValue(undefined);
      prismaService.file.delete.mockResolvedValue(undefined);

      const stream = Readable.from([Buffer.from('test content')]);

      const result = await service.uploadFileStream({
        stream,
        filename: 'test.txt',
        mimeType: 'text/plain',
      });

      const uploadedKey = storageService.uploadStream.mock.calls[0]?.[0]?.key;

      expect(result.id).toBe('existing-id');
      expect(storageService.deleteFile).toHaveBeenCalledWith(uploadedKey);
      expect(prismaService.file.delete).toHaveBeenCalledWith({ where: { id: fileId } });
    });

    it('should cleanup tmp file on upload failure', async () => {
      const fileId = 'new-file-id';
      const createdS3Key = 'tmp/test-key';

      prismaService.file.create.mockResolvedValue({
        id: fileId,
        s3Key: createdS3Key,
        status: FileStatus.uploading,
      });

      storageService.uploadStream.mockRejectedValue(new Error('S3 error'));
      prismaService.file.update.mockResolvedValue(undefined);
      storageService.deleteFile.mockResolvedValue(undefined);

      const stream = Readable.from([Buffer.from('test content')]);

      await expect(
        service.uploadFileStream({
          stream,
          filename: 'test.txt',
          mimeType: 'text/plain',
        }),
      ).rejects.toThrow('S3 error');

      const uploadedKey = ((storageService.uploadStream as jest.Mock).mock.calls[0]?.[0] as any)
        ?.key;

      expect(prismaService.file.update).toHaveBeenCalledWith({
        where: { id: fileId },
        data: expect.objectContaining({ status: FileStatus.failed }),
      });
      expect(storageService.deleteFile).toHaveBeenCalledWith(uploadedKey);
    });
  });

  describe('promoteUploadedFileToReady - race condition handling', () => {
    it('should handle P2002 during update and return existing file', async () => {
      const fileId = 'new-file-id';
      const checksum = 'sha256:abcd1234';
      const mimeType = 'text/plain';

      const existingFile = {
        id: 'existing-id',
        filename: 'existing.txt',
        mimeType,
        size: BigInt(100),
        originalSize: null,
        checksum,
        s3Key: 'ab/cd/abcd1234.txt',
        s3Bucket: 'test-bucket',
        status: FileStatus.ready,
        uploadedAt: new Date(),
      };

      prismaService.file.update.mockRejectedValueOnce({
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      });
      prismaService.file.findFirst.mockResolvedValue(existingFile);
      prismaService.file.delete.mockResolvedValue(undefined);

      const result = await (service as any).promoteUploadedFileToReady({
        fileId,
        checksum,
        size: 100,
        finalKey: 'ab/cd/abcd1234.txt',
        mimeType,
      });

      expect(result.id).toBe('existing-id');
      expect(prismaService.file.delete).toHaveBeenCalledWith({ where: { id: fileId } });
    });
  });

  describe('optimizeImage - deduplication of optimized content', () => {
    it('should deduplicate if optimized content already exists', async () => {
      const fileId = 'new-file-id';
      const originalS3Key = 'originals/random-uuid';
      const checksum = 'sha256:optimized-hash';

      const fileToOptimize = {
        id: fileId,
        originalS3Key,
        originalMimeType: 'image/png',
        status: FileStatus.ready,
        optimizationStatus: OptimizationStatus.processing,
      };

      const existingOptimized = {
        id: 'existing-optimized-id',
        filename: 'existing.webp',
        mimeType: 'image/webp',
        size: BigInt(50),
        originalSize: null,
        checksum,
        s3Key: 'ab/cd/optimized-hash.webp',
        s3Bucket: 'test-bucket',
        status: FileStatus.ready,
        uploadedAt: new Date(),
      };

      prismaService.file.findUnique.mockResolvedValue(fileToOptimize);
      storageService.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield Buffer.from('original');
        })(),
      });
      imageOptimizer.compressImage.mockResolvedValue({
        buffer: Buffer.from('optimized'),
        format: 'image/webp',
        size: 50,
      });
      prismaService.file.findFirst.mockResolvedValue(existingOptimized);
      prismaService.file.delete.mockResolvedValue(undefined);
      storageService.deleteFile.mockResolvedValue(undefined);

      await (service as any).optimizeImage(fileId);

      expect(prismaService.file.delete).toHaveBeenCalledWith({ where: { id: fileId } });
      expect(storageService.deleteFile).toHaveBeenCalledWith(originalS3Key);
      expect(storageService.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle P2002 race during optimization update', async () => {
      const fileId = 'new-file-id';
      const originalS3Key = 'originals/random-uuid';
      const checksum = 'sha256:optimized-hash';

      const fileToOptimize = {
        id: fileId,
        originalS3Key,
        originalMimeType: 'image/png',
        status: FileStatus.ready,
        optimizationStatus: OptimizationStatus.processing,
      };

      const existingOptimized = {
        id: 'existing-optimized-id',
        filename: 'existing.webp',
        mimeType: 'image/webp',
        size: BigInt(50),
        originalSize: null,
        checksum,
        s3Key: 'ab/cd/optimized-hash.webp',
        s3Bucket: 'test-bucket',
        status: FileStatus.ready,
        uploadedAt: new Date(),
      };

      prismaService.file.findUnique.mockResolvedValue(fileToOptimize);
      storageService.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield Buffer.from('original');
        })(),
      });
      imageOptimizer.compressImage.mockResolvedValue({
        buffer: Buffer.from('optimized'),
        format: 'image/webp',
        size: 50,
      });
      prismaService.file.findFirst.mockResolvedValueOnce(null);
      storageService.uploadFile.mockResolvedValue(undefined);
      prismaService.file.update.mockRejectedValueOnce({
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      });
      prismaService.file.findFirst.mockResolvedValueOnce(existingOptimized);
      prismaService.file.delete.mockResolvedValue(undefined);
      storageService.deleteFile.mockResolvedValue(undefined);

      await (service as any).optimizeImage(fileId);

      expect(prismaService.file.delete).toHaveBeenCalledWith({ where: { id: fileId } });
      expect(storageService.deleteFile).toHaveBeenCalledWith(originalS3Key);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ fileId, checksum: expect.stringMatching(/^sha256:/) }),
        expect.stringContaining('Race condition'),
      );
    });

    it('should cleanup orphaned original on optimization failure', async () => {
      const fileId = 'new-file-id';
      const originalS3Key = 'originals/random-uuid';

      const fileToOptimize = {
        id: fileId,
        originalS3Key,
        originalMimeType: 'image/png',
        status: FileStatus.ready,
        optimizationStatus: OptimizationStatus.processing,
      };

      prismaService.file.findUnique.mockResolvedValue(fileToOptimize);
      storageService.downloadStream.mockRejectedValue(new Error('Download failed'));
      prismaService.file.update.mockResolvedValue(undefined);
      storageService.deleteFile.mockResolvedValue(undefined);

      await expect((service as any).optimizeImage(fileId)).rejects.toThrow('Download failed');

      expect(prismaService.file.update).toHaveBeenCalledWith({
        where: { id: fileId },
        data: expect.objectContaining({ optimizationStatus: OptimizationStatus.failed }),
      });
      expect(storageService.deleteFile).not.toHaveBeenCalledWith(originalS3Key);
    });
  });
});
