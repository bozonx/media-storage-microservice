import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

const doneMock = jest.fn(async () => undefined);
const uploadCtorMock = jest.fn(() => ({ done: doneMock }));

jest.unstable_mockModule('@aws-sdk/lib-storage', () => ({
  Upload: uploadCtorMock,
}));

describe('StorageService (unit)', () => {
  it('uploads stream using multipart Upload without requiring contentLength', async () => {
    const { StorageService } = await import('../../src/modules/storage/storage.service.js');

    const loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
    };

    const configServiceMock: Pick<ConfigService, 'get'> = {
      get: jest.fn((key: string) => {
        if (key === 'storage') {
          return {
            endpoint: 'http://localhost:3900',
            region: 'garage',
            accessKeyId: 'garage',
            secretAccessKey: 'garage123',
            forcePathStyle: true,
            bucket: 'test-bucket',
          };
        }

        return undefined;
      }),
    };

    const service = new StorageService(loggerMock as any, configServiceMock as any);

    await service.uploadStream({
      key: 'tmp/test',
      body: Readable.from([Buffer.from('a'), Buffer.from('b')]),
      mimeType: 'application/octet-stream',
    });

    expect(uploadCtorMock).toHaveBeenCalledTimes(1);

    const uploadCallArgs = (uploadCtorMock as unknown as jest.Mock).mock.calls[0]?.[0];
    expect(uploadCallArgs).toEqual({
      client: expect.anything(),
      params: {
        Bucket: 'test-bucket',
        Key: 'tmp/test',
        Body: expect.anything(),
        ContentType: 'application/octet-stream',
        Metadata: undefined,
      },
    });

    expect(doneMock).toHaveBeenCalledTimes(1);
  });
});
