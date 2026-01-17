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
              if (key === 'compression') {
                return {
                  forceEnabled: false,
                  defaultFormat: 'webp',
                  maxDimension: 3840,
                  stripMetadataDefault: false,
                  losslessDefault: false,
                  webp: {
                    quality: 80,
                    effort: 6,
                  },
                  avif: {
                    quality: 60,
                    effort: 6,
                    chromaSubsampling: '4:4:4',
                  },
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
          autoOrient: true,
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
        { format: 'webp', quality: 80, maxDimension: 1920 },
        false,
      );

      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.width).toBeLessThanOrEqual(1920);
      expect(metadata.height).toBeLessThanOrEqual(1920);
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
          quality: 80,
          autoOrient: true,
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
          stripMetadata: false,
          lossless: false,
          autoOrient: true,
        }),
        'Image compressed',
      );
    });

    it('should respect max dimension limit from config', async () => {
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
        { format: 'webp', quality: 80, maxDimension: 10000 },
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
          lossless: false,
          autoOrient: true,
        }),
        'Image compressed',
      );
    });

    it('should preserve metadata by default', async () => {
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

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          stripMetadata: false,
          autoOrient: true,
        }),
        'Image compressed',
      );
    });

    it('should call autoOrient by default', async () => {
      const autoOrientSpy = jest.spyOn(sharp.prototype, 'autoOrient');
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

      await service.compressImage(inputBuffer, 'image/png', {}, false);

      expect(autoOrientSpy).toHaveBeenCalled();
    });

    it('should allow disabling autoOrient', async () => {
      const autoOrientSpy = jest.spyOn(sharp.prototype, 'autoOrient');
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
        { format: 'webp', quality: 80, autoOrient: false },
        false,
      );

      expect(result.format).toBe('image/webp');
      expect(autoOrientSpy).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          autoOrient: false,
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

    it('should support lossless compression', async () => {
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
        { format: 'webp', lossless: true },
        false,
      );

      expect(result.format).toBe('image/webp');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          lossless: true,
        }),
        'Image compressed',
      );
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
});
