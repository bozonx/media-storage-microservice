import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpStatus, UnsupportedMediaTypeException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { FilesController } from '../../src/modules/files/files.controller.js';
import { FilesService } from '../../src/modules/files/files.service.js';

describe('FilesController (unit)', () => {
  let controller: FilesController;
  let moduleRef: TestingModule;

  const filesServiceMock: Pick<
    FilesService,
    | 'uploadFile'
    | 'uploadFileStream'
    | 'downloadFileStream'
    | 'getFileMetadata'
    | 'deleteFile'
    | 'listFiles'
  > = {
    uploadFile: jest.fn(),
    uploadFileStream: jest.fn(),
    downloadFileStream: jest.fn(),
    getFileMetadata: jest.fn(),
    deleteFile: jest.fn(),
    listFiles: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    process.env.BLOCK_EXECUTABLE_UPLOADS = 'true';
    process.env.BLOCK_ARCHIVE_UPLOADS = 'true';
    process.env.BLOCKED_MIME_TYPES = '';

    moduleRef = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [{ provide: FilesService, useValue: filesServiceMock }],
    }).compile();

    controller = moduleRef.get<FilesController>(FilesController);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadFile', () => {
    it('throws when file is missing', async () => {
      const req: any = {
        file: async () => undefined,
      };

      await expect(controller.uploadFile(req)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects executable mimetype', async () => {
      const req: any = {
        file: async () => ({
          filename: 'a.exe',
          mimetype: 'application/x-msdownload',
          fields: {},
        }),
      };

      await expect(controller.uploadFile(req)).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException,
      );
    });

    it('rejects archive mimetype', async () => {
      const req: any = {
        file: async () => ({
          filename: 'a.zip',
          mimetype: 'application/zip',
          fields: {},
        }),
      };

      await expect(controller.uploadFile(req)).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException,
      );
    });

    it('passes stream upload to service when no optimize param', async () => {
      const stream: any = { pipe: jest.fn() };
      (filesServiceMock.uploadFileStream as jest.Mock).mockResolvedValue({ id: 'id' });

      const req: any = {
        file: async () => ({
          filename: 'a.txt',
          mimetype: 'text/plain',
          fields: {
            metadata: { value: JSON.stringify({ a: 1 }) },
          },
          file: stream,
        }),
      };

      const res = await controller.uploadFile(req);
      expect(res).toEqual({ id: 'id' });
      expect(filesServiceMock.uploadFileStream).toHaveBeenCalledWith({
        stream,
        filename: 'a.txt',
        mimeType: 'text/plain',
        metadata: { a: 1 },
      });
    });

    it('throws for invalid metadata json', async () => {
      const req: any = {
        file: async () => ({
          filename: 'a.txt',
          mimetype: 'text/plain',
          fields: {
            metadata: { value: '{' },
          },
        }),
      };

      await expect(controller.uploadFile(req)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws for invalid optimize json', async () => {
      const req: any = {
        file: async () => ({
          filename: 'a.jpg',
          mimetype: 'image/jpeg',
          fields: {
            optimize: { value: '{' },
          },
        }),
      };

      await expect(controller.uploadFile(req)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws for optimize params when mimetype is not image/*', async () => {
      const req: any = {
        file: async () => ({
          filename: 'a.txt',
          mimetype: 'text/plain',
          fields: {
            optimize: { value: JSON.stringify({ quality: 80 }) },
          },
        }),
      };

      await expect(controller.uploadFile(req)).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException,
      );
    });

    it('uses buffer upload when optimize param provided', async () => {
      (filesServiceMock.uploadFile as jest.Mock).mockResolvedValue({ id: 'id' });

      const req: any = {
        file: async () => ({
          filename: 'a.jpg',
          mimetype: 'image/jpeg',
          fields: {
            optimize: { value: JSON.stringify({ quality: 80, format: 'webp' }) },
          },
          toBuffer: async () => Buffer.from('abc'),
        }),
      };

      const res = await controller.uploadFile(req);
      expect(res).toEqual({ id: 'id' });
      expect(filesServiceMock.uploadFile).toHaveBeenCalledWith({
        buffer: Buffer.from('abc'),
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        optimizeParams: expect.objectContaining({ quality: 80, format: 'webp' }),
        metadata: undefined,
      });
    });
  });

  describe('downloadFile', () => {
    function createReplyMock() {
      const state: { status?: number; headers: Record<string, string>; sent?: unknown } = {
        headers: {},
      };

      const reply: any = {
        status: (code: number) => {
          state.status = code;
          return reply;
        },
        header: (key: string, value: string) => {
          state.headers[key] = value;
          return reply;
        },
        send: (payload?: unknown) => {
          state.sent = payload;
          return reply;
        },
      };

      return { reply, state };
    }

    it('returns 304 when If-None-Match matches etag', async () => {
      (filesServiceMock.downloadFileStream as jest.Mock).mockResolvedValue({
        stream: { pipe: jest.fn() },
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 3,
        etag: 'etag123',
      });

      const req: any = { headers: { 'if-none-match': '"etag123"' } };
      const { reply, state } = createReplyMock();

      await controller.downloadFile('id', req, reply);

      expect(state.status).toBe(HttpStatus.NOT_MODIFIED);
      expect(state.headers['ETag']).toBe('"etag123"');
      expect(state.sent).toBeUndefined();
    });

    it('sets headers and streams body when etag does not match', async () => {
      const stream: any = { pipe: jest.fn() };

      (filesServiceMock.downloadFileStream as jest.Mock).mockResolvedValue({
        stream,
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 3,
        etag: 'etag123',
      });

      const req: any = { headers: { 'if-none-match': '"other"' } };
      const { reply, state } = createReplyMock();

      await controller.downloadFile('id', req, reply);

      expect(state.status).toBe(HttpStatus.OK);
      expect(state.headers['Content-Type']).toBe('text/plain');
      expect(state.headers['Content-Disposition']).toBe(
        'attachment; filename="a.txt"; filename*=UTF-8\'\'a.txt',
      );
      expect(state.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
      expect(state.headers['ETag']).toBe('"etag123"');
      expect(state.headers['Content-Length']).toBe('3');
      expect(state.sent).toBe(stream);
    });
  });
});
