import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { ImageOptimizerService } from '../../src/modules/optimization/image-optimizer.service.js';
import { getLoggerToken } from 'nestjs-pino';
import sharp from 'sharp';

describe('ImageOptimizerService (unit)', () => {
  let service: ImageOptimizerService;
  let configService: ConfigService;

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageOptimizerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'optimization') {
                return {
                  enabled: true,
                  defaultQuality: 85,
                  maxWidth: 3840,
                  maxHeight: 2160,
                };
              }
              if (key === 'compression') {
                return {
                  forceEnabled: false,
                  defaultQuality: 85,
                  maxWidth: 3840,
                  maxHeight: 2160,
                  defaultFormat: 'webp',
                };
              }
              return null;
            }),
          },
        },
        {
          provide: getLoggerToken(ImageOptimizerService.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<ImageOptimizerService>(ImageOptimizerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('compressImage', () => {
    it('should compress image to WebP format', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(
        inputBuffer,
        'image/png',
        { format: 'webp', quality: 80 },
        false,
      );

      expect(result.format).toBe('image/webp');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.size).toBeGreaterThan(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          beforeBytes: inputBuffer.length,
          afterBytes: result.size,
          format: 'webp',
        }),
        'Image compressed',
      );
    });

    it('should compress image to AVIF format', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(
        inputBuffer,
        'image/png',
        { format: 'avif', quality: 80 },
        false,
      );

      expect(result.format).toBe('image/avif');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.size).toBeGreaterThan(0);
    });

    it('should resize image respecting max dimensions', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 5000,
          height: 3000,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(
        inputBuffer,
        'image/png',
        { format: 'webp', quality: 80, maxWidth: 1920, maxHeight: 1080 },
        false,
      );

      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.width).toBeLessThanOrEqual(1920);
      expect(metadata.height).toBeLessThanOrEqual(1080);
    });

    it('should use default quality from config when not provided', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(inputBuffer, 'image/png', {}, false);

      expect(result.format).toBe('image/webp');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'webp',
        }),
        'Image compressed',
      );
    });

    it('should use force compression settings when forceCompress is true', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(
        inputBuffer,
        'image/png',
        { format: 'avif', quality: 50 },
        true,
      );

      expect(result.format).toBe('image/webp');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'webp',
        }),
        'Image compressed',
      );
    });

    it('should respect max width/height limits from config', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 5000,
          height: 3000,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(
        inputBuffer,
        'image/png',
        { format: 'webp', quality: 80, maxWidth: 10000 },
        false,
      );

      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.width).toBeLessThanOrEqual(3840);
    });

    it('should preserve metadata when stripMetadata is false', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(
        inputBuffer,
        'image/png',
        { format: 'webp', quality: 80, stripMetadata: false },
        false,
      );

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          stripMetadata: false,
        }),
        'Image compressed',
      );
    });

    it('should strip metadata when stripMetadata is true', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.compressImage(
        inputBuffer,
        'image/png',
        { format: 'webp', quality: 80, stripMetadata: true },
        false,
      );

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          stripMetadata: true,
        }),
        'Image compressed',
      );
    });

    it('should return original buffer for non-image mime types', async () => {
      const inputBuffer = Buffer.from('test');

      const result = await service.compressImage(inputBuffer, 'application/pdf', {}, false);

      expect(result.buffer).toBe(inputBuffer);
      expect(result.format).toBe('application/pdf');
      expect(result.size).toBe(inputBuffer.length);
    });

    it('should throw BadRequestException for unsupported format', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      await expect(
        service.compressImage(inputBuffer, 'image/png', { format: 'jpeg' as any }, false),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle compression errors gracefully', async () => {
      const invalidBuffer = Buffer.from('invalid image data');

      await expect(
        service.compressImage(invalidBuffer, 'image/png', { format: 'webp' }, false),
      ).rejects.toThrow(BadRequestException);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
        }),
        'Failed to compress image',
      );
    });
  });

  describe('optimizeImage (deprecated)', () => {
    it('should still work for backward compatibility', async () => {
      const inputBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await service.optimizeImage(inputBuffer, 'image/png', {
        quality: 80,
        format: 'webp',
      });

      expect(result.format).toBe('image/webp');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });
});
