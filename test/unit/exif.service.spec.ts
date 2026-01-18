import { Test, type TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { getLoggerToken } from 'nestjs-pino';
import { ExifService } from '../../src/modules/files/exif.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { ImageProcessingClient } from '../../src/modules/image-processing/image-processing.client.js';

describe('ExifService (unit)', () => {
  let service: InstanceType<typeof ExifService>;

  const storageMock: any = {
    downloadStream: jest.fn(),
  };

  const loggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };

  const imageProcessingClientMock: any = {
    exif: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    delete process.env.IMAGE_MAX_BYTES_MB;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExifService,
        { provide: getLoggerToken('ExifService'), useValue: loggerMock },
        { provide: StorageService, useValue: storageMock },
        { provide: ImageProcessingClient, useValue: imageProcessingClientMock },
      ],
    }).compile();

    service = moduleRef.get(ExifService);
  });

  it('returns undefined for non-image mime type', async () => {
    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'text/plain',
    });

    expect(res).toBeUndefined();
    expect(imageProcessingClientMock.exif).not.toHaveBeenCalled();
  });

  it('returns undefined when image processing service returns null exif', async () => {
    imageProcessingClientMock.exif.mockResolvedValueOnce({ exif: null });

    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });

    expect(res).toBeUndefined();
    expect(imageProcessingClientMock.exif).toHaveBeenCalledTimes(1);
  });

  it('disables extraction when IMAGE_MAX_BYTES_MB=0', async () => {
    process.env.IMAGE_MAX_BYTES_MB = '0';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExifService,
        { provide: getLoggerToken('ExifService'), useValue: loggerMock },
        { provide: StorageService, useValue: storageMock },
        { provide: ImageProcessingClient, useValue: imageProcessingClientMock },
      ],
    }).compile();

    service = moduleRef.get(ExifService);

    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });

    expect(res).toBeUndefined();
    expect(imageProcessingClientMock.exif).not.toHaveBeenCalled();
  });

  it('returns object when service returns data', async () => {
    imageProcessingClientMock.exif.mockResolvedValueOnce({ exif: { Make: 'Canon' } });

    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });

    expect(res).toEqual({ Make: 'Canon' });
  });
});
