import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  RequestTimeoutException,
  ServiceUnavailableException,
  BadGatewayException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Readable, Transform } from 'stream';

import { FileStatus, OptimizationStatus } from '../../generated/prisma/enums.js';
import { ImageOptimizerService } from '../optimization/image-optimizer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { BulkDeleteFilesDto } from './dto/bulk-delete-files.dto.js';
import { CompressParamsDto } from './dto/compress-params.dto.js';
import { FileResponseDto } from './dto/file-response.dto.js';
import { ListFilesDto } from './dto/list-files.dto.js';
import { ListFilesResponseDto } from './dto/list-files-response.dto.js';
import { ProblemFileDto } from './dto/problem-file.dto.js';
import { ExifService } from './exif.service.js';
import { FileProblemDetector } from './file-problem.detector.js';
import { FilesMapper } from './files.mapper.js';
import type { UploadConfig } from '../../config/upload.config.js';

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
  private readonly stuckUploadTimeoutMs: number;
  private readonly stuckDeleteTimeoutMs: number;
  private readonly stuckOptimizationTimeoutMs: number;

  constructor(
    @InjectPinoLogger(FilesService.name)
    private readonly logger: PinoLogger,
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly imageOptimizer: ImageOptimizerService,
    private readonly configService: ConfigService,
    private readonly exifService: ExifService,
    private readonly mapper: FilesMapper,
    private readonly detector: FileProblemDetector,
  ) {
    this.bucket = this.configService.get<string>('storage.bucket')!;
    this.basePath =
      this.configService.get<string>('app.basePath') ||
      this.configService.get<string>('BASE_PATH') ||
      '';
    this.optimizationWaitTimeout =
      this.configService.get<number>('imageProcessing.requestTimeoutMs') ?? 60000;
    this.forceCompression = this.configService.get<boolean>('compression.forceEnabled') ?? false;

    this.stuckUploadTimeoutMs =
      this.configService.get<number>('cleanup.stuckUploadTimeoutMs') ?? 30 * 60 * 1000;
    this.stuckDeleteTimeoutMs =
      this.configService.get<number>('cleanup.stuckDeleteTimeoutMs') ?? 30 * 60 * 1000;
    this.stuckOptimizationTimeoutMs =
      this.configService.get<number>('cleanup.stuckOptimizationTimeoutMs') ?? 30 * 60 * 1000;

    const uploadConfig = this.configService.get<UploadConfig>('upload')!;
    this.imageMaxBytes = uploadConfig.imageMaxBytesMb * 1024 * 1024;
  }

  // --- Public Upload API ---

  async uploadFileStream(params: {
    stream: Readable;
    filename: string;
    mimeType: string;
    compressParams?: CompressParamsDto;
    metadata?: Record<string, any>;
    appId?: string;
    userId?: string;
    purpose?: string;
  }): Promise<FileResponseDto> {
    const { stream, filename, mimeType, compressParams, metadata, appId, userId, purpose } = params;
    const hasParams = compressParams && Object.keys(compressParams).length > 0;
    const wantsOptimization =
      this.isImage(mimeType) && (this.forceCompression || hasParams);
    const originalKey = wantsOptimization ? `originals/${randomUUID()}` : `tmp/${randomUUID()}`;

    const file = await this.prismaService.file.create({
      data: {
        filename,
        appId: appId ?? null,
        userId: userId ?? null,
        purpose: purpose ?? null,
        originalMimeType: wantsOptimization ? mimeType : null,
        originalS3Key: wantsOptimization ? originalKey : null,
        mimeType,
        s3Key: wantsOptimization ? '' : originalKey,
        s3Bucket: this.bucket,
        status: FileStatus.uploading,
        optimizationStatus: wantsOptimization ? OptimizationStatus.pending : null,
        optimizationParams: wantsOptimization
          ? ((this.forceCompression ? {} : (compressParams ?? {})) as any)
          : null,
        metadata: (metadata ?? null) as any,
      },
    });

    const { checksum, size, hashFinalized } = await (async () => {
      if (wantsOptimization) {
        // Fail-fast: check if image processing service is available before uploading to S3
        await this.imageOptimizer.validateAvailability();
      }
      return this.performStreamUpload(stream, originalKey, mimeType, file.id);
    })();

    if (wantsOptimization) {
      const updated = await this.prismaService.file.update({
        where: { id: file.id },
        data: {
          originalChecksum: checksum,
          originalSize: BigInt(size),
          status: FileStatus.ready,
          statusChangedAt: new Date(),
          uploadedAt: new Date(),
        },
      });

      this.triggerOptimizationIfPending(updated.id);
      const exif = await this.extractAndSaveExif(updated);
      return this.mapper.toResponseDto({ ...updated, exif });
    }

    const finalKey = this.generateS3Key(checksum, mimeType);
    const existing = await this.findReadyByChecksum({ checksum, mimeType });

    if (existing) {
      await this.storageService.deleteFile(originalKey);
      await this.prismaService.file.delete({ where: { id: file.id } });
      return this.mapper.toResponseDto(existing);
    }

    await this.storageService.copyObject({
      sourceKey: originalKey,
      destinationKey: finalKey,
      contentType: mimeType,
    });
    await this.storageService.deleteFile(originalKey);

    const updated = await this.promoteUploadedFileToReady({
      fileId: file.id,
      checksum,
      size,
      finalKey,
      mimeType,
    });

    const exif = await this.extractAndSaveExif(updated);
    return this.mapper.toResponseDto({ ...updated, exif });
  }

  async uploadFile(params: UploadFileParams): Promise<FileResponseDto> {
    const { buffer, filename, mimeType, compressParams, metadata, appId, userId, purpose } = params;
    const stream = (await import('stream')).Readable.from([buffer]);
    return this.uploadFileStream({
      stream,
      filename,
      mimeType,
      compressParams,
      metadata,
      appId,
      userId,
      purpose,
    });
  }

  // --- Retrieval API ---

  async getFileMetadata(id: string): Promise<FileResponseDto> {
    const file = await this.prismaService.file.findFirst({
      where: { id, status: FileStatus.ready, deletedAt: null },
    });

    if (!file) throw new NotFoundException('File not found');
    return this.mapper.toResponseDto(file);
  }

  async getFileExif(id: string): Promise<Record<string, any> | undefined> {
    const file = await this.prismaService.file.findFirst({
      where: { id, status: FileStatus.ready, deletedAt: null },
    });

    if (!file) throw new NotFoundException('File not found');
    if (file.exif && typeof file.exif === 'object' && Object.keys(file.exif).length > 0) {
      return file.exif as Record<string, any>;
    }

    return this.extractAndSaveExif(file);
  }

  async downloadFileStream(id: string, rangeHeader?: string): Promise<DownloadFileStreamResult> {
    let file = await this.prismaService.file.findUnique({ where: { id } });

    if (!file || file.deletedAt) throw new NotFoundException('File not found');
    if (file.status === FileStatus.deleted) throw new GoneException('File has been deleted');

    // Check optimization error first to provide more context than just "File not ready"
    if (file.optimizationStatus === OptimizationStatus.failed) {
      throw new ConflictException(
        `Image optimization failed: ${file.optimizationError || 'Unknown error'}`,
      );
    }

    if (file.status !== FileStatus.ready)
      throw new ConflictException('File is not ready for download');

    if (
      file.optimizationStatus === OptimizationStatus.pending ||
      file.optimizationStatus === OptimizationStatus.processing
    ) {
      file = await this.ensureOptimized(id);
    }

    if (!file?.s3Key) throw new ConflictException('File has no valid S3 key');

    const result = await this.storageService.downloadStreamWithRange({
      key: file.s3Key,
      range: rangeHeader,
    });
    const etag = (file.checksum ?? '').startsWith('sha256:')
      ? file.checksum!.replace('sha256:', '')
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
   * Reprocesses an existing image with new optimization settings.
   *
   * Creates a new file record and deletes the old one upon success.
   * If a duplicate file already exists, it deletes the current file and returns the existing one.
   *
   * @param id - The ID of the file to reprocess
   * @param params - New compression/optimization parameters
   * @returns Metadata of the new (or existing duplicate) file
   */
  async reprocessFile(id: string, params: CompressParamsDto): Promise<FileResponseDto> {
    const file = await this.prismaService.file.findUnique({ where: { id, deletedAt: null } });
    if (!file) throw new NotFoundException('File not found');
    if (file.status !== FileStatus.ready) {
      throw new ConflictException('File is not ready for reprocessing');
    }

    const mimeType = file.originalMimeType || file.mimeType;
    if (!this.isImage(mimeType)) {
      throw new BadRequestException('Only images can be reprocessed');
    }

    const hasParams = params && Object.keys(params).length > 0;
    if (!hasParams && !this.forceCompression) {
      throw new BadRequestException('Optimization parameters are required for reprocessing');
    }

    // If the file was successfully optimized, the original is temporary and already deleted.
    // In that case, we must use the current s3Key as the source.
    // Otherwise (if optimization failed or wasn't requested), we prefer originalS3Key if it exists.
    const sourceKey =
      file.optimizationStatus === OptimizationStatus.ready
        ? file.s3Key
        : file.originalS3Key || file.s3Key;

    if (!sourceKey) {
      throw new ConflictException('No source key found for reprocessing');
    }

    try {
      const { stream } = await this.storageService.downloadStream(sourceKey);
      const buffer = await this.readToBufferWithLimit(stream, this.imageMaxBytes);

      const result = await this.imageOptimizer.compressImage(
        buffer,
        mimeType,
        params,
        false, // forceCompress=false because we want to use provided params
      );

      const checksum = this.calculateChecksum(result.buffer);
      const existing = await this.findReadyByChecksum({ checksum, mimeType: result.format });

      if (existing) {
        if (existing.id !== id) {
          await this.deleteFile(id);
        }
        return this.mapper.toResponseDto(existing);
      }

      const finalKey = this.generateS3Key(checksum, result.format);
      await this.storageService.uploadFile(finalKey, result.buffer, result.format);

      // Create a new file record (deduplication handled above)
      const newFile = await this.prismaService.file.create({
        data: {
          filename: file.filename, // keep same filename
          appId: file.appId,
          userId: file.userId,
          purpose: file.purpose,
          originalMimeType: mimeType,
          originalS3Key: file.originalS3Key || file.s3Key, // carry over original source
          originalChecksum: file.originalChecksum || file.checksum,
          originalSize: file.originalSize || file.size,
          mimeType: result.format,
          s3Key: finalKey,
          checksum,
          size: BigInt(result.size),
          s3Bucket: this.bucket,
          status: FileStatus.ready,
          optimizationStatus: OptimizationStatus.ready,
          optimizationParams: params as any,
          optimizationCompletedAt: new Date(),
          uploadedAt: new Date(),
          statusChangedAt: new Date(),
          metadata: (file.metadata ?? null) as any,
        },
      });

      await this.deleteFile(id);

      const exif = await this.extractAndSaveExif(newFile);
      return this.mapper.toResponseDto({ ...newFile, exif });
    } catch (err) {
      this.logger.error({ err, fileId: id }, 'Reprocessing failed');
      if (
        err instanceof BadRequestException ||
        err instanceof ConflictException ||
        err instanceof ServiceUnavailableException ||
        err instanceof BadGatewayException ||
        err instanceof GatewayTimeoutException
      ) {
        throw err;
      }
      throw new InternalServerErrorException('Reprocessing failed');
    }
  }

  // --- Delete API ---

  async deleteFile(id: string): Promise<void> {
    const file = await this.prismaService.file.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    if (file.deletedAt) return;

    await this.prismaService.file.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async bulkDeleteFiles(params: BulkDeleteFilesDto): Promise<{ matched: number; deleted: number }> {
    const { appId, userId, purpose, limit = 1000, dryRun } = params;
    if (!appId?.trim() && !userId?.trim() && !purpose?.trim()) {
      throw new BadRequestException('At least one tag filter is required');
    }

    const where: any = { status: FileStatus.ready, deletedAt: null };
    if (appId) where.appId = appId.trim();
    if (userId) where.userId = userId.trim();
    if (purpose) where.purpose = purpose.trim();

    const candidates = await this.prismaService.file.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    if (candidates.length === 0 || dryRun) return { matched: candidates.length, deleted: 0 };

    const ids = candidates.map(v => v.id);
    const updated = await this.prismaService.file.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return { matched: candidates.length, deleted: updated.count };
  }

  // --- Listing/Audit API ---

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

    const where: any = { status: FileStatus.ready, deletedAt: null };
    if (q?.trim()) where.filename = { contains: q.trim(), mode: 'insensitive' };
    if (mimeType?.trim()) where.mimeType = mimeType.trim();
    if (appId?.trim()) where.appId = appId.trim();
    if (userId?.trim()) where.userId = userId.trim();
    if (purpose?.trim()) where.purpose = purpose.trim();

    const [items, total] = await this.prismaService.$transaction([
      this.prismaService.file.findMany({
        where,
        orderBy: { [sortBy]: order },
        take: limit,
        skip: offset,
      }),
      this.prismaService.file.count({ where }),
    ]);

    return {
      items: items.map(item => this.mapper.toResponseDto(item)),
      total,
      limit,
      offset,
    };
  }

  async listProblemFiles(params: { limit?: number }): Promise<{ items: ProblemFileDto[] }> {
    const limit = params.limit ?? 10;
    const now = Date.now();
    const thresholds = {
      stuckUploadingAt: new Date(now - this.stuckUploadTimeoutMs),
      stuckDeletingAt: new Date(now - this.stuckDeleteTimeoutMs),
      stuckOptimizationAt: new Date(now - this.stuckOptimizationTimeoutMs),
    };

    const candidates = await this.prismaService.file.findMany({
      where: {
        OR: [
          { status: FileStatus.failed },
          { status: FileStatus.missing },
          { status: FileStatus.uploading, statusChangedAt: { lt: thresholds.stuckUploadingAt } },
          { status: FileStatus.deleting, statusChangedAt: { lt: thresholds.stuckDeletingAt } },
          { optimizationStatus: OptimizationStatus.failed },
          {
            optimizationStatus: OptimizationStatus.pending,
            optimizationStartedAt: { lt: thresholds.stuckOptimizationAt },
          },
          {
            optimizationStatus: OptimizationStatus.processing,
            optimizationStartedAt: { lt: thresholds.stuckOptimizationAt },
          },
          { deletedAt: { not: null }, status: { not: FileStatus.deleted } },
          { status: FileStatus.deleted, deletedAt: null },
          {
            status: FileStatus.ready,
            OR: [{ s3Key: '' }, { checksum: null }, { size: null }, { uploadedAt: null }],
          },
        ],
      },
      orderBy: { statusChangedAt: 'desc' },
      take: Math.max(limit * 5, 50),
    });

    const items: ProblemFileDto[] = [];
    for (const file of candidates) {
      const problems = this.detector.detectProblems(file as any, thresholds);
      if (problems.length === 0) continue;

      items.push({
        ...this.mapper.toResponseDto(file),
        problems,
      } as any);

      if (items.length >= limit) break;
    }

    return { items };
  }

  // --- Private Helper Methods ---

  private async performStreamUpload(
    stream: Readable,
    key: string,
    mimeType: string,
    fileId: string,
  ) {
    const hash = createHash('sha256');
    let size = 0;
    let hashFinalized = false;

    const hasher = new Transform({
      transform: (chunk, _encoding, callback) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > this.getFileSizeLimit(mimeType)) {
          const limitMb = Math.floor(this.getFileSizeLimit(mimeType) / (1024 * 1024));
          return callback(new BadRequestException(`File is too large (limit: ${limitMb}MB)`));
        }
        if (!hashFinalized) hash.update(buf);
        callback(null, buf);
      },
    });

    const onAbort = async () => {
      try {
        await this.storageService.deleteFile(key);
        await this.prismaService.file.update({
          where: { id: fileId },
          data: { status: FileStatus.failed, statusChangedAt: new Date() },
        });
      } catch (err) {
        this.logger.error({ err, fileId }, 'Failed cleanup after abort');
      }
    };

    try {
      await this.storageService.uploadStream({
        key,
        body: stream.pipe(hasher),
        mimeType,
        onAbort,
      });
      hashFinalized = true;
      return { checksum: `sha256:${hash.digest('hex')}`, size, hashFinalized };
    } catch (err) {
      await onAbort();
      throw err;
    }
  }

  private async extractAndSaveExif(file: any): Promise<Record<string, any> | undefined> {
    const mimeType = file.originalMimeType || file.mimeType;
    const key = file.originalS3Key || file.s3Key;
    if (!this.isImage(mimeType)) return undefined;

    try {
      const exif = await this.exifService.tryExtractFromStorageKey({ key, mimeType });
      if (exif) {
        await this.prismaService.file.update({ where: { id: file.id }, data: { exif } });
      }
      return exif;
    } catch (err) {
      this.logger.debug({ err, fileId: file.id }, 'Failed to extract EXIF');
      return undefined;
    }
  }

  private async promoteUploadedFileToReady(params: {
    fileId: string;
    checksum: string;
    size: number;
    finalKey: string;
    mimeType: string;
  }) {
    const { fileId, checksum, size, finalKey, mimeType } = params;
    try {
      return await this.prismaService.file.update({
        where: { id: fileId },
        data: {
          checksum,
          size: BigInt(size),
          s3Key: finalKey,
          status: FileStatus.ready,
          uploadedAt: new Date(),
          statusChangedAt: new Date(),
        },
      });
    } catch (err) {
      if (!this.isUniqueConstraintViolation(err)) throw err;
      const existing = await this.findReadyByChecksum({ checksum, mimeType });
      if (existing) {
        await this.prismaService.file.delete({ where: { id: fileId } });
        return existing;
      }
      throw err;
    }
  }

  private async findReadyByChecksum(params: { checksum: string; mimeType: string }) {
    return this.prismaService.file.findFirst({
      where: { checksum: params.checksum, mimeType: params.mimeType, status: FileStatus.ready },
    });
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return isPrismaKnownRequestError(error) && error.code === 'P2002';
  }

  private calculateChecksum(buffer: Buffer): string {
    return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  }

  private generateS3Key(checksum: string, mimeType: string): string {
    const hash = checksum.replace('sha256:', '');
    const ext = this.getExtensionFromMimeType(mimeType);
    return `${hash.substring(0, 2)}/${hash.substring(2, 4)}/${hash}${ext}`;
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/avif': '.avif',
      'image/svg+xml': '.svg',
    };
    return map[mimeType] || '';
  }

  private isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  private getFileSizeLimit(mimeType: string): number {
    const uploadConfig = this.configService.get<UploadConfig>('upload')!;
    if (this.isImage(mimeType)) return uploadConfig.imageMaxBytesMb * 1024 * 1024;
    if (mimeType.startsWith('video/')) return uploadConfig.videoMaxBytesMb * 1024 * 1024;
    if (mimeType.startsWith('audio/')) return uploadConfig.audioMaxBytesMb * 1024 * 1024;
    return uploadConfig.documentMaxBytesMb * 1024 * 1024;
  }

  private async readToBufferWithLimit(stream: Readable, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) throw new BadRequestException('File limit exceeded');
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  }

  // --- Optimization Logic ---

  public async ensureOptimized(fileId: string): Promise<any> {
    const updated = await this.prismaService.file.updateMany({
      where: { id: fileId, optimizationStatus: OptimizationStatus.pending },
      data: {
        optimizationStatus: OptimizationStatus.processing,
        optimizationStartedAt: new Date(),
      },
    });

    if (updated.count > 0) {
      void this.optimizeImage(fileId).catch(err =>
        this.logger.error({ err, fileId }, 'Optimization failed'),
      );
    }

    const start = Date.now();
    while (Date.now() - start < this.optimizationWaitTimeout) {
      const file = await this.prismaService.file.findUnique({ where: { id: fileId } });
      if (!file) throw new NotFoundException('File not found');
      if (file.optimizationStatus === OptimizationStatus.ready) return file;
      if (file.optimizationStatus === OptimizationStatus.failed) {
        throw new ConflictException(
          `Optimization failed: ${file.optimizationError || 'Unknown error'}`,
        );
      }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new RequestTimeoutException('Optimization timeout');
  }

  private triggerOptimizationIfPending(fileId: string): void {
    void (async () => {
      const updated = await this.prismaService.file.updateMany({
        where: { id: fileId, optimizationStatus: OptimizationStatus.pending },
        data: {
          optimizationStatus: OptimizationStatus.processing,
          optimizationStartedAt: new Date(),
        },
      });
      if (updated.count > 0) {
        await this.optimizeImage(fileId);
      }
    })().catch(err => this.logger.error({ err, fileId }, 'Optimization schedule failed'));
  }

  private async optimizeImage(fileId: string): Promise<void> {
    let originalS3Key: string | null = null;
    try {
      const file = await this.prismaService.file.findUnique({ where: { id: fileId } });
      if (!file?.originalS3Key || !file.originalMimeType) return;
      originalS3Key = file.originalS3Key;

      const { stream } = await this.storageService.downloadStream(originalS3Key);
      const buffer = await this.readToBufferWithLimit(stream, this.imageMaxBytes);
      const result = await this.imageOptimizer.compressImage(
        buffer,
        file.originalMimeType,
        (file.optimizationParams as any) || {},
        this.forceCompression,
      );

      const checksum = this.calculateChecksum(result.buffer);
      const existing = await this.findReadyByChecksum({ checksum, mimeType: result.format });

      if (existing) {
        await this.prismaService.file.delete({ where: { id: fileId } });
        await this.storageService.deleteFile(originalS3Key);
        return;
      }

      const finalKey = this.generateS3Key(checksum, result.format);
      await this.storageService.uploadFile(finalKey, result.buffer, result.format);

      try {
        await this.prismaService.file.update({
          where: { id: fileId },
          data: {
            s3Key: finalKey,
            mimeType: result.format,
            size: BigInt(result.size),
            checksum,
            optimizationStatus: OptimizationStatus.ready,
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
            await this.prismaService.file.delete({ where: { id: fileId } });
            await this.storageService.deleteFile(originalS3Key);
            return;
          }
        }
        throw updateError;
      }

      await this.storageService.deleteFile(originalS3Key);
    } catch (err) {
      this.logger.error({ err, fileId }, 'Optimization error');
      await this.prismaService.file.update({
        where: { id: fileId },
        data: {
          status: FileStatus.failed, // Mark the file as failed so it's not served and can be cleaned up
          statusChangedAt: new Date(),
          optimizationStatus: OptimizationStatus.failed,
          optimizationError: err instanceof Error ? err.message : 'Unknown',
          optimizationCompletedAt: new Date(),
        },
      });
      throw err;
    }
  }
}
