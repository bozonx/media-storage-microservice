import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpStatus, UnsupportedMediaTypeException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { FilesController } from '../../src/modules/files/files.controller.js';
import { FilesService } from '../../src/modules/files/files.service.js';

describe('FilesController (unit)', () => {
  let controller: FilesController;
  let moduleRef: TestingModule;

  const filesServiceMock: jest.Mocked<
    Pick<
      FilesService,
      | 'uploadFile'
      | 'uploadFileStream'
      | 'downloadFileStream'
      | 'getFileMetadata'
      | 'deleteFile'
      | 'listFiles'
    >
  > = {
    uploadFile: jest.fn<FilesService['uploadFile']>(),
    uploadFileStream: jest.fn<FilesService['uploadFileStream']>(),
    downloadFileStream: jest.fn<FilesService['downloadFileStream']>(),
    getFileMetadata: jest.fn<FilesService['getFileMetadata']>(),
    deleteFile: jest.fn<FilesService['deleteFile']>(),
    listFiles: jest.fn<FilesService['listFiles']>(),
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
      filesServiceMock.uploadFileStream.mockResolvedValue({
        id: 'id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 0,
        checksum: 'sha256:x',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        url: '/api/v1/files/id/download',
      });

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
      expect(res).toEqual({
        id: 'id',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 0,
        checksum: 'sha256:x',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        url: '/api/v1/files/id/download',
      });
      expect(filesServiceMock.uploadFileStream).toHaveBeenCalledWith({
        stream,
        filename: 'a.txt',
        mimeType: 'text/plain',
        metadata: { a: 1 },
      });
    });

    it('sanitizes filename before passing to service', async () => {
      const stream: any = { pipe: jest.fn() };
      filesServiceMock.uploadFileStream.mockResolvedValue({
        id: 'id',
        filename: 'evil name.exe',
        mimeType: 'text/plain',
        size: 0,
        checksum: 'sha256:x',
        uploadedAt: new Date('2020-01-01T00:00:00.000Z'),
        url: '/api/v1/files/id/download',
      });

      const req: any = {
        file: async () => ({
          filename: '../evil\r\nname.exe',
          mimetype: 'text/plain',
          fields: {},
          file: stream,
        }),
      };

      await controller.uploadFile(req);

      expect(filesServiceMock.uploadFileStream).toHaveBeenCalledWith({
        stream,
        filename: 'evil name.exe',
        mimeType: 'text/plain',
        metadata: undefined,
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
      filesServiceMock.downloadFileStream.mockResolvedValue({
        stream: { pipe: jest.fn() } as any,
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

      filesServiceMock.downloadFileStream.mockResolvedValue({
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
