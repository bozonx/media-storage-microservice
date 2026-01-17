import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import sharp from 'sharp';
import { CompressParamsDto } from '../files/dto/compress-params.dto.js';
import {
  HeavyTasksQueueService,
  TaskPriority,
} from '../heavy-tasks-queue/heavy-tasks-queue.service.js';

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
    private readonly heavyTasksQueue: HeavyTasksQueueService,
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

    return this.heavyTasksQueue.execute(async () => {
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

        let pipeline = sharp(buffer);
        if (autoOrient) {
          pipeline = pipeline.autoOrient();
        }

        pipeline = pipeline.resize(maxDimension, maxDimension, {
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        });

        if (!stripMetadata) {
          pipeline = pipeline.keepMetadata();
        }

        let outputMimeType: string;
        let quality: number;

        if (format === 'webp') {
          quality = forceCompress
            ? this.compressionConfig.webp.quality
            : (params.quality ?? this.compressionConfig.webp.quality);

          pipeline = pipeline.webp({
            quality,
            lossless,
            effort: this.compressionConfig.webp.effort,
          });
          outputMimeType = 'image/webp';
        } else if (format === 'avif') {
          quality = forceCompress
            ? this.compressionConfig.avif.quality
            : (params.quality ?? this.compressionConfig.avif.quality);

          const chromaSubsampling = this.compressionConfig.avif.chromaSubsampling;

          pipeline = pipeline.avif({
            quality,
            lossless,
            effort: this.compressionConfig.avif.effort,
            ...(chromaSubsampling ? { chromaSubsampling } : {}),
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
          format: outputMimeType,
        };
      } catch (error) {
        this.logger.error({ err: error }, 'Failed to compress image');
        throw new BadRequestException('Failed to compress image');
      }
    }, TaskPriority.LAZY_COMPRESSION);
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }
}
