import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import sharp from 'sharp';
import { OptimizationConfig } from '../../config/optimization.config.js';
import { OptimizeParamsDto } from '../files/dto/optimize-params.dto.js';
import { CompressParamsDto } from '../files/dto/compress-params.dto.js';

export interface OptimizationResult {
  buffer: Buffer;
  size: number;
  format: string;
}

interface CompressionConfig {
  forceEnabled: boolean;
  defaultQuality: number;
  maxWidth: number;
  maxHeight: number;
  defaultFormat: 'webp' | 'avif';
}

@Injectable()
export class ImageOptimizerService {
  private readonly config: OptimizationConfig;
  private readonly compressionConfig: CompressionConfig;

  constructor(
    @InjectPinoLogger(ImageOptimizerService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    this.config = this.configService.get<OptimizationConfig>('optimization')!;
    this.compressionConfig = this.configService.get<CompressionConfig>('compression')!;
  }

  /**
   * @deprecated Use compressImage instead
   */
  async optimizeImage(
    buffer: Buffer,
    mimeType: string,
    params?: OptimizeParamsDto,
  ): Promise<OptimizationResult> {
    if (!this.config.enabled) {
      return {
        buffer,
        size: buffer.length,
        format: mimeType,
      };
    }

    if (!this.isImageMimeType(mimeType)) {
      return {
        buffer,
        size: buffer.length,
        format: mimeType,
      };
    }

    try {
      let image = sharp(buffer);

      const metadata = await image.metadata();

      if (params?.maxWidth || params?.maxHeight) {
        const maxWidth = params.maxWidth || this.config.maxWidth;
        const maxHeight = params.maxHeight || this.config.maxHeight;

        image = image.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      } else if (metadata.width && metadata.height) {
        if (metadata.width > this.config.maxWidth || metadata.height > this.config.maxHeight) {
          image = image.resize(this.config.maxWidth, this.config.maxHeight, {
            fit: 'inside',
            withoutEnlargement: true,
          });
        }
      }

      const quality = params?.quality || this.config.defaultQuality;
      const format = params?.format;

      if (format === 'webp') {
        image = image.webp({ quality });
      } else if (format === 'jpeg') {
        image = image.jpeg({ quality });
      } else if (format === 'png') {
        image = image.png({ quality });
      } else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
        image = image.jpeg({ quality });
      } else if (mimeType === 'image/png') {
        image = image.png({ quality });
      } else if (mimeType === 'image/webp') {
        image = image.webp({ quality });
      }

      const optimizedBuffer = await image.toBuffer();

      const resultFormat = format ? `image/${format}` : mimeType;

      this.logger.info(
        {
          beforeBytes: buffer.length,
          afterBytes: optimizedBuffer.length,
          reductionPercent: Number(((1 - optimizedBuffer.length / buffer.length) * 100).toFixed(1)),
        },
        'Image optimized',
      );

      return {
        buffer: optimizedBuffer,
        size: optimizedBuffer.length,
        format: resultFormat,
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to optimize image');
      throw new BadRequestException('Failed to optimize image');
    }
  }

  async compressImage(
    buffer: Buffer,
    originalMimeType: string,
    params: CompressParamsDto,
    forceCompress: boolean,
  ): Promise<OptimizationResult> {
    if (!this.isImageMimeType(originalMimeType)) {
      return {
        buffer,
        size: buffer.length,
        format: originalMimeType,
      };
    }

    try {
      let quality: number;
      let maxWidth: number;
      let maxHeight: number;
      let format: 'webp' | 'avif';
      let stripMetadata: boolean;

      if (forceCompress) {
        quality = this.compressionConfig.defaultQuality;
        maxWidth = this.compressionConfig.maxWidth;
        maxHeight = this.compressionConfig.maxHeight;
        format = this.compressionConfig.defaultFormat;
        stripMetadata = false;
      } else {
        quality = params.quality ?? this.compressionConfig.defaultQuality;
        maxWidth = Math.min(
          params.maxWidth ?? Number.POSITIVE_INFINITY,
          this.compressionConfig.maxWidth,
        );
        maxHeight = Math.min(
          params.maxHeight ?? Number.POSITIVE_INFINITY,
          this.compressionConfig.maxHeight,
        );
        format = params.format ?? this.compressionConfig.defaultFormat;
        stripMetadata = params.stripMetadata ?? false;
      }

      const metadata = await sharp(buffer).metadata();

      let resizeWidth = metadata.width ?? 0;
      let resizeHeight = metadata.height ?? 0;

      if (resizeWidth > maxWidth || resizeHeight > maxHeight) {
        const aspectRatio = resizeWidth / resizeHeight;
        if (resizeWidth > maxWidth) {
          resizeWidth = maxWidth;
          resizeHeight = Math.round(maxWidth / aspectRatio);
        }
        if (resizeHeight > maxHeight) {
          resizeHeight = maxHeight;
          resizeWidth = Math.round(maxHeight * aspectRatio);
        }
      }

      let pipeline = sharp(buffer);

      pipeline = pipeline.rotate();

      if (resizeWidth !== metadata.width || resizeHeight !== metadata.height) {
        pipeline = pipeline.resize(resizeWidth, resizeHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      if (!stripMetadata) {
        pipeline = pipeline.withMetadata();
      }

      let outputMimeType: string;

      if (format === 'webp') {
        pipeline = pipeline.webp({
          quality,
          effort: 4,
        });
        outputMimeType = 'image/webp';
      } else if (format === 'avif') {
        pipeline = pipeline.avif({
          quality,
          effort: 4,
        });
        outputMimeType = 'image/avif';
      } else {
        throw new BadRequestException(`Unsupported format: ${format}`);
      }

      const resultBuffer = await pipeline.toBuffer();

      this.logger.info(
        {
          beforeBytes: buffer.length,
          afterBytes: resultBuffer.length,
          reductionPercent: Number(((1 - resultBuffer.length / buffer.length) * 100).toFixed(1)),
          format,
          stripMetadata,
        },
        'Image compressed',
      );

      return {
        buffer: resultBuffer,
        size: resultBuffer.length,
        format: outputMimeType,
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to compress image');
      throw new BadRequestException('Failed to compress image');
    }
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }
}
