import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CompressParamsDto } from '../files/dto/compress-params.dto.js';
import { ImageProcessingClient } from '../image-processing/image-processing.client.js';

export interface OptimizationResult {
  buffer: Buffer;
  size: number;
  format: string;
}

interface CompressionConfig {
  forceEnabled: boolean;
  format: 'webp' | 'avif';
  maxDimension: number;
  stripMetadata: boolean;
  lossless: boolean;
  webp: {
    quality: number;
    effort: number;
  };
  avif: {
    quality: number;
    effort: number;
    chromaSubsampling: '4:2:0' | '4:4:4' | undefined;
  };
}

@Injectable()
export class ImageOptimizerService {
  private readonly compressionConfig: CompressionConfig;

  constructor(
    @InjectPinoLogger(ImageOptimizerService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly imageProcessingClient: ImageProcessingClient,
  ) {
    this.compressionConfig = this.configService.get<CompressionConfig>('compression')!;
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
      const format = forceCompress
        ? this.compressionConfig.format
        : (params.format ?? this.compressionConfig.format);

      const maxDimension = forceCompress
        ? this.compressionConfig.maxDimension
        : Math.min(
            params.maxDimension ?? Number.POSITIVE_INFINITY,
            this.compressionConfig.maxDimension,
          );

      const stripMetadata = forceCompress
        ? this.compressionConfig.stripMetadata
        : (params.stripMetadata ?? this.compressionConfig.stripMetadata);
      const lossless = forceCompress
        ? this.compressionConfig.lossless
        : (params.lossless ?? this.compressionConfig.lossless);
      const autoOrient = params.autoOrient ?? true;

      let quality: number;
      let effort: number;
      const output: Record<string, any> = {
        format,
        lossless,
        stripMetadata,
      };

      if (format === 'webp') {
        quality = forceCompress
          ? this.compressionConfig.webp.quality
          : (params.quality ?? this.compressionConfig.webp.quality);
        effort = this.compressionConfig.webp.effort;
        output.quality = quality;
        output.effort = effort;
      } else if (format === 'avif') {
        quality = forceCompress
          ? this.compressionConfig.avif.quality
          : (params.quality ?? this.compressionConfig.avif.quality);
        effort = this.compressionConfig.avif.effort;
        output.quality = quality;
        output.effort = effort;

        const chromaSubsampling = this.compressionConfig.avif.chromaSubsampling;
        if (chromaSubsampling) {
          output.chromaSubsampling = chromaSubsampling;
        }
      } else {
        throw new BadRequestException(`Unsupported format: ${format}`);
      }

      const result = await this.imageProcessingClient.process({
        image: buffer.toString('base64'),
        mimeType: originalMimeType,
        priority: 2,
        transform: {
          resize: {
            maxDimension,
            fit: 'inside',
            withoutEnlargement: true,
          },
          autoOrient,
        },
        output,
      });

      const resultBuffer = Buffer.from(result.buffer, 'base64');

      this.logger.info(
        {
          beforeBytes: buffer.length,
          afterBytes: resultBuffer.length,
          reductionPercent: Number(((1 - resultBuffer.length / buffer.length) * 100).toFixed(1)),
          format,
          quality,
          lossless,
          stripMetadata,
          autoOrient,
        },
        'Image compressed',
      );

      return {
        buffer: resultBuffer,
        size: resultBuffer.length,
        format: result.mimeType,
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
