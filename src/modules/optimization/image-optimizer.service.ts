import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { OptimizationConfig } from '../../config/optimization.config.js';
import { OptimizeParamsDto } from '../files/dto/optimize-params.dto.js';

export interface OptimizationResult {
  buffer: Buffer;
  size: number;
  format: string;
}

@Injectable()
export class ImageOptimizerService {
  private readonly logger = new Logger(ImageOptimizerService.name);
  private readonly config: OptimizationConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<OptimizationConfig>('optimization')!;
  }

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

      const resultFormat = format
        ? `image/${format}`
        : mimeType;

      this.logger.log(
        `Image optimized: ${buffer.length} -> ${optimizedBuffer.length} bytes (${((1 - optimizedBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`,
      );

      return {
        buffer: optimizedBuffer,
        size: optimizedBuffer.length,
        format: resultFormat,
      };
    } catch (error) {
      this.logger.error('Failed to optimize image', error);
      throw new BadRequestException('Failed to optimize image');
    }
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }
}
