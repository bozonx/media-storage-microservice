import {
  Injectable,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ThumbnailParamsDto } from '../files/dto/thumbnail-params.dto.js';
import { FileStatus } from '../files/file-status.js';
import { OptimizationStatus } from '../files/optimization-status.js';
import { FilesService } from '../files/files.service.js';
import {
  HeavyTasksQueueService,
  TaskPriority,
} from '../heavy-tasks-queue/heavy-tasks-queue.service.js';

interface ThumbnailConfig {
  format: 'webp' | 'avif';
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  cacheMaxAgeSeconds: number;
  quality: number;
  effort: number;
}

export interface ThumbnailResult {
  buffer: Buffer;
  mimeType: string;
  size: number;
  cacheMaxAge: number;
  etag: string;
}

@Injectable()
export class ThumbnailService {
  private readonly config: ThumbnailConfig;
  private readonly bucket: string;
  private readonly imageMaxBytes: number;

  constructor(
    @InjectPinoLogger(ThumbnailService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    @Inject(forwardRef(() => FilesService))
    private readonly filesService: FilesService,
    private readonly heavyTasksQueue: HeavyTasksQueueService,
  ) {
    this.config = this.configService.get<ThumbnailConfig>('thumbnail')!;
    this.bucket = this.configService.get<string>('storage.bucket')!;

    const parsedMb = Number.parseFloat(process.env.IMAGE_MAX_BYTES_MB ?? '');
    this.imageMaxBytes =
      Number.isFinite(parsedMb) && parsedMb > 0
        ? Math.floor(parsedMb * 1024 * 1024)
        : 25 * 1024 * 1024;
  }

  private async readToBufferWithLimit(
    stream: NodeJS.ReadableStream,
    maxBytes: number,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream as any) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        throw new BadRequestException('Image is too large');
      }
      chunks.push(buf);
    }

    return Buffer.concat(chunks);
  }

  async getThumbnail(fileId: string, params: ThumbnailParamsDto): Promise<ThumbnailResult> {
    let file = await (this.prismaService as any).file.findFirst({
      where: { id: fileId, status: FileStatus.READY },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const fileMimeType = file.mimeType || file.originalMimeType;
    if (!fileMimeType || !this.isImageMimeType(fileMimeType)) {
      throw new BadRequestException('File is not an image');
    }

    if (
      file.optimizationStatus === OptimizationStatus.PENDING ||
      file.optimizationStatus === OptimizationStatus.PROCESSING
    ) {
      file = await (this.filesService as any).ensureOptimized(fileId);
    }

    if (file.optimizationStatus === OptimizationStatus.FAILED) {
      throw new BadRequestException('Image optimization failed');
    }

    const fileS3Key = file.s3Key || file.originalS3Key;
    if (!fileS3Key) {
      throw new BadRequestException('File has no valid S3 key');
    }

    const width = Math.min(params.width, this.config.maxWidth);
    const height = Math.min(params.height, this.config.maxHeight);
    const format = this.config.format;
    const quality = params.quality ?? this.config.quality;
    const paramsHash = this.calculateParamsHash(width, height, quality, format);

    let thumbnail = await (this.prismaService as any).thumbnail.findUnique({
      where: {
        fileId_paramsHash: {
          fileId,
          paramsHash,
        },
      },
    });

    if (thumbnail) {
      await (this.prismaService as any).thumbnail.update({
        where: { id: thumbnail.id },
        data: { lastAccessedAt: new Date() },
      });

      this.logger.info({ fileId, paramsHash }, 'Thumbnail cache hit');

      const { stream } = await this.storageService.downloadStream(thumbnail.s3Key);
      const buffer = await this.readToBufferWithLimit(stream, this.imageMaxBytes);

      return {
        buffer,
        mimeType: thumbnail.mimeType,
        size: Number(thumbnail.size),
        cacheMaxAge: this.config.cacheMaxAgeSeconds,
        etag: paramsHash,
      };
    }

    this.logger.info({ fileId, paramsHash }, 'Generating new thumbnail');

    const { stream } = await this.storageService.downloadStream(fileS3Key);
    const originalBuffer = await this.readToBufferWithLimit(stream, this.imageMaxBytes);
    const thumbnailBuffer = await this.generateThumbnail(originalBuffer, width, height, quality);

    const thumbnailMimeType = format === 'webp' ? 'image/webp' : 'image/avif';
    const thumbnailS3Key = this.generateThumbnailS3Key(fileId, paramsHash, format);

    await this.storageService.uploadFile(thumbnailS3Key, thumbnailBuffer, thumbnailMimeType);

    thumbnail = await (this.prismaService as any).thumbnail.create({
      data: {
        fileId,
        width,
        height,
        quality,
        paramsHash,
        s3Key: thumbnailS3Key,
        s3Bucket: this.bucket,
        size: BigInt(thumbnailBuffer.length),
        mimeType: thumbnailMimeType,
        lastAccessedAt: new Date(),
      },
    });

    this.logger.info(
      {
        fileId,
        paramsHash,
        thumbnailId: thumbnail.id,
        size: thumbnailBuffer.length,
      },
      'Thumbnail generated and cached',
    );

    return {
      buffer: thumbnailBuffer,
      mimeType: thumbnailMimeType,
      size: thumbnailBuffer.length,
      cacheMaxAge: this.config.cacheMaxAgeSeconds,
      etag: paramsHash,
    };
  }

  private async generateThumbnail(
    buffer: Buffer,
    width: number,
    height: number,
    quality: number,
  ): Promise<Buffer> {
    return this.heavyTasksQueue.execute(async () => {
      try {
        const format = this.config.format;
        let pipeline = sharp(buffer).autoOrient().resize(width, height, {
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        });

        if (format === 'webp') {
          pipeline = pipeline.webp({
            quality,
            effort: this.config.effort,
          });
        } else {
          pipeline = pipeline.avif({
            quality,
            effort: this.config.effort,
          });
        }

        return await pipeline.toBuffer();
      } catch (error) {
        this.logger.error({ err: error }, 'Failed to generate thumbnail');
        throw new BadRequestException('Failed to generate thumbnail');
      }
    }, TaskPriority.THUMBNAIL_GENERATION);
  }

  private calculateParamsHash(
    width: number,
    height: number,
    quality: number,
    format: string,
  ): string {
    const hash = createHash('sha256');
    hash.update(`${width}x${height}q${quality}f${format}`);
    return hash.digest('hex');
  }

  private generateThumbnailS3Key(fileId: string, paramsHash: string, format: string): string {
    const ext = format === 'webp' ? 'webp' : 'avif';
    return `thumbs/${fileId}/${paramsHash}.${ext}`;
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }
}
