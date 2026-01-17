import { Test, type TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { getLoggerToken } from 'nestjs-pino';

const parseMock: any = jest.fn();

jest.unstable_mockModule('exifr', () => ({
  default: {
    parse: parseMock,
  },
}));

const { ExifService } = await import('../../src/modules/files/exif.service.js');
const { StorageService } = await import('../../src/modules/storage/storage.service.js');
const { HeavyTasksQueueService } =
  await import('../../src/modules/heavy-tasks-queue/heavy-tasks-queue.service.js');

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

  const heavyTasksQueueMock: any = {
    execute: jest.fn(async (task: any) => task()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    delete process.env.EXIF_MAX_BYTES_MB;
    delete process.env.EXIF_MAX_BYTES;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExifService,
        { provide: getLoggerToken('ExifService'), useValue: loggerMock },
        { provide: StorageService, useValue: storageMock },
        { provide: HeavyTasksQueueService, useValue: heavyTasksQueueMock },
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
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('disables extraction when EXIF_MAX_BYTES=0 (legacy bytes)', async () => {
    process.env.EXIF_MAX_BYTES = '0';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExifService,
        { provide: getLoggerToken('ExifService'), useValue: loggerMock },
        { provide: StorageService, useValue: storageMock },
        { provide: HeavyTasksQueueService, useValue: heavyTasksQueueMock },
      ],
    }).compile();

    service = moduleRef.get(ExifService);

    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });

    expect(res).toBeUndefined();
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('returns undefined when exifr returns undefined', async () => {
    parseMock.mockImplementationOnce(async () => undefined);

    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });

    expect(res).toBeUndefined();
    expect(parseMock).toHaveBeenCalledTimes(1);
  });

  it('disables extraction when EXIF_MAX_BYTES_MB=0', async () => {
    process.env.EXIF_MAX_BYTES_MB = '0';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExifService,
        { provide: getLoggerToken('ExifService'), useValue: loggerMock },
        { provide: StorageService, useValue: storageMock },
        { provide: HeavyTasksQueueService, useValue: heavyTasksQueueMock },
      ],
    }).compile();

    service = moduleRef.get(ExifService);

    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });

    expect(res).toBeUndefined();
    expect(parseMock).not.toHaveBeenCalled();
  });

  it('returns object when exifr returns data', async () => {
    parseMock.mockImplementationOnce(async () => ({ Make: 'Canon' }));

    const res = await service.tryExtractFromBuffer({
      buffer: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });

    expect(res).toEqual({ Make: 'Canon' });
  });
});
