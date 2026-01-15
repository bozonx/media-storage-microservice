import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service.js';
import { CleanupConfig } from '../../config/cleanup.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStatus } from '../files/file-status.js';

@Injectable()
export class OrphanCleanupService {
  private readonly logger = new Logger(OrphanCleanupService.name);
  private readonly config: CleanupConfig;

  constructor(
    private readonly prismaService: PrismaService,
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

    const staleFiles = await this.prismaService.file.findMany({
      where: {
        status: FileStatus.UPLOADING,
        createdAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        s3Key: true,
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

      await this.prismaService.file.delete({
        where: { id: file.id },
      });
      this.logger.log(`Removed stale file record: ${file.id}`);
    }
  }

  private async retryFailedDeletions() {
    const timeoutMinutes = this.config.orphanTimeoutMinutes;
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const failedDeletions = await this.prismaService.file.findMany({
      where: {
        status: FileStatus.DELETING,
        deletedAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        s3Key: true,
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

        await this.prismaService.file.update({
          where: { id: file.id },
          data: {
            status: FileStatus.DELETED,
          },
        });

        this.logger.log(`Successfully deleted file on retry: ${file.id}`);
      } catch (error) {
        this.logger.error(`Failed to delete file on retry: ${file.id}`, error);
      }
    }
  }
}
