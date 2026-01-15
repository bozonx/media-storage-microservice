import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

    const staleFiles = await (this.prismaService as any).file.findMany({
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
      let deletedFromStorage = false;
      try {
        await this.storageService.deleteFile(file.s3Key);
        this.logger.log(`Deleted stale file from S3: ${file.s3Key}`);
        deletedFromStorage = true;
      } catch (error) {
        if (error instanceof NotFoundException) {
          this.logger.log(`Stale file not found in S3 (treated as deleted): ${file.s3Key}`);
          deletedFromStorage = true;
        } else {
          this.logger.warn(`Failed to delete stale file from S3: ${file.s3Key}`, error);
        }
      }

      if (!deletedFromStorage) {
        continue;
      }

      await (this.prismaService as any).file.delete({
        where: { id: file.id },
      });
      this.logger.log(`Removed stale file record: ${file.id}`);
    }
  }

  private async retryFailedDeletions() {
    const timeoutMinutes = this.config.orphanTimeoutMinutes;
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const failedDeletions = await (this.prismaService as any).file.findMany({
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

        await (this.prismaService as any).file.update({
          where: { id: file.id },
          data: {
            status: FileStatus.DELETED,
          },
        });

        this.logger.log(`Successfully deleted file on retry: ${file.id}`);
      } catch (error) {
        if (error instanceof NotFoundException) {
          await (this.prismaService as any).file.update({
            where: { id: file.id },
            data: {
              status: FileStatus.DELETED,
            },
          });

          this.logger.log(`File not found in S3 (treated as deleted): ${file.id}`);
          continue;
        }
        this.logger.error(`Failed to delete file on retry: ${file.id}`, error);
      }
    }
  }
}
