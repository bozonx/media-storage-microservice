import { jest } from '@jest/globals';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';

import { FileStatus } from '../../src/generated/prisma/enums.js';
import { FilesService } from '../../src/modules/files/files.service.js';
import { ImageProcessingClient } from '../../src/modules/image-processing/image-processing.client.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { ThumbnailService } from '../../src/modules/thumbnails/thumbnail.service.js';

describe('ThumbnailService (unit)', () => {
  let service: ThumbnailService;

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const prismaMock: any = {
    file: {
      findFirst: jest.fn(),
    },
    thumbnail: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const storageMock: any = {
    downloadStream: jest.fn(),
    uploadFile: jest.fn(),
  };

  const filesServiceMock: any = {
    ensureOptimized: jest.fn(),
  };

  const imageProcessingClientMock: any = {
    process: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThumbnailService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: FilesService,
          useValue: filesServiceMock,
        },
        {
          provide: StorageService,
          useValue: storageMock,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'thumbnail') {
                return {
                  format: 'webp',
                  maxWidth: 2048,
                  maxHeight: 2048,
                  minWidth: 10,
                  minHeight: 10,
                  cacheMaxAgeSeconds: 31536000,
                  quality: 80,
                  effort: 6,
                };
              }
              if (key === 'storage.bucket') {
                return 'test-bucket';
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
              return null;
            }),
          },
        },
        {
          provide: getLoggerToken(ThumbnailService.name),
          useValue: mockLogger,
        },
        {
          provide: ImageProcessingClient,
          useValue: imageProcessingClientMock,
        },
      ],
    }).compile();

    service = module.get<ThumbnailService>(ThumbnailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getThumbnail', () => {
    const fileId = 'test-file-id';
    const mockFile = {
      id: fileId,
      mimeType: 'image/jpeg',
      s3Key: 'test/file.jpg',
      status: FileStatus.ready,
    };

    it('should throw NotFoundException when file does not exist', async () => {
      prismaMock.file.findFirst.mockResolvedValue(null as any);

      await expect(service.getThumbnail(fileId, { width: 100, height: 100 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when file is not an image', async () => {
      prismaMock.file.findFirst.mockResolvedValue({
        ...mockFile,
        mimeType: 'application/pdf',
      } as any);

      await expect(service.getThumbnail(fileId, { width: 100, height: 100 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return cached thumbnail if exists', async () => {
      const cachedThumbnail = {
        id: 'thumb-id',
        fileId,
        width: 100,
        height: 100,
        quality: 80,
        paramsHash: 'test-hash',
        s3Key: 'thumbs/test-file-id/hash.webp',
        size: BigInt(1000),
        mimeType: 'image/webp',
      };

      const thumbnailBuffer = Buffer.from('cached thumbnail');

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(cachedThumbnail as any);
      prismaMock.thumbnail.update.mockResolvedValue(cachedThumbnail as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield thumbnailBuffer;
        })(),
      });

      const result = await service.getThumbnail(fileId, { width: 100, height: 100 });

      expect(result.buffer).toEqual(thumbnailBuffer);
      expect(result.mimeType).toBe('image/webp');
      expect(result.size).toBe(1000);
      expect(result.cacheMaxAge).toBe(31536000);
      expect(prismaMock.thumbnail.update).toHaveBeenCalledWith({
        where: { id: 'thumb-id' },
        data: { lastAccessedAt: expect.any(Date) },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileId }),
        'Thumbnail cache hit',
      );
    });

    it('should generate new thumbnail when not cached', async () => {
      const originalBuffer = Buffer.from('original');
      const processedBuffer = Buffer.from('processed-thumb');
      imageProcessingClientMock.process.mockResolvedValueOnce({
        buffer: processedBuffer,
        mimeType: 'image/webp',
      });

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(null as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield originalBuffer;
        })(),
      });
      storageMock.uploadFile.mockResolvedValue(undefined as any);
      prismaMock.thumbnail.create.mockResolvedValue({
        id: 'new-thumb-id',
        fileId,
        width: 100,
        height: 100,
        quality: 80,
        s3Key: 'thumbs/test-file-id/hash.webp',
        size: BigInt(500),
        mimeType: 'image/webp',
      } as any);

      const result = await service.getThumbnail(fileId, { width: 100, height: 100 });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.mimeType).toBe('image/webp');
      expect(result.size).toBeGreaterThan(0);
      const lastCall = imageProcessingClientMock.process.mock.calls.at(-1)?.[0];
      expect(lastCall.transform.resize.width).toBe(100);
      expect(lastCall.transform.resize.height).toBe(100);
      expect(lastCall.transform.resize.fit).toBe('inside');
      expect(lastCall.mimeType).toBe('image/jpeg');
      expect(lastCall.output.format).toBe('webp');
      expect(storageMock.uploadFile).toHaveBeenCalledWith(
        expect.stringContaining('thumbs/'),
        expect.any(Buffer),
        'image/webp',
      );
      expect(prismaMock.thumbnail.create).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileId }),
        'Generating new thumbnail',
      );
    });

    it('should use default quality when not provided', async () => {
      const originalBuffer = Buffer.from('original');
      const processedBuffer = Buffer.from('processed-thumb');
      imageProcessingClientMock.process.mockResolvedValueOnce({
        buffer: processedBuffer,
        mimeType: 'image/webp',
      });

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(null as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield originalBuffer;
        })(),
      });
      storageMock.uploadFile.mockResolvedValue(undefined as any);
      prismaMock.thumbnail.create.mockResolvedValue({
        id: 'new-thumb-id',
        fileId,
        width: 100,
        height: 100,
        quality: 80,
        paramsHash: 'test-hash',
        s3Key: 'thumbs/test-file-id/hash.webp',
        size: BigInt(500),
        mimeType: 'image/webp',
      } as any);

      await service.getThumbnail(fileId, { width: 100, height: 100 });

      expect(prismaMock.thumbnail.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quality: 80,
          }),
        }),
      );
    });

    it('should use provided fit mode', async () => {
      const originalBuffer = Buffer.from('original');
      const processedBuffer = Buffer.from('processed-thumb');
      imageProcessingClientMock.process.mockResolvedValueOnce({
        buffer: processedBuffer,
        mimeType: 'image/webp',
      });

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(null as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield originalBuffer;
        })(),
      });
      storageMock.uploadFile.mockResolvedValue(undefined as any);
      prismaMock.thumbnail.create.mockResolvedValue({
        id: 'new-thumb-id',
        fileId,
        width: 100,
        height: 100,
        quality: 80,
        paramsHash: 'test-hash',
        s3Key: 'thumbs/test-file-id/hash.webp',
        size: BigInt(500),
        mimeType: 'image/webp',
      } as any);

      await service.getThumbnail(fileId, { width: 100, height: 100, fit: 'cover' });

      const lastCall = imageProcessingClientMock.process.mock.calls.at(-1)?.[0];
      expect(lastCall.transform.resize.fit).toBe('cover');
    });

    it('should use custom quality when provided', async () => {
      const originalBuffer = Buffer.from('original');
      const processedBuffer = Buffer.from('processed-thumb');
      imageProcessingClientMock.process.mockResolvedValueOnce({
        buffer: processedBuffer,
        mimeType: 'image/webp',
      });

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(null as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield originalBuffer;
        })(),
      });
      storageMock.uploadFile.mockResolvedValue(undefined as any);
      prismaMock.thumbnail.create.mockResolvedValue({
        id: 'new-thumb-id',
        fileId,
        width: 100,
        height: 100,
        quality: 90,
        paramsHash: 'test-hash',
        s3Key: 'thumbs/test-file-id/hash.webp',
        size: BigInt(500),
        mimeType: 'image/webp',
      } as any);

      await service.getThumbnail(fileId, { width: 100, height: 100, quality: 90 });

      expect(prismaMock.thumbnail.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quality: 90,
            paramsHash: expect.any(String),
          }),
        }),
      );
    });

    it('should resize image maintaining aspect ratio', async () => {
      const originalBuffer = Buffer.from('original');
      const processedBuffer = Buffer.from('processed-thumb');
      imageProcessingClientMock.process.mockResolvedValueOnce({
        buffer: processedBuffer,
        mimeType: 'image/webp',
      });

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(null as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield originalBuffer;
        })(),
      });
      storageMock.uploadFile.mockResolvedValue(undefined as any);
      prismaMock.thumbnail.create.mockResolvedValue({
        id: 'new-thumb-id',
        fileId,
        width: 200,
        height: 200,
        quality: 80,
        paramsHash: 'test-hash',
        s3Key: 'thumbs/test-file-id/hash.webp',
        size: BigInt(500),
        mimeType: 'image/webp',
      } as any);

      await service.getThumbnail(fileId, { width: 200, height: 200 });

      const lastCall = imageProcessingClientMock.process.mock.calls.at(-1)?.[0];
      expect(lastCall.transform.resize.width).toBe(200);
      expect(lastCall.transform.resize.height).toBe(200);
    });

    it('should throw BadRequestException on thumbnail generation error', async () => {
      const invalidBuffer = Buffer.from('invalid image data');

      imageProcessingClientMock.process.mockRejectedValueOnce(new Error('boom'));

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(null as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield invalidBuffer;
        })(),
      });

      await expect(service.getThumbnail(fileId, { width: 100, height: 100 })).rejects.toThrow(
        BadRequestException,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
        }),
        'Failed to generate thumbnail',
      );
    });

    it('should propagate HttpException from image processing client', async () => {
      const invalidBuffer = Buffer.from('invalid image data');

      imageProcessingClientMock.process.mockRejectedValueOnce(
        new ServiceUnavailableException('Image processing failed'),
      );

      prismaMock.file.findFirst.mockResolvedValue(mockFile as any);
      prismaMock.thumbnail.findUnique.mockResolvedValue(null as any);
      storageMock.downloadStream.mockResolvedValue({
        stream: (async function* () {
          yield invalidBuffer;
        })(),
      });

      await expect(service.getThumbnail(fileId, { width: 100, height: 100 })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
