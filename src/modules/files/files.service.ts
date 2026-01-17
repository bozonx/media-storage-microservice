import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createHash, randomUUID } from 'crypto';
import { Transform, type Readable } from 'stream';
import { StorageService } from '../storage/storage.service.js';
import { ImageOptimizerService } from '../optimization/image-optimizer.service.js';
import { CompressParamsDto } from './dto/compress-params.dto.js';
import { BulkDeleteFilesDto } from './dto/bulk-delete-files.dto.js';
import { ListFilesDto } from './dto/list-files.dto.js';
import { FileResponseDto } from './dto/file-response.dto.js';
import { ListFilesResponseDto } from './dto/list-files-response.dto.js';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStatus } from './file-status.js';
import { OptimizationStatus } from './optimization-status.js';
import { ExifService } from './exif.service.js';

function isPrismaKnownRequestError(error: unknown): error is {
  name: string;
  code: string;
} {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const e = error as Record<string, unknown>;
  return e.name === 'PrismaClientKnownRequestError' && typeof e.code === 'string';
}

/**
 * Parameters for uploading a file from an in-memory buffer.
 *
 * `compressParams` is supported only for image uploads.
 */
export interface UploadFileParams {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  compressParams?: CompressParamsDto;
  metadata?: Record<string, any>;
  appId?: string;
  userId?: string;
  purpose?: string;
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

/**
 * Result of a streaming download.
 *
 * `etag` can be used by the HTTP layer for conditional requests (If-None-Match / 304).
 * `isPartial` and `contentRange` support HTTP Range requests (206 Partial Content).
 */
export interface DownloadFileStreamResult {
  stream: Readable;
  filename: string;
  mimeType: string;
  size?: number;
  etag?: string;
  isPartial?: boolean;
  contentRange?: string;
}

@Injectable()
export class FilesService {
  private readonly bucket: string;
  private readonly basePath: string;
  private readonly optimizationWaitTimeout: number;
  private readonly forceCompression: boolean;
  private readonly imageMaxBytes: number;

  constructor(
    @InjectPinoLogger(FilesService.name)
    private readonly logger: PinoLogger,
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly imageOptimizer: ImageOptimizerService,
    private readonly configService: ConfigService,
    private readonly exifService: ExifService,
  ) {
    this.bucket = this.configService.get<string>('storage.bucket')!;
    this.basePath =
      this.configService.get<string>('app.basePath') ||
      this.configService.get<string>('BASE_PATH') ||
      '';
    this.optimizationWaitTimeout =
      this.configService.get<number>('heavyTasksQueue.timeoutMs') ?? 30000;
    this.forceCompression = this.configService.get<boolean>('compression.forceEnabled') ?? false;

    const parsedImageMaxBytesMb = Number.parseFloat(process.env.IMAGE_MAX_BYTES_MB ?? '');
    this.imageMaxBytes =
      Number.isFinite(parsedImageMaxBytesMb) && parsedImageMaxBytesMb > 0
        ? Math.floor(parsedImageMaxBytesMb * 1024 * 1024)
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

  /**
   * Uploads a file from a readable stream.
   *
   * The file is uploaded to a temporary key first and then promoted to a final key derived from
   * its SHA-256 checksum (deduplication).
   */
  async uploadFileStream(params: {
    stream: Readable;
    filename: string;
    mimeType: string;
    metadata?: Record<string, any>;
    appId?: string;
    userId?: string;
    purpose?: string;
  }): Promise<FileResponseDto> {
    const { stream, filename, mimeType, metadata, appId, userId, purpose } = params;

    const enforceImageLimit = mimeType.startsWith('image/');

    const needsOptimization = this.forceCompression && this.isImage(mimeType);
    const originalKey = needsOptimization
      ? `originals/${cryptoRandomId()}`
      : `tmp/${cryptoRandomId()}`;

    const file = await (this.prismaService as any).file.create({
      data: {
        filename,
        appId: appId ?? null,
        userId: userId ?? null,
        purpose: purpose ?? null,
        originalMimeType: needsOptimization ? mimeType : null,
        originalSize: null,
        originalChecksum: null,
        originalS3Key: needsOptimization ? originalKey : null,
        mimeType: needsOptimization ? null : mimeType,
        size: null,
        checksum: null,
        s3Key: needsOptimization ? '' : originalKey,
        s3Bucket: this.bucket,
        status: FileStatus.UPLOADING,
        optimizationStatus: needsOptimization ? OptimizationStatus.PENDING : null,
        optimizationParams: needsOptimization ? {} : null,
        metadata: metadata ?? null,
        uploadedAt: null,
      },
    });

    const hash = createHash('sha256');
    let size = 0;
    let hashFinalized = false;

    const hasher = new Transform({
      transform: (chunk, _encoding, callback) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (enforceImageLimit && size > this.imageMaxBytes) {
          callback(new BadRequestException('Image is too large'));
          return;
        }
        if (!hashFinalized) {
          hash.update(buf);
        }
        callback(null, buf);
      },
    });

    let tmpKeyToCleanup: string | null = originalKey;

    const onAbort = async () => {
      this.logger.warn({ fileId: file.id, key: originalKey }, 'Upload aborted by client');
      try {
        if (tmpKeyToCleanup) {
          await this.storageService.deleteFile(tmpKeyToCleanup);
        }
        await (this.prismaService as any).file.update({
          where: { id: file.id },
          data: {
            status: FileStatus.FAILED,
            statusChangedAt: new Date(),
          },
        });
      } catch (err) {
        this.logger.error({ err, fileId: file.id }, 'Failed to cleanup after abort');
      }
    };

    try {
      await this.storageService.uploadStream({
        key: originalKey,
        body: stream.pipe(hasher),
        mimeType,
        contentLength: undefined,
        onAbort,
      });

      hashFinalized = true;
      const checksum = `sha256:${hash.digest('hex')}`;

      if (needsOptimization) {
        const updated = await (this.prismaService as any).file.update({
          where: { id: file.id },
          data: {
            originalChecksum: checksum,
            originalSize: BigInt(size),
            status: FileStatus.READY,
            statusChangedAt: new Date(),
            uploadedAt: new Date(),
          },
        });

        tmpKeyToCleanup = null;

        this.logger.info(
          { fileId: file.id, needsOptimization: true },
          'File uploaded, optimization pending',
        );
        return this.toResponseDto(updated);
      }

      const finalKey = this.generateS3Key(checksum, mimeType);

      const existing = await (this.prismaService as any).file.findFirst({
        where: {
          checksum,
          mimeType,
          status: FileStatus.READY,
        },
      });

      if (existing) {
        this.logger.info(
          { fileId: file.id, existingFileId: existing.id, checksum },
          'File already exists (deduplication)',
        );

        await this.storageService.deleteFile(originalKey);
        tmpKeyToCleanup = null;

        await (this.prismaService as any).file.delete({
          where: { id: file.id },
        });
        return this.toResponseDto(existing);
      }

      await this.storageService.copyObject({
        sourceKey: originalKey,
        destinationKey: finalKey,
        contentType: mimeType,
      });

      await this.storageService.deleteFile(originalKey);
      tmpKeyToCleanup = null;

      const updated = await this.promoteUploadedFileToReady({
        fileId: file.id,
        checksum,
        size,
        finalKey,
        mimeType,
      });

      return this.toResponseDto(updated);
    } catch (error) {
      this.logger.error({ err: error, fileId: file.id }, 'File upload stream failed');

      try {
        await (this.prismaService as any).file.update({
          where: { id: file.id },
          data: {
            status: FileStatus.FAILED,
            statusChangedAt: new Date(),
          },
        });
      } catch (markError) {
        this.logger.error(
          { err: markError, fileId: file.id },
          'Failed to mark file as failed (file may have been deleted)',
        );
      }

      if (tmpKeyToCleanup) {
        try {
          await this.storageService.deleteFile(tmpKeyToCleanup);
          this.logger.info(
            { fileId: file.id, key: tmpKeyToCleanup },
            'Cleaned up orphaned tmp/original file after upload failure',
          );
        } catch (cleanupError) {
          this.logger.error(
            { err: cleanupError, fileId: file.id, key: tmpKeyToCleanup },
            'Failed to cleanup orphaned tmp/original file',
          );
        }
      }

      throw error;
    }
  }

  /**
   * Uploads a file from a buffer.
   *
   * If `compressParams` is provided or force compression is enabled, the image will be compressed.
   * The resulting content is then deduplicated by checksum.
   */
  async uploadFile(params: UploadFileParams): Promise<FileResponseDto> {
    const { buffer, filename, mimeType, compressParams, metadata, appId, userId, purpose } = params;

    if (mimeType.startsWith('image/') && buffer.length > this.imageMaxBytes) {
      throw new BadRequestException('Image is too large');
    }

    let processedBuffer = buffer;
    let processedMimeType = mimeType;
    let originalSize: number | null = null;

    const forceCompress = this.configService.get<boolean>('compression.forceEnabled') ?? false;
    const shouldCompress = forceCompress || (compressParams && this.isImage(mimeType));

    if (shouldCompress && this.isImage(mimeType)) {
      const result = await this.imageOptimizer.compressImage(
        buffer,
        mimeType,
        compressParams ?? {},
        forceCompress,
      );
      if (result.size < buffer.length) {
        processedBuffer = result.buffer;
        processedMimeType = result.format;
        originalSize = buffer.length;
        this.logger.info(
          {
            filename,
            beforeBytes: buffer.length,
            afterBytes: result.size,
            savings: `${((1 - result.size / buffer.length) * 100).toFixed(1)}%`,
          },
          'Image compressed',
        );
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

    let file: any;
    try {
      file = await (this.prismaService as any).file.create({
        data: {
          filename,
          appId: appId ?? null,
          userId: userId ?? null,
          purpose: purpose ?? null,
          mimeType: processedMimeType,
          size: BigInt(processedBuffer.length),
          originalSize: originalSize === null ? null : BigInt(originalSize),
          checksum,
          s3Key,
          s3Bucket: this.bucket,
          status: FileStatus.UPLOADING,
          optimizationParams: compressParams
            ? (compressParams as unknown as Record<string, any>)
            : null,
          metadata: metadata ?? null,
          uploadedAt: null,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        const dedup = await this.findReadyByChecksum({ checksum, mimeType: processedMimeType });
        if (dedup) {
          return this.toResponseDto(dedup);
        }
      }
      throw error;
    }

    this.logger.info({ fileId: file.id }, 'File record created with status=uploading');

    try {
      await this.storageService.uploadFile(s3Key, processedBuffer, processedMimeType);

      const updated = await (this.prismaService as any).file.update({
        where: { id: file.id },
        data: {
          status: FileStatus.READY,
          statusChangedAt: new Date(),
          uploadedAt: new Date(),
        },
      });

      this.logger.info({ fileId: updated.id }, 'File upload completed');

      return this.toResponseDto(updated);
    } catch (error) {
      this.logger.error({ err: error, fileId: file.id, s3Key }, 'Failed to upload file to storage');

      await (this.prismaService as any).file.update({
        where: { id: file.id },
        data: {
          status: FileStatus.FAILED,
          statusChangedAt: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * Returns metadata for a READY file.
   *
   * @throws {NotFoundException} If the file does not exist, is not READY, or is soft-deleted.
   */
  async getFileMetadata(id: string): Promise<FileResponseDto> {
    const file = await (this.prismaService as any).file.findFirst({
      where: { id, status: FileStatus.READY, deletedAt: null },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return this.toResponseDto(file);
  }

  async getFileExif(id: string): Promise<Record<string, any> | undefined> {
    const file = await (this.prismaService as any).file.findFirst({
      where: { id, status: FileStatus.READY, deletedAt: null },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const mimeType: string =
      typeof file.originalMimeType === 'string' && file.originalMimeType.length > 0
        ? file.originalMimeType
        : file.mimeType;

    const key: string =
      typeof file.originalS3Key === 'string' && file.originalS3Key.length > 0
        ? file.originalS3Key
        : file.s3Key;

    return this.exifService.tryExtractFromStorageKey({ key, mimeType });
  }

  /**
   * Downloads file as a stream.
   *
   * Always returns optimized file if optimization was requested.
   * ETag is derived from the stored checksum (sha256) for cache consistency.
   *
   * @param id File ID
   * @param rangeHeader Optional Range header for partial content requests
   * @throws {NotFoundException} If the file does not exist or is soft-deleted.
   * @throws {GoneException} If the file was deleted.
   * @throws {ConflictException} If the file is not READY or optimization failed.
   */
  async downloadFileStream(id: string, rangeHeader?: string): Promise<DownloadFileStreamResult> {
    let file = await (this.prismaService as any).file.findUnique({
      where: { id },
    });

    if (!file || file.deletedAt) {
      throw new NotFoundException('File not found');
    }

    if (file.status === FileStatus.DELETED) {
      throw new GoneException('File has been deleted');
    }

    if (file.status !== FileStatus.READY) {
      throw new ConflictException('File is not ready for download');
    }

    if (file.optimizationStatus === OptimizationStatus.FAILED) {
      throw new ConflictException('Image optimization failed');
    }

    if (
      file.optimizationStatus === OptimizationStatus.PENDING ||
      file.optimizationStatus === OptimizationStatus.PROCESSING
    ) {
      file = await this.ensureOptimized(id);
    }

    const s3Key = file.s3Key;
    if (!s3Key) {
      throw new ConflictException('File has no valid S3 key');
    }

    const result = await this.storageService.downloadStreamWithRange({
      key: s3Key,
      range: rangeHeader,
    });

    const etag = (file.checksum ?? '').startsWith('sha256:')
      ? (file.checksum ?? '').replace('sha256:', '')
      : undefined;

    return {
      stream: result.stream,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size ? Number(file.size) : result.contentLength,
      etag,
      isPartial: result.isPartial,
      contentRange: result.contentRange,
    };
  }

  /**
   * Soft deletes a file by marking it with deletedAt timestamp.
   *
   * Physical deletion from storage is handled by the cleanup service,
   * which ensures deduplication is respected (only deletes when no other files reference the same blob).
   *
   * @throws {NotFoundException} If the file does not exist.
   */
  async deleteFile(id: string): Promise<void> {
    const file = await (this.prismaService as any).file.findUnique({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.deletedAt) {
      this.logger.info({ fileId: id }, 'File already marked as deleted (idempotent)');
      return;
    }

    await (this.prismaService as any).file.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    this.logger.info({ fileId: id }, 'File marked for deletion (soft delete)');
  }

  async bulkDeleteFiles(params: BulkDeleteFilesDto): Promise<{ matched: number; deleted: number }> {
    const appId = typeof params.appId === 'string' ? params.appId.trim() : '';
    const userId = typeof params.userId === 'string' ? params.userId.trim() : '';
    const purpose = typeof params.purpose === 'string' ? params.purpose.trim() : '';

    if (appId.length === 0 && userId.length === 0 && purpose.length === 0) {
      throw new BadRequestException('At least one tag filter is required: appId, userId, purpose');
    }

    const limit =
      typeof params.limit === 'number' && Number.isFinite(params.limit) ? params.limit : 1000;
    const dryRun = Boolean(params.dryRun);

    const where: any = {
      status: FileStatus.READY,
      deletedAt: null,
    };
    if (appId.length > 0) {
      where.appId = appId;
    }
    if (userId.length > 0) {
      where.userId = userId;
    }
    if (purpose.length > 0) {
      where.purpose = purpose;
    }

    const candidates = (await (this.prismaService as any).file.findMany({
      where,
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
      select: { id: true },
    })) as Array<{ id: string }>;

    if (candidates.length === 0) {
      return { matched: 0, deleted: 0 };
    }

    if (dryRun) {
      return { matched: candidates.length, deleted: 0 };
    }

    const ids = candidates.map(v => v.id);
    const updated = await (this.prismaService as any).file.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const deleted = updated?.count ?? 0;

    this.logger.info(
      {
        matched: candidates.length,
        deleted,
        appId: appId || undefined,
        userId: userId || undefined,
        purpose: purpose || undefined,
      },
      'Bulk delete completed (soft delete)',
    );

    return { matched: candidates.length, deleted };
  }

  /**
   * Lists READY files with optional search by filename and filter by MIME type.
   * Excludes soft-deleted files.
   */
  async listFiles(params: ListFilesDto): Promise<ListFilesResponseDto> {
    const {
      limit = 50,
      offset = 0,
      sortBy = 'uploadedAt',
      order = 'desc',
      q,
      mimeType,
      appId,
      userId,
      purpose,
    } = params;

    const where: any = { status: FileStatus.READY, deletedAt: null };
    if (typeof q === 'string' && q.trim().length > 0) {
      where.filename = {
        contains: q.trim(),
        mode: 'insensitive',
      };
    }
    if (typeof mimeType === 'string' && mimeType.trim().length > 0) {
      where.mimeType = mimeType.trim();
    }
    if (typeof appId === 'string' && appId.trim().length > 0) {
      where.appId = appId.trim();
    }
    if (typeof userId === 'string' && userId.trim().length > 0) {
      where.userId = userId.trim();
    }
    if (typeof purpose === 'string' && purpose.trim().length > 0) {
      where.purpose = purpose.trim();
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
    appId?: string | null;
    userId?: string | null;
    purpose?: string | null;
    originalMimeType?: string | null;
    mimeType: string;
    size: bigint | null;
    originalSize: bigint | null;
    checksum: string | null;
    uploadedAt: Date | null;
    statusChangedAt?: Date | null;
    status?: FileStatus | null;
    metadata?: Record<string, any> | null;
    optimizationStatus?: OptimizationStatus | null;
    optimizationError?: string | null;
  }): FileResponseDto {
    const dto = plainToInstance(FileResponseDto, file, {
      excludeExtraneousValues: true,
    });

    dto.size = Number(file.size ?? 0n);
    dto.originalSize = file.originalSize === null ? undefined : Number(file.originalSize);
    dto.checksum = file.checksum ?? '';
    dto.uploadedAt = file.uploadedAt ?? new Date(0);
    dto.statusChangedAt = file.statusChangedAt ?? new Date(0);
    dto.appId = file.appId ?? undefined;
    dto.userId = file.userId ?? undefined;
    dto.purpose = file.purpose ?? undefined;

    dto.status = file.status ?? undefined;
    dto.metadata = file.metadata ?? undefined;

    dto.originalMimeType = file.originalMimeType ?? undefined;
    dto.optimizationStatus = file.optimizationStatus ?? undefined;
    dto.optimizationError = file.optimizationError ?? undefined;

    dto.url = `${this.basePath ? `/${this.basePath}` : ''}/api/v1/files/${file.id}/download`;

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
      'image/avif': '.avif',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/json': '.json',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
    };

    return mimeToExt[mimeType] || '';
  }

  private isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return isPrismaKnownRequestError(error) && error.code === 'P2002';
  }

  private async findReadyByChecksum(params: {
    checksum: string;
    mimeType: string;
  }): Promise<any | null> {
    const { checksum, mimeType } = params;
    return (this.prismaService as any).file.findFirst({
      where: {
        checksum,
        mimeType,
        status: FileStatus.READY,
      },
    });
  }

  private async findAnyByChecksum(params: {
    checksum: string;
    mimeType: string;
  }): Promise<any | null> {
    const { checksum, mimeType } = params;
    return (this.prismaService as any).file.findFirst({
      where: {
        checksum,
        mimeType,
      },
      select: {
        id: true,
        status: true,
        deletedAt: true,
      },
    });
  }

  private async promoteUploadedFileToReady(params: {
    fileId: string;
    checksum: string;
    size: number;
    finalKey: string;
    mimeType: string;
  }): Promise<any> {
    const { fileId, checksum, size, finalKey, mimeType } = params;

    try {
      return await (this.prismaService as any).file.update({
        where: { id: fileId },
        data: {
          checksum,
          size: BigInt(size),
          s3Key: finalKey,
          status: FileStatus.READY,
          statusChangedAt: new Date(),
          uploadedAt: new Date(),
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }

      const existing = await this.findReadyByChecksum({
        checksum,
        mimeType,
      });
      if (!existing) {
        const anyExisting = await this.findAnyByChecksum({ checksum, mimeType });
        this.logger.warn(
          {
            fileId,
            checksum,
            mimeType,
            existingFileId: anyExisting?.id,
            existingStatus: anyExisting?.status,
          },
          'Unique constraint violation but READY file was not found',
        );
        throw new ConflictException('File with the same checksum already exists');
      }

      await (this.prismaService as any).file.delete({ where: { id: fileId } });
      return existing;
    }
  }

  private async ensureOptimized(fileId: string): Promise<any> {
    const updated = await (this.prismaService as any).file.updateMany({
      where: {
        id: fileId,
        optimizationStatus: OptimizationStatus.PENDING,
      },
      data: {
        optimizationStatus: OptimizationStatus.PROCESSING,
        optimizationStartedAt: new Date(),
      },
    });

    if (updated.count > 0) {
      void this.optimizeImage(fileId).catch(err => {
        this.logger.error({ err, fileId }, 'Background optimization failed');
      });
    }

    const startTime = Date.now();
    while (Date.now() - startTime < this.optimizationWaitTimeout) {
      const file = await (this.prismaService as any).file.findUnique({
        where: { id: fileId },
      });

      if (!file) {
        throw new NotFoundException('File not found');
      }

      if (file.optimizationStatus === OptimizationStatus.READY) {
        return file;
      }

      if (file.optimizationStatus === OptimizationStatus.FAILED) {
        throw new ConflictException('Image optimization failed');
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    throw new ConflictException('Image optimization timeout');
  }

  private async optimizeImage(fileId: string): Promise<void> {
    let originalS3KeyToCleanup: string | null = null;

    try {
      const file = await (this.prismaService as any).file.findUnique({
        where: { id: fileId },
      });

      if (!file || !file.originalS3Key || !file.originalMimeType) {
        throw new Error('File or original not found');
      }

      originalS3KeyToCleanup = file.originalS3Key;

      this.logger.info({ fileId }, 'Starting image optimization');

      const { stream } = await this.storageService.downloadStream(file.originalS3Key);
      const originalBuffer = await this.readToBufferWithLimit(stream, this.imageMaxBytes);

      const result = await this.imageOptimizer.compressImage(
        originalBuffer,
        file.originalMimeType,
        {},
        true,
      );

      const checksum = this.calculateChecksum(result.buffer);
      const finalKey = this.generateS3Key(checksum, result.format);

      const existingOptimized = await this.findReadyByChecksum({
        checksum,
        mimeType: result.format,
      });

      if (existingOptimized) {
        this.logger.info(
          { fileId, existingFileId: existingOptimized.id, checksum },
          'Optimized content already exists (deduplication)',
        );

        await (this.prismaService as any).file.delete({ where: { id: fileId } });
        await this.storageService.deleteFile(file.originalS3Key);

        this.logger.info(
          { fileId, dedupedToFileId: existingOptimized.id },
          'File deduplicated during optimization',
        );
        return;
      }

      await this.storageService.uploadFile(finalKey, result.buffer, result.format);

      try {
        await (this.prismaService as any).file.update({
          where: { id: fileId },
          data: {
            s3Key: finalKey,
            mimeType: result.format,
            size: BigInt(result.size),
            checksum,
            optimizationStatus: OptimizationStatus.READY,
            optimizationCompletedAt: new Date(),
          },
        });
      } catch (updateError) {
        if (this.isUniqueConstraintViolation(updateError)) {
          this.logger.warn(
            { fileId, checksum },
            'Race condition during optimization: duplicate checksum detected',
          );

          const raceExisting = await this.findReadyByChecksum({
            checksum,
            mimeType: result.format,
          });

          if (raceExisting) {
            await (this.prismaService as any).file.delete({ where: { id: fileId } });
            await this.storageService.deleteFile(file.originalS3Key);

            this.logger.info(
              { fileId, dedupedToFileId: raceExisting.id },
              'File deduplicated after race condition',
            );
            return;
          }
        }
        throw updateError;
      }

      await this.storageService.deleteFile(file.originalS3Key);
      originalS3KeyToCleanup = null;

      this.logger.info(
        {
          fileId,
          originalSize: originalBuffer.length,
          optimizedSize: result.size,
          savings: `${((1 - result.size / originalBuffer.length) * 100).toFixed(1)}%`,
        },
        'Image optimization completed',
      );
    } catch (error) {
      this.logger.error({ err: error, fileId }, 'Image optimization failed');

      try {
        await (this.prismaService as any).file.update({
          where: { id: fileId },
          data: {
            optimizationStatus: OptimizationStatus.FAILED,
            optimizationError: error instanceof Error ? error.message : 'Unknown error',
            optimizationCompletedAt: new Date(),
          },
        });
      } catch (markError) {
        this.logger.error(
          { err: markError, fileId },
          'Failed to mark optimization as failed (file may have been deleted)',
        );
      }

      if (originalS3KeyToCleanup) {
        try {
          await this.storageService.deleteFile(originalS3KeyToCleanup);
          this.logger.info(
            { fileId, key: originalS3KeyToCleanup },
            'Cleaned up orphaned original after optimization failure',
          );
        } catch (cleanupError) {
          this.logger.error(
            { err: cleanupError, fileId, key: originalS3KeyToCleanup },
            'Failed to cleanup orphaned original',
          );
        }
      }

      throw error;
    }
  }
}
