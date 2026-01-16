import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ThumbnailParamsDto } from '../files/dto/thumbnail-params.dto.js';
import { FileStatus } from '../files/file-status.js';

interface ThumbnailConfig {
  enabled: boolean;
  format: 'webp' | 'avif';
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  cacheMaxAge: number;
  webp: {
    quality: number;
    effort: number;
  };
  avif: {
    quality: number;
    effort: number;
  };
}

export interface ThumbnailResult {
  buffer: Buffer;
  mimeType: string;
  size: number;
  cacheMaxAge: number;
}

@Injectable()
export class ThumbnailService {
  private readonly config: ThumbnailConfig;
  private readonly bucket: string;

  constructor(
    @InjectPinoLogger(ThumbnailService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {
    this.config = this.configService.get<ThumbnailConfig>('thumbnail')!;
    this.bucket = this.configService.get<string>('storage.bucket')!;
  }

  async getThumbnail(fileId: string, params: ThumbnailParamsDto): Promise<ThumbnailResult> {
    if (!this.config.enabled) {
      throw new BadRequestException('Thumbnail generation is disabled');
    }

    const file = await (this.prismaService as any).file.findFirst({
      where: { id: fileId, status: FileStatus.READY },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (!this.isImageMimeType(file.mimeType)) {
      throw new BadRequestException('File is not an image');
    }

    const width = Math.min(params.width, this.config.maxWidth);
    const height = Math.min(params.height, this.config.maxHeight);
    const format = this.config.format;
    const quality =
      params.quality ?? (format === 'webp' ? this.config.webp.quality : this.config.avif.quality);
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

      const buffer = await this.storageService.downloadFile(thumbnail.s3Key);

      return {
        buffer,
        mimeType: thumbnail.mimeType,
        size: Number(thumbnail.size),
        cacheMaxAge: this.config.cacheMaxAge,
      };
    }

    this.logger.info({ fileId, paramsHash }, 'Generating new thumbnail');

    const originalBuffer = await this.storageService.downloadFile(file.s3Key);
    const thumbnailBuffer = await this.generateThumbnail(originalBuffer, width, height, quality);

    const mimeType = format === 'webp' ? 'image/webp' : 'image/avif';
    const s3Key = this.generateThumbnailS3Key(fileId, paramsHash, format);

    await this.storageService.uploadFile(s3Key, thumbnailBuffer, mimeType);

    thumbnail = await (this.prismaService as any).thumbnail.create({
      data: {
        fileId,
        width,
        height,
        quality,
        paramsHash,
        s3Key,
        s3Bucket: this.bucket,
        size: BigInt(thumbnailBuffer.length),
        mimeType,
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
      mimeType,
      size: thumbnailBuffer.length,
      cacheMaxAge: this.config.cacheMaxAge,
    };
  }

  private async generateThumbnail(
    buffer: Buffer,
    width: number,
    height: number,
    quality: number,
  ): Promise<Buffer> {
    try {
      const format = this.config.format;
      let pipeline = sharp(buffer).autoOrient().resize(width, height, {
        fit: sharp.fit.inside,
        withoutEnlargement: true,
      });

      if (format === 'webp') {
        pipeline = pipeline.webp({
          quality,
          effort: this.config.webp.effort,
        });
      } else {
        pipeline = pipeline.avif({
          quality,
          effort: this.config.avif.effort,
        });
      }

      return await pipeline.toBuffer();
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to generate thumbnail');
      throw new BadRequestException('Failed to generate thumbnail');
    }
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
