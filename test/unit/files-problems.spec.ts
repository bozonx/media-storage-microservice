import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { FilesService } from '../../src/modules/files/files.service.js';
import { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { ImageOptimizerService } from '../../src/modules/optimization/image-optimizer.service.js';
import { ExifService } from '../../src/modules/files/exif.service.js';
import { FileStatus } from '../../src/modules/files/file-status.js';
import { OptimizationStatus } from '../../src/modules/files/optimization-status.js';
import { FilesMapper } from '../../src/modules/files/files.mapper.js';
import { FileProblemDetector } from '../../src/modules/files/file-problem.detector.js';

describe('FilesService - Problems', () => {
  let service: FilesService;
  let prismaService: any;

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
        'cleanup.stuckUploadTimeoutMs': 30 * 60 * 1000,
        'cleanup.stuckDeleteTimeoutMs': 30 * 60 * 1000,
        'cleanup.stuckOptimizationTimeoutMs': 30 * 60 * 1000,
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
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: StorageService,
          useValue: {},
        },
        {
          provide: ImageOptimizerService,
          useValue: {},
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

    jest.clearAllMocks();
  });

  it('should return items with detected problems (FAILED status)', async () => {
    prismaService.file.findMany.mockResolvedValue([
      {
        id: 'file-1',
        filename: 'broken.jpg',
        appId: null,
        userId: null,
        purpose: null,
        status: FileStatus.FAILED,
        statusChangedAt: new Date(),
        uploadedAt: null,
        deletedAt: null,
        s3Key: 'tmp/key',
        size: null,
        checksum: null,
        optimizationStatus: null,
        optimizationError: null,
        optimizationStartedAt: null,
      },
    ]);

    const result = await service.listProblemFiles({ limit: 10 });

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('file-1');
    expect(result.items[0]?.problems.some(p => p.code === 'status_failed')).toBe(true);
  });

  it('should include optimization_failed problem when optimizationStatus is FAILED', async () => {
    prismaService.file.findMany.mockResolvedValue([
      {
        id: 'file-2',
        filename: 'opt.jpg',
        appId: null,
        userId: null,
        purpose: null,
        status: FileStatus.READY,
        statusChangedAt: new Date(),
        uploadedAt: new Date(),
        deletedAt: null,
        s3Key: 'aa/bb/hash.jpg',
        size: BigInt(123),
        checksum: 'sha256:abc',
        optimizationStatus: OptimizationStatus.FAILED,
        optimizationError: 'Boom',
        optimizationStartedAt: new Date(Date.now() - 3600 * 1000),
      },
    ]);

    const result = await service.listProblemFiles({ limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.problems.some(p => p.code === 'optimization_failed')).toBe(true);
  });
});
