import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CronJob } from 'cron';
import { StorageService } from '../storage/storage.service.js';
import { CleanupConfig } from '../../config/cleanup.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStatus } from '../files/file-status.js';

@Injectable()
export class OrphanCleanupService implements OnModuleInit, OnModuleDestroy {
  private static readonly jobName = 'orphanCleanup';
  private readonly config: CleanupConfig;

  constructor(
    @InjectPinoLogger(OrphanCleanupService.name)
    private readonly logger: PinoLogger,
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.config = this.configService.get<CleanupConfig>('cleanup')!;
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      return;
    }

    const job = new CronJob(this.config.cron, async () => {
      await this.cleanupOrphanFiles();
    });

    this.schedulerRegistry.addCronJob(OrphanCleanupService.jobName, job);
    job.start();
  }

  onModuleDestroy(): void {
    try {
      this.schedulerRegistry.deleteCronJob(OrphanCleanupService.jobName);
    } catch {
      // ignore
    }
  }

  async cleanupOrphanFiles() {
    if (!this.config.enabled) {
      return;
    }

    this.logger.info('Starting orphan files cleanup job');

    await this.cleanupStaleUploading();
    await this.retryFailedDeletions();

    this.logger.info('Orphan files cleanup job completed');
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
      this.logger.info('No stale uploading files found');
      return;
    }

    this.logger.info({ count: staleFiles.length }, 'Found stale uploading files');

    for (const file of staleFiles) {
      let deletedFromStorage = false;
      try {
        await this.storageService.deleteFile(file.s3Key);
        this.logger.info({ s3Key: file.s3Key }, 'Deleted stale file from storage');
        deletedFromStorage = true;
      } catch (error) {
        if (error instanceof NotFoundException) {
          this.logger.info(
            { s3Key: file.s3Key },
            'Stale file not found in storage (treated as deleted)',
          );
          deletedFromStorage = true;
        } else {
          this.logger.warn(
            { err: error, s3Key: file.s3Key },
            'Failed to delete stale file from storage',
          );
        }
      }

      if (!deletedFromStorage) {
        continue;
      }

      await (this.prismaService as any).file.delete({
        where: { id: file.id },
      });
      this.logger.info({ fileId: file.id }, 'Removed stale file record');
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
      this.logger.info('No failed deletions found');
      return;
    }

    this.logger.info({ count: failedDeletions.length }, 'Found failed deletions to retry');

    for (const file of failedDeletions) {
      try {
        await this.storageService.deleteFile(file.s3Key);

        await (this.prismaService as any).file.update({
          where: { id: file.id },
          data: {
            status: FileStatus.DELETED,
          },
        });

        this.logger.info({ fileId: file.id }, 'Successfully deleted file on retry');
      } catch (error) {
        if (error instanceof NotFoundException) {
          await (this.prismaService as any).file.update({
            where: { id: file.id },
            data: {
              status: FileStatus.DELETED,
            },
          });

          this.logger.info({ fileId: file.id }, 'File not found in storage (treated as deleted)');
          continue;
        }
        this.logger.error({ err: error, fileId: file.id }, 'Failed to delete file on retry');
      }
    }
  }
}
