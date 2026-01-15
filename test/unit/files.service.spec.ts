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
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const storageMock: Pick<
    StorageService,
    'uploadFile' | 'uploadStream' | 'downloadFile' | 'downloadStream' | 'deleteFile' | 'copyObject'
  > = {
    uploadFile: jest.fn(),
    uploadStream: jest.fn(),
    downloadFile: jest.fn(),
    downloadStream: jest.fn(),
    deleteFile: jest.fn(),
    copyObject: jest.fn(),
  };

  const imageOptimizerMock: Pick<ImageOptimizerService, 'optimizeImage'> = {
    optimizeImage: jest.fn(),
  };

  const configServiceMock: Pick<ConfigService, 'get'> = {
    get: jest.fn((key: string) => {
      if (key === 'storage.bucket') {
        return 'test-bucket';
      }
      if (key === 'BASE_PATH') {
        return 'http://localhost:3000';
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    (storageMock.uploadFile as unknown as jest.Mock).mockResolvedValue(undefined);
    (storageMock.uploadStream as unknown as jest.Mock).mockImplementation(async (params: any) => {
      if (params?.body && typeof params.body[Symbol.asyncIterator] === 'function') {
        await drainStream(params.body);
      }
    });

    moduleRef = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StorageService, useValue: storageMock },
        { provide: ImageOptimizerService, useValue: imageOptimizerMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = moduleRef.get<FilesService>(FilesService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadFile', () => {
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
        url: 'http://localhost:3000/api/v1/files/file-id/download',
      });

      expect((storageMock.uploadFile as jest.Mock).mock.calls.length).toBe(0);
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
        data: { status: FileStatus.READY, uploadedAt: expect.any(Date) },
      });

      expect(res.id).toBe('new-id');
      expect(res.url).toBe('http://localhost:3000/api/v1/files/new-id/download');
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
      (storageMock.uploadFile as jest.Mock).mockRejectedValue(new Error('S3 down'));

      await expect(
        service.uploadFile({
          buffer: Buffer.from('abc'),
          filename: 'a.txt',
          mimeType: 'text/plain',
        }),
      ).rejects.toThrow('S3 down');

      expect((prismaMock as any).file.update).toHaveBeenCalledWith({
        where: { id: 'new-id' },
        data: { status: FileStatus.FAILED },
      });
    });

    it('uses optimizer when optimizeParams provided and stores originalSize when smaller', async () => {
      const optimized = Buffer.from('a');

      (imageOptimizerMock.optimizeImage as jest.Mock).mockResolvedValue({
        buffer: optimized,
        size: 1,
        format: 'image/webp',
      });

      (prismaMock as any).file.findFirst.mockResolvedValue(null);
      (prismaMock as any).file.create.mockImplementation(async ({ data }: any) => ({
        id: 'new-id',
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
        originalSize: data.originalSize,
        checksum: data.checksum,
        uploadedAt: null,
        status: data.status,
      }));
      (prismaMock as any).file.update.mockImplementation(async ({ data }: any) => ({
        id: 'new-id',
        filename: 'a.jpg',
        mimeType: 'image/webp',
        size: 1n,
        originalSize: 3n,
        checksum: 'sha256:optimized',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        status: data.status,
      }));

      const res = await service.uploadFile({
        buffer: Buffer.from('abc'),
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        optimizeParams: { quality: 80 },
      });

      expect(imageOptimizerMock.optimizeImage).toHaveBeenCalledTimes(1);
      expect(res.mimeType).toBe('image/webp');
      expect(res.originalSize).toBe(3);
    });
  });

  describe('uploadFileStream', () => {
    it('throws when optimizeParams provided', async () => {
      await expect(
        service.uploadFileStream({
          stream: undefined as any,
          filename: 'a.bin',
          mimeType: 'application/octet-stream',
          optimizeParams: { quality: 80 },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

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
  });

  describe('downloadFile', () => {
    it('throws NotFound when db record missing', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue(null);
      await expect(service.downloadFile('id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Gone when status deleted', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({ status: FileStatus.DELETED });
      await expect(service.downloadFile('id')).rejects.toBeInstanceOf(GoneException);
    });

    it('throws Conflict when status not READY', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({ status: FileStatus.UPLOADING });
      await expect(service.downloadFile('id')).rejects.toBeInstanceOf(ConflictException);
    });

    it('downloads from storage when READY', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 3n,
        status: FileStatus.READY,
        s3Key: 'aa/bb/cc.txt',
      });
      (storageMock.downloadFile as jest.Mock).mockResolvedValue(Buffer.from('abc'));

      const res = await service.downloadFile('id');
      expect(res).toEqual({
        buffer: Buffer.from('abc'),
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 3,
      });
    });
  });

  describe('deleteFile', () => {
    it('throws NotFound when missing', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue(null);
      await expect(service.deleteFile('id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when already deleted/deleting', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({ status: FileStatus.DELETING });
      await expect(service.deleteFile('id')).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks DELETING, deletes in storage, marks DELETED', async () => {
      (prismaMock as any).file.findUnique.mockResolvedValue({
        id: 'id',
        s3Key: 'aa/bb',
        status: FileStatus.READY,
      });

      (prismaMock as any).file.update.mockResolvedValue({});
      (storageMock.deleteFile as jest.Mock).mockResolvedValue(undefined);

      await service.deleteFile('id');

      expect((prismaMock as any).file.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'id' },
        data: { status: FileStatus.DELETING, deletedAt: expect.any(Date) },
      });
      expect(storageMock.deleteFile).toHaveBeenCalledWith('aa/bb');
      expect((prismaMock as any).file.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'id' },
        data: { status: FileStatus.DELETED },
      });
    });
  });

  describe('listFiles', () => {
    it('returns items and pagination', async () => {
      const items = [
        {
          id: 'id1',
          filename: 'a.txt',
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
    });
  });
});
