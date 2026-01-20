import {
  BadRequestException,
  ConflictException,
  forwardRef,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { FileStatus, OptimizationStatus } from '../../generated/prisma/enums.js';
import { ThumbnailParamsDto } from '../files/dto/thumbnail-params.dto.js';
import { FilesService } from '../files/files.service.js';
import { ImageProcessingClient } from '../image-processing/image-processing.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { UploadConfig } from '../../config/upload.config.js';

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
    private readonly imageProcessingClient: ImageProcessingClient,
  ) {
    this.config = this.configService.get<ThumbnailConfig>('thumbnail')!;
    this.bucket = this.configService.get<string>('storage.bucket')!;

    const uploadConfig = this.configService.get<UploadConfig>('upload')!;
    this.imageMaxBytes = uploadConfig.imageMaxBytesMb * 1024 * 1024;
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
    let file = await this.prismaService.file.findFirst({
      where: { id: fileId, status: FileStatus.ready },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const fileMimeType = file.mimeType || file.originalMimeType;
    if (!fileMimeType || !this.isImageMimeType(fileMimeType)) {
      throw new BadRequestException('File is not an image');
    }

    if (
      file.optimizationStatus === OptimizationStatus.pending ||
      file.optimizationStatus === OptimizationStatus.processing
    ) {
      throw new ConflictException('Image optimization is in progress');
    }

    if (file.optimizationStatus === OptimizationStatus.failed) {
      throw new BadRequestException(
        `Image optimization failed: ${file.optimizationError || 'Unknown error'}`,
      );
    }

    const fileS3Key = file.s3Key || file.originalS3Key;
    if (!fileS3Key) {
      throw new BadRequestException('File has no valid S3 key');
    }

    const width = Math.min(params.width, this.config.maxWidth);
    const height = Math.min(params.height, this.config.maxHeight);
    const fit = params.fit ?? 'inside';
    const format = this.config.format;
    const quality = params.quality ?? this.config.quality;
    const paramsHash = this.calculateParamsHash({ width, height, quality, format, fit });

    let thumbnail = await this.prismaService.thumbnail.findUnique({
      where: {
        fileId_paramsHash: {
          fileId,
          paramsHash,
        },
      },
    });

    if (thumbnail) {
      await this.prismaService.thumbnail.update({
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
    const thumbnailBuffer = await this.generateThumbnail({
      buffer: originalBuffer,
      mimeType: fileMimeType,
      width,
      height,
      quality,
      fit,
    });

    const thumbnailMimeType = format === 'webp' ? 'image/webp' : 'image/avif';
    const thumbnailS3Key = this.generateThumbnailS3Key(fileId, paramsHash, format);

    await this.storageService.uploadFile(thumbnailS3Key, thumbnailBuffer, thumbnailMimeType);

    thumbnail = await this.prismaService.thumbnail.create({
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

  private async generateThumbnail(params: {
    buffer: Buffer;
    mimeType: string;
    width: number;
    height: number;
    quality: number;
    fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  }): Promise<Buffer> {
    try {
      const format = this.config.format;

      const output: Record<string, any> = {
        format,
        quality: params.quality,
        effort: this.config.effort,
        stripMetadata: true,
      };

      const result = await this.imageProcessingClient.process({
        buffer: params.buffer,
        mimeType: params.mimeType,
        priority: 1,
        transform: {
          resize: {
            width: params.width,
            height: params.height,
            fit: params.fit,
            withoutEnlargement: true,
          },
          autoOrient: true,
        },
        output,
      });

      return result.buffer;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to generate thumbnail');
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException('Failed to generate thumbnail');
    }
  }

  private calculateParamsHash(params: {
    width: number;
    height: number;
    quality: number;
    format: string;
    fit: string;
  }): string {
    const hash = createHash('sha256');
    hash.update(
      `${params.width}x${params.height}q${params.quality}f${params.format}fit${params.fit}`,
    );
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
