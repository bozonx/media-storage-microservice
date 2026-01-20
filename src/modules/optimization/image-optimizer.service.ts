import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  autoOrient: boolean;
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

  async validateAvailability(): Promise<void> {
    await this.imageProcessingClient.health();
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
      const autoOrient = forceCompress
        ? this.compressionConfig.autoOrient
        : (params.autoOrient ?? this.compressionConfig.autoOrient);
      const flatten = params.flatten ?? (params.removeAlpha ? '#ffffff' : undefined);

      let quality: number;
      let effort: number;
      const output: Record<string, any> = {
        format,
        lossless,
        stripMetadata,
      };

      const configForFormat = format === 'avif' ? this.compressionConfig.avif : this.compressionConfig.webp;
      
      quality = forceCompress
        ? configForFormat.quality
        : (params.quality ?? configForFormat.quality);
      effort = forceCompress
        ? configForFormat.effort
        : (params.effort ?? configForFormat.effort);

      output.quality = quality;
      output.effort = effort;

      if (format === 'avif') {
        const chromaSubsampling = forceCompress
          ? this.compressionConfig.avif.chromaSubsampling
          : (params.chromaSubsampling ?? this.compressionConfig.avif.chromaSubsampling);

        if (chromaSubsampling) {
          output.chromaSubsampling = chromaSubsampling;
        }
      }

      const result = await this.imageProcessingClient.process({
        buffer,
        mimeType: originalMimeType,
        priority: 2,
        transform: {
          resize: {
            maxDimension,
            fit: 'cover',
            withoutEnlargement: true,
          },
          autoOrient,
          flatten,
        },
        output,
      });

      const resultBuffer = result.buffer;

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
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException || error instanceof BadGatewayException || error instanceof GatewayTimeoutException) {
        throw error;
      }
      throw new BadRequestException('Failed to compress image');
    }
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }
}
