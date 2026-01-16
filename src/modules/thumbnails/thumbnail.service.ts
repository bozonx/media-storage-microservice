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
  defaultQuality: number;
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  cacheMaxAge: number;
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

    const quality = params.quality ?? this.config.defaultQuality;
    const paramsHash = this.calculateParamsHash(params.width, params.height, quality);

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
    const thumbnailBuffer = await this.generateThumbnail(
      originalBuffer,
      params.width,
      params.height,
      quality,
    );

    const s3Key = this.generateThumbnailS3Key(fileId, paramsHash);

    await this.storageService.uploadFile(s3Key, thumbnailBuffer, 'image/webp');

    thumbnail = await (this.prismaService as any).thumbnail.create({
      data: {
        fileId,
        width: params.width,
        height: params.height,
        quality,
        paramsHash,
        s3Key,
        s3Bucket: this.bucket,
        size: BigInt(thumbnailBuffer.length),
        mimeType: 'image/webp',
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
      mimeType: 'image/webp',
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
      const pipeline = sharp(buffer)
        .rotate()
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality,
          effort: 4,
        });

      return await pipeline.toBuffer();
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to generate thumbnail');
      throw new BadRequestException('Failed to generate thumbnail');
    }
  }

  private calculateParamsHash(width: number, height: number, quality: number): string {
    const hash = createHash('sha256');
    hash.update(`${width}x${height}q${quality}`);
    return hash.digest('hex');
  }

  private generateThumbnailS3Key(fileId: string, paramsHash: string): string {
    return `thumbs/${fileId}/${paramsHash}.webp`;
  }

  private isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }
}
