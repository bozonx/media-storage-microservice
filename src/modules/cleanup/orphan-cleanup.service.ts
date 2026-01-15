import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { FileEntity, FileStatus } from '../files/entities/file.entity.js';
import { StorageService } from '../storage/storage.service.js';
import { CleanupConfig } from '../../config/cleanup.config.js';

@Injectable()
export class OrphanCleanupService {
  private readonly logger = new Logger(OrphanCleanupService.name);
  private readonly config: CleanupConfig;

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {
    this.config = this.configService.get<CleanupConfig>('cleanup')!;
  }

  @Cron('0 */6 * * *')
  async cleanupOrphanFiles() {
    if (!this.config.enabled) {
      return;
    }

    this.logger.log('Starting orphan files cleanup job');

    await this.cleanupStaleUploading();
    await this.retryFailedDeletions();

    this.logger.log('Orphan files cleanup job completed');
  }

  private async cleanupStaleUploading() {
    const timeoutMinutes = this.config.orphanTimeoutMinutes;
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const staleFiles = await this.fileRepository.find({
      where: {
        status: FileStatus.UPLOADING,
        createdAt: LessThan(cutoffTime),
      },
    });

    if (staleFiles.length === 0) {
      this.logger.log('No stale uploading files found');
      return;
    }

    this.logger.log(`Found ${staleFiles.length} stale uploading files`);

    for (const file of staleFiles) {
      try {
        await this.storageService.deleteFile(file.s3Key);
        this.logger.log(`Deleted stale file from S3: ${file.s3Key}`);
      } catch (error) {
        this.logger.warn(`Failed to delete stale file from S3: ${file.s3Key}`, error);
      }

      await this.fileRepository.remove(file);
      this.logger.log(`Removed stale file record: ${file.id}`);
    }
  }

  private async retryFailedDeletions() {
    const timeoutMinutes = this.config.orphanTimeoutMinutes;
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const failedDeletions = await this.fileRepository.find({
      where: {
        status: FileStatus.DELETING,
        deletedAt: LessThan(cutoffTime),
      },
    });

    if (failedDeletions.length === 0) {
      this.logger.log('No failed deletions found');
      return;
    }

    this.logger.log(`Found ${failedDeletions.length} failed deletions to retry`);

    for (const file of failedDeletions) {
      try {
        await this.storageService.deleteFile(file.s3Key);

        file.status = FileStatus.DELETED;
        await this.fileRepository.save(file);

        this.logger.log(`Successfully deleted file on retry: ${file.id}`);
      } catch (error) {
        this.logger.error(`Failed to delete file on retry: ${file.id}`, error);
      }
    }
  }
}
