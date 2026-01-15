import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { Transform, type Readable } from 'stream';
import { StorageService } from '../storage/storage.service.js';
import { ImageOptimizerService } from '../optimization/image-optimizer.service.js';
import { OptimizeParamsDto } from './dto/optimize-params.dto.js';
import { ListFilesDto } from './dto/list-files.dto.js';
import { FileResponseDto } from './dto/file-response.dto.js';
import { ListFilesResponseDto } from './dto/list-files-response.dto.js';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStatus } from './file-status.js';

export interface UploadFileParams {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  optimizeParams?: OptimizeParamsDto;
  metadata?: Record<string, any>;
}

function cryptoRandomId(): string {
  return randomUUID();
}

export interface DownloadFileResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  size: number;
}

export interface DownloadFileStreamResult {
  stream: Readable;
  filename: string;
  mimeType: string;
  size?: number;
  etag?: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly bucket: string;
  private readonly basePath: string;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly imageOptimizer: ImageOptimizerService,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.get<string>('storage.bucket')!;
    this.basePath = this.configService.get<string>('BASE_PATH') || '';
  }

  async uploadFileStream(params: {
    stream: Readable;
    filename: string;
    mimeType: string;
    optimizeParams?: OptimizeParamsDto;
    metadata?: Record<string, any>;
  }): Promise<FileResponseDto> {
    const { stream, filename, mimeType, optimizeParams, metadata } = params;

    if (optimizeParams) {
      throw new BadRequestException('Stream upload does not support optimization');
    }

    const tempKey = `tmp/${cryptoRandomId()}`;

    const file = await (this.prismaService as any).file.create({
      data: {
        filename,
        mimeType,
        size: null,
        originalSize: null,
        checksum: null,
        s3Key: tempKey,
        s3Bucket: this.bucket,
        status: FileStatus.UPLOADING,
        optimizationParams: null,
        metadata: metadata ?? null,
        uploadedAt: null,
      },
    });

    const hash = createHash('sha256');
    let size = 0;

    const hasher = new Transform({
      transform: (chunk, _encoding, callback) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        hash.update(buf);
        callback(null, buf);
      },
    });

    try {
      await this.storageService.uploadStream({
        key: tempKey,
        body: stream.pipe(hasher),
        mimeType,
      });

      const checksum = `sha256:${hash.digest('hex')}`;
      const finalKey = this.generateS3Key(checksum, mimeType);

      const existing = await (this.prismaService as any).file.findFirst({
        where: {
          checksum,
          mimeType,
          status: FileStatus.READY,
        },
      });

      if (existing) {
        await this.storageService.deleteFile(tempKey);
        await (this.prismaService as any).file.delete({
          where: { id: file.id },
        });
        return this.toResponseDto(existing);
      }

      await this.storageService.copyObject({
        sourceKey: tempKey,
        destinationKey: finalKey,
        contentType: mimeType,
      });
      await this.storageService.deleteFile(tempKey);

      const updated = await (this.prismaService as any).file.update({
        where: { id: file.id },
        data: {
          checksum,
          size: BigInt(size),
          s3Key: finalKey,
          status: FileStatus.READY,
          uploadedAt: new Date(),
        },
      });

      return this.toResponseDto(updated);
    } catch (error) {
      await (this.prismaService as any).file.update({
        where: { id: file.id },
        data: {
          status: FileStatus.FAILED,
        },
      });
      throw error;
    }
  }

  async uploadFile(params: UploadFileParams): Promise<FileResponseDto> {
    const { buffer, filename, mimeType, optimizeParams, metadata } = params;

    let processedBuffer = buffer;
    let processedMimeType = mimeType;
    let originalSize: number | null = null;

    if (optimizeParams) {
      const result = await this.imageOptimizer.optimizeImage(buffer, mimeType, optimizeParams);
      if (result.size < buffer.length) {
        processedBuffer = result.buffer;
        processedMimeType = result.format;
        originalSize = buffer.length;
        this.logger.log(`Image optimized: ${filename} (${buffer.length} -> ${result.size} bytes)`);
      }
    }

    const checksum = this.calculateChecksum(processedBuffer);
    const s3Key = this.generateS3Key(checksum, processedMimeType);

    const existing = await (this.prismaService as any).file.findFirst({
      where: {
        checksum,
        mimeType: processedMimeType,
        status: FileStatus.READY,
      },
    });

    if (existing) {
      return this.toResponseDto(existing);
    }

    const file = await (this.prismaService as any).file.create({
      data: {
        filename,
        mimeType: processedMimeType,
        size: BigInt(processedBuffer.length),
        originalSize: originalSize === null ? null : BigInt(originalSize),
        checksum,
        s3Key,
        s3Bucket: this.bucket,
        status: FileStatus.UPLOADING,
        optimizationParams: optimizeParams
          ? (optimizeParams as unknown as Record<string, any>)
          : null,
        metadata: metadata ?? null,
        uploadedAt: null,
      },
    });

    this.logger.log(`File record created with status=uploading: ${file.id}`);

    try {
      await this.storageService.uploadFile(s3Key, processedBuffer, processedMimeType);

      const updated = await (this.prismaService as any).file.update({
        where: { id: file.id },
        data: {
          status: FileStatus.READY,
          uploadedAt: new Date(),
        },
      });

      this.logger.log(`File upload completed: ${updated.id}`);

      return this.toResponseDto(updated);
    } catch (error) {
      this.logger.error(`Failed to upload file to S3: ${file.id}`, error);

      await (this.prismaService as any).file.update({
        where: { id: file.id },
        data: {
          status: FileStatus.FAILED,
        },
      });

      throw error;
    }
  }

  async getFileMetadata(id: string): Promise<FileResponseDto> {
    const file = await (this.prismaService as any).file.findFirst({
      where: { id, status: FileStatus.READY },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return this.toResponseDto(file);
  }

  async downloadFile(id: string): Promise<DownloadFileResult> {
    const file = await (this.prismaService as any).file.findUnique({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status === FileStatus.DELETED) {
      throw new GoneException('File has been deleted');
    }

    if (file.status !== FileStatus.READY) {
      throw new ConflictException('File is not ready for download');
    }

    const buffer = await this.storageService.downloadFile(file.s3Key);

    return {
      buffer,
      filename: file.filename,
      mimeType: file.mimeType,
      size: Number(file.size ?? 0n),
    };
  }

  async downloadFileStream(id: string): Promise<DownloadFileStreamResult> {
    const file = await (this.prismaService as any).file.findUnique({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status === FileStatus.DELETED) {
      throw new GoneException('File has been deleted');
    }

    if (file.status !== FileStatus.READY) {
      throw new ConflictException('File is not ready for download');
    }

    const { stream, etag, contentLength } = await this.storageService.downloadStream(file.s3Key);

    return {
      stream,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size ? Number(file.size) : contentLength,
      etag: (file.checksum ?? '').startsWith('sha256:')
        ? (file.checksum ?? '').replace('sha256:', '')
        : etag,
    };
  }

  async deleteFile(id: string): Promise<void> {
    const file = await (this.prismaService as any).file.findUnique({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status === FileStatus.DELETED || file.status === FileStatus.DELETING) {
      throw new ConflictException('File is already deleted or being deleted');
    }

    await (this.prismaService as any).file.update({
      where: { id },
      data: {
        status: FileStatus.DELETING,
        deletedAt: new Date(),
      },
    });

    this.logger.log(`File marked for deletion: ${id}`);

    try {
      await this.storageService.deleteFile(file.s3Key);

      await (this.prismaService as any).file.update({
        where: { id },
        data: {
          status: FileStatus.DELETED,
        },
      });

      this.logger.log(`File deleted successfully: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete file from S3: ${id}`, error);
      throw error;
    }
  }

  async listFiles(params: ListFilesDto): Promise<ListFilesResponseDto> {
    const { limit = 50, offset = 0, sortBy = 'uploadedAt', order = 'desc', q, mimeType } = params;

    const where: any = { status: FileStatus.READY };
    if (typeof q === 'string' && q.trim().length > 0) {
      where.filename = {
        contains: q.trim(),
        mode: 'insensitive',
      };
    }
    if (typeof mimeType === 'string' && mimeType.trim().length > 0) {
      where.mimeType = mimeType.trim();
    }
    const [items, total] = await (this.prismaService as any).$transaction([
      (this.prismaService as any).file.findMany({
        where,
        orderBy: {
          [sortBy]: order,
        },
        take: limit,
        skip: offset,
      }),
      (this.prismaService as any).file.count({ where }),
    ]);

    return {
      items: (items as Array<any>).map(item => this.toResponseDto(item)),
      total,
      limit,
      offset,
    };
  }

  private toResponseDto(file: {
    id: string;
    filename: string;
    mimeType: string;
    size: bigint | null;
    originalSize: bigint | null;
    checksum: string | null;
    uploadedAt: Date | null;
  }): FileResponseDto {
    const dto = plainToInstance(FileResponseDto, file, {
      excludeExtraneousValues: true,
    });

    dto.size = Number(file.size ?? 0n);
    dto.originalSize = file.originalSize === null ? undefined : Number(file.originalSize);
    dto.checksum = file.checksum ?? '';
    dto.uploadedAt = file.uploadedAt ?? new Date(0);

    dto.url = `${this.basePath}/api/v1/files/${file.id}/download`;

    return dto;
  }

  private calculateChecksum(buffer: Buffer): string {
    const hash = createHash('sha256');
    hash.update(buffer);
    return `sha256:${hash.digest('hex')}`;
  }

  private generateS3Key(checksum: string, mimeType: string): string {
    const hash = checksum.replace('sha256:', '');
    const extension = this.getExtensionFromMimeType(mimeType);
    const prefix = hash.substring(0, 2);
    const middle = hash.substring(2, 4);

    return `${prefix}/${middle}/${hash}${extension}`;
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/json': '.json',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
    };

    return mimeToExt[mimeType] || '';
  }
}
