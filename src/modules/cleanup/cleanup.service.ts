import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CronJob } from 'cron';
import { FileStatus as PrismaFileStatus, Prisma } from '@prisma/client';
import { StorageService } from '../storage/storage.service.js';
import { CleanupConfig } from '../../config/cleanup.config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class CleanupService implements OnModuleInit, OnModuleDestroy {
  private static readonly jobName = 'cleanup';
  private readonly config: CleanupConfig;

  constructor(
    @InjectPinoLogger(CleanupService.name)
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
      await this.runCleanup();
    });

    this.schedulerRegistry.addCronJob(CleanupService.jobName, job);
    job.start();
  }

  onModuleDestroy(): void {
    try {
      this.schedulerRegistry.deleteCronJob(CleanupService.jobName);
    } catch {
      // ignore
    }
  }

  async runCleanup() {
    if (!this.config.enabled) {
      return;
    }

    this.logger.info('Starting cleanup job');

    await this.cleanupCorruptedRecords();
    await this.cleanupBadStatusFiles();
    await this.cleanupOrphanedTemporaryFiles();
    await this.cleanupOldThumbnails();

    this.logger.info('Cleanup job completed');
  }

  private async cleanupCorruptedRecords() {
    this.logger.info('Starting corrupted records cleanup');

    const corruptedFiles = await this.prismaService.$queryRaw<
      Array<{ id: string; s3Key: string | null; originalS3Key: string | null }>
    >(Prisma.sql`
      SELECT
        id,
        s3_key AS "s3Key",
        original_s3_key AS "originalS3Key"
      FROM files
      WHERE
        (status = ${PrismaFileStatus.deleting} AND deleted_at IS NULL)
        OR
        (status = ${PrismaFileStatus.ready} AND (s3_key = '' OR mime_type = ''))
      LIMIT ${this.config.batchSize}
    `);

    if (corruptedFiles.length === 0) {
      this.logger.info('No corrupted records found');
      return;
    }

    this.logger.info({ count: corruptedFiles.length }, 'Found corrupted records');

    for (const file of corruptedFiles) {
      const claimed = await this.claimFileForDeletion({
        fileId: file.id,
        expectedStatuses: [PrismaFileStatus.ready, PrismaFileStatus.deleting],
      });

      if (!claimed) {
        continue;
      }

      await this.deleteFileCompletely(file.id, file.s3Key, file.originalS3Key);
    }
  }

  private async cleanupOrphanedTemporaryFiles() {
    this.logger.info('Starting orphaned temporary files cleanup');

    const ttlHours = 24;
    const cutoffTime = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

    const orphanedFiles = await this.prismaService.$queryRaw<
      Array<{ id: string; s3Key: string | null; originalS3Key: string | null }>
    >(Prisma.sql`
      SELECT
        id,
        s3_key AS "s3Key",
        original_s3_key AS "originalS3Key"
      FROM files
      WHERE
        (
          (status = ${PrismaFileStatus.uploading} AND created_at < ${cutoffTime})
          OR
          (status = ${PrismaFileStatus.failed} AND (s3_key LIKE 'tmp/%' OR original_s3_key LIKE 'originals/%'))
        )
      LIMIT ${this.config.batchSize}
    `);

    if (orphanedFiles.length === 0) {
      this.logger.info('No orphaned temporary files found');
      return;
    }

    this.logger.info({ count: orphanedFiles.length }, 'Found orphaned temporary files');

    for (const file of orphanedFiles) {
      const claimed = await this.claimFileForDeletion({
        fileId: file.id,
        expectedStatuses: [PrismaFileStatus.uploading, PrismaFileStatus.failed],
      });

      if (!claimed) {
        continue;
      }

      await this.deleteFileCompletely(file.id, file.s3Key, file.originalS3Key);
    }
  }

  private async cleanupBadStatusFiles() {
    this.logger.info('Starting bad status files cleanup');

    const ttlDays = this.config.badStatusTtlDays;
    const cutoffTime = new Date(Date.now() - ttlDays * MS_PER_DAY);

    const badFiles = await this.prismaService.file.findMany({
      where: {
        status: {
          in: [
            PrismaFileStatus.uploading,
            PrismaFileStatus.deleting,
            PrismaFileStatus.failed,
            PrismaFileStatus.missing,
          ],
        },
        statusChangedAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        status: true,
        s3Key: true,
        originalS3Key: true,
      },
      take: this.config.batchSize,
    });

    if (badFiles.length === 0) {
      this.logger.info('No bad status files found');
      return;
    }

    this.logger.info({ count: badFiles.length }, 'Found bad status files');

    for (const file of badFiles) {
      if (file.status === PrismaFileStatus.deleting) {
        const claimed = await this.claimFileForRetryDeletion({
          fileId: file.id,
          cutoffTime,
        });
        if (!claimed) {
          continue;
        }

        await this.retryDeletion(file.id, file.s3Key);
      } else {
        const claimed = await this.claimFileForDeletion({
          fileId: file.id,
          expectedStatuses: [file.status],
          cutoffTime,
        });

        if (!claimed) {
          continue;
        }

        await this.deleteFileCompletely(file.id, file.s3Key, file.originalS3Key);
      }
    }
  }

  private async cleanupOldThumbnails() {
    this.logger.info('Starting old thumbnails cleanup');

    const ttlDays = this.config.thumbnailsTtlDays;
    const cutoffTime = new Date(Date.now() - ttlDays * MS_PER_DAY);

    const oldThumbnails = await this.prismaService.thumbnail.findMany({
      where: {
        lastAccessedAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        s3Key: true,
      },
      take: this.config.batchSize,
    });

    if (oldThumbnails.length === 0) {
      this.logger.info('No old thumbnails found');
      return;
    }

    this.logger.info({ count: oldThumbnails.length }, 'Found old thumbnails');

    for (const thumbnail of oldThumbnails) {
      try {
        await this.storageService.deleteFile(thumbnail.s3Key);
        this.logger.info({ s3Key: thumbnail.s3Key }, 'Deleted thumbnail from storage');
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          this.logger.warn(
            { err: error, s3Key: thumbnail.s3Key },
            'Failed to delete thumbnail from storage',
          );
        }
      }

      await this.prismaService.thumbnail.deleteMany({
        where: {
          id: thumbnail.id,
          lastAccessedAt: {
            lt: cutoffTime,
          },
        },
      });
      this.logger.info({ thumbnailId: thumbnail.id }, 'Removed thumbnail record');
    }
  }

  private async claimFileForRetryDeletion(params: {
    fileId: string;
    cutoffTime: Date;
  }): Promise<boolean> {
    const result = await this.prismaService.file.updateMany({
      where: {
        id: params.fileId,
        status: PrismaFileStatus.deleting,
        statusChangedAt: {
          lt: params.cutoffTime,
        },
      },
      data: {
        statusChangedAt: new Date(),
      },
    });

    return result.count === 1;
  }

  private async claimFileForDeletion(params: {
    fileId: string;
    expectedStatuses: PrismaFileStatus[];
    cutoffTime?: Date;
  }): Promise<boolean> {
    const result = await this.prismaService.file.updateMany({
      where: {
        id: params.fileId,
        status: {
          in: params.expectedStatuses,
        },
        ...(params.cutoffTime
          ? {
              statusChangedAt: {
                lt: params.cutoffTime,
              },
            }
          : {}),
      },
      data: {
        status: PrismaFileStatus.deleting,
        deletedAt: new Date(),
        statusChangedAt: new Date(),
      },
    });

    return result.count === 1;
  }

  private async retryDeletion(fileId: string, s3Key: string) {
    try {
      await this.storageService.deleteFile(s3Key);

      await this.prismaService.file.update({
        where: { id: fileId },
        data: {
          status: PrismaFileStatus.deleted,
          statusChangedAt: new Date(),
        },
      });

      this.logger.info({ fileId }, 'Successfully deleted file on retry');
    } catch (error) {
      if (error instanceof NotFoundException) {
        await this.prismaService.file.update({
          where: { id: fileId },
          data: {
            status: PrismaFileStatus.deleted,
            statusChangedAt: new Date(),
          },
        });

        this.logger.info({ fileId }, 'File not found in storage (treated as deleted)');
      } else {
        this.logger.error({ err: error, fileId }, 'Failed to delete file on retry');
      }
    }
  }

  private async deleteFileCompletely(
    fileId: string,
    s3Key: string | null,
    originalS3Key: string | null,
  ) {
    const thumbnails = await this.prismaService.thumbnail.findMany({
      where: { fileId },
      select: { id: true, s3Key: true },
    });

    for (const thumbnail of thumbnails) {
      try {
        await this.storageService.deleteFile(thumbnail.s3Key);
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          this.logger.warn(
            { err: error, s3Key: thumbnail.s3Key },
            'Failed to delete thumbnail from storage',
          );
        }
      }
    }

    if (s3Key) {
      try {
        await this.storageService.deleteFile(s3Key);
        this.logger.info({ s3Key }, 'Deleted file from storage');
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          this.logger.warn({ err: error, s3Key }, 'Failed to delete file from storage');
        }
      }
    }

    if (originalS3Key) {
      try {
        await this.storageService.deleteFile(originalS3Key);
        this.logger.info({ s3Key: originalS3Key }, 'Deleted original file from storage');
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          this.logger.warn(
            { err: error, s3Key: originalS3Key },
            'Failed to delete original file from storage',
          );
        }
      }
    }

    try {
      await this.prismaService.$transaction(async tx => {
        if (thumbnails.length > 0) {
          await tx.thumbnail.deleteMany({
            where: { fileId },
          });
        }

        await tx.file.delete({
          where: { id: fileId },
        });
      });

      if (thumbnails.length > 0) {
        this.logger.info({ fileId, count: thumbnails.length }, 'Deleted thumbnails');
      }

      this.logger.info({ fileId }, 'Removed file record');
    } catch (error) {
      this.logger.error({ err: error, fileId }, 'Failed to remove records from database');
    }
  }
}
