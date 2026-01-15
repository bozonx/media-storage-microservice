import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { FileEntity, FileStatus } from './entities/file.entity.js';
import { StorageService } from '../storage/storage.service.js';
import { ImageOptimizerService } from '../optimization/image-optimizer.service.js';
import { OptimizeParamsDto } from './dto/optimize-params.dto.js';
import { ListFilesDto } from './dto/list-files.dto.js';
import { FileResponseDto } from './dto/file-response.dto.js';
import { ListFilesResponseDto } from './dto/list-files-response.dto.js';
import { plainToInstance } from 'class-transformer';

export interface UploadFileParams {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  optimizeParams?: OptimizeParamsDto;
  metadata?: Record<string, any>;
}

export interface DownloadFileResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly bucket: string;
  private readonly basePath: string;

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly storageService: StorageService,
    private readonly imageOptimizer: ImageOptimizerService,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.get<string>('storage.bucket')!;
    this.basePath = this.configService.get<string>('BASE_PATH') || '';
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

    const fileEntity = this.fileRepository.create({
      filename,
      mimeType: processedMimeType,
      size: processedBuffer.length,
      originalSize,
      checksum,
      s3Key,
      s3Bucket: this.bucket,
      status: FileStatus.UPLOADING,
      optimizationParams: optimizeParams || null,
      metadata: metadata || null,
      uploadedAt: null,
    });

    await this.fileRepository.save(fileEntity);
    this.logger.log(`File record created with status=uploading: ${fileEntity.id}`);

    try {
      await this.storageService.uploadFile(s3Key, processedBuffer, processedMimeType);

      fileEntity.status = FileStatus.READY;
      fileEntity.uploadedAt = new Date();
      await this.fileRepository.save(fileEntity);

      this.logger.log(`File upload completed: ${fileEntity.id}`);

      return this.toResponseDto(fileEntity);
    } catch (error) {
      this.logger.error(`Failed to upload file to S3: ${fileEntity.id}`, error);

      fileEntity.status = FileStatus.FAILED;
      await this.fileRepository.save(fileEntity);

      throw error;
    }
  }

  async getFileMetadata(id: string): Promise<FileResponseDto> {
    const file = await this.fileRepository.findOne({
      where: { id, status: FileStatus.READY },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return this.toResponseDto(file);
  }

  async downloadFile(id: string): Promise<DownloadFileResult> {
    const file = await this.fileRepository.findOne({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status === FileStatus.DELETED) {
      throw new NotFoundException('File has been deleted');
    }

    if (file.status !== FileStatus.READY) {
      throw new BadRequestException('File is not ready for download');
    }

    const buffer = await this.storageService.downloadFile(file.s3Key);

    return {
      buffer,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
    };
  }

  async deleteFile(id: string): Promise<void> {
    const file = await this.fileRepository.findOne({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status === FileStatus.DELETED || file.status === FileStatus.DELETING) {
      throw new ConflictException('File is already deleted or being deleted');
    }

    file.status = FileStatus.DELETING;
    file.deletedAt = new Date();
    await this.fileRepository.save(file);

    this.logger.log(`File marked for deletion: ${id}`);

    try {
      await this.storageService.deleteFile(file.s3Key);

      file.status = FileStatus.DELETED;
      await this.fileRepository.save(file);

      this.logger.log(`File deleted successfully: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete file from S3: ${id}`, error);
      throw error;
    }
  }

  async listFiles(params: ListFilesDto): Promise<ListFilesResponseDto> {
    const { limit = 50, offset = 0, sortBy = 'uploadedAt', order = 'desc' } = params;

    const [items, total] = await this.fileRepository.findAndCount({
      where: { status: FileStatus.READY },
      order: { [sortBy]: order.toUpperCase() },
      take: limit,
      skip: offset,
    });

    return {
      items: items.map((item) => this.toResponseDto(item)),
      total,
      limit,
      offset,
    };
  }

  private toResponseDto(file: FileEntity): FileResponseDto {
    const dto = plainToInstance(FileResponseDto, file, {
      excludeExtraneousValues: true,
    });

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
