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

interface ThumbnailRow {
  id: string;
  s3Key: string;
}

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

    await this.cleanupSoftDeletedFiles();
    await this.cleanupCorruptedRecords();
    await this.cleanupBadStatusFiles();
    await this.cleanupOrphanedTemporaryFiles();
    await this.cleanupOldThumbnails();

    this.logger.info('Cleanup job completed');
  }

  private async cleanupSoftDeletedFiles() {
    this.logger.info('Starting soft-deleted files cleanup');

    const softDeletedFiles = await this.prismaService.$queryRaw<
      Array<{
        id: string;
        s3Key: string | null;
        originalS3Key: string | null;
        checksum: string | null;
        mimeType: string;
      }>
    >(Prisma.sql`
      SELECT
        id,
        s3_key AS "s3Key",
        original_s3_key AS "originalS3Key",
        checksum,
        mime_type AS "mimeType"
      FROM files
      WHERE deleted_at IS NOT NULL
      LIMIT ${this.config.batchSize}
    `);

    if (softDeletedFiles.length === 0) {
      this.logger.info('No soft-deleted files found');
      return;
    }

    this.logger.info({ count: softDeletedFiles.length }, 'Found soft-deleted files');

    for (const file of softDeletedFiles) {
      try {
        const shouldDeleteBlob = await this.shouldDeleteBlob(file.checksum, file.mimeType, file.id);

        if (!shouldDeleteBlob) {
          this.logger.info(
            { fileId: file.id, checksum: file.checksum },
            'Skipping blob deletion (still referenced by other files)',
          );
        }

        const thumbnails = (await (this.prismaService as any).thumbnail.findMany({
          where: { fileId: file.id },
          select: { id: true, s3Key: true },
        })) as ThumbnailRow[];

        const storageKeysToDelete: string[] = [];
        const blobKeys: string[] = [];

        for (const thumbnail of thumbnails) {
          storageKeysToDelete.push(thumbnail.s3Key);
        }

        if (shouldDeleteBlob) {
          if (file.s3Key) {
            storageKeysToDelete.push(file.s3Key);
            blobKeys.push(file.s3Key);
          }
          if (file.originalS3Key) {
            storageKeysToDelete.push(file.originalS3Key);
            blobKeys.push(file.originalS3Key);
          }
        }

        const { deletedKeys, errors } = await this.storageService.deleteFiles(storageKeysToDelete);

        for (const err of errors) {
          this.logger.warn(
            { fileId: file.id, s3Key: err.key, code: err.code, message: err.message },
            'Failed to delete object from storage',
          );
        }

        const deletableThumbnailIds = thumbnails
          .filter((thumbnail: ThumbnailRow) => deletedKeys.has(thumbnail.s3Key))
          .map((thumbnail: ThumbnailRow) => thumbnail.id);

        const allThumbnailsDeleted = deletableThumbnailIds.length === thumbnails.length;
        const allBlobKeysDeleted = blobKeys.every(key => deletedKeys.has(key));

        await this.prismaService.$transaction(async (tx: any) => {
          if (deletableThumbnailIds.length > 0) {
            await tx.thumbnail.deleteMany({
              where: { id: { in: deletableThumbnailIds } },
            });
          }

          if (allThumbnailsDeleted && allBlobKeysDeleted) {
            await tx.file.delete({
              where: { id: file.id },
            });
          }
        });

        if (allThumbnailsDeleted && allBlobKeysDeleted) {
          this.logger.info({ fileId: file.id }, 'Soft-deleted file cleaned up');
        } else {
          this.logger.warn(
            {
              fileId: file.id,
              thumbnailsDeleted: deletableThumbnailIds.length,
              thumbnailsTotal: thumbnails.length,
              blobKeysTotal: blobKeys.length,
            },
            'Soft-deleted file cleanup is incomplete (will retry later)',
          );
        }
      } catch (error) {
        this.logger.error({ err: error, fileId: file.id }, 'Failed to cleanup soft-deleted file');
      }
    }
  }

  private async shouldDeleteBlob(
    checksum: string | null,
    mimeType: string,
    excludeFileId: string,
  ): Promise<boolean> {
    if (!checksum) {
      return true;
    }

    const otherFilesWithSameBlob = await (this.prismaService as any).file.count({
      where: {
        checksum,
        mimeType,
        id: { not: excludeFileId },
        deletedAt: null,
      },
    });

    return otherFilesWithSameBlob === 0;
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

    const badFiles = await (this.prismaService as any).file.findMany({
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

    const chunkSize = 100;
    for (let i = 0; i < oldThumbnails.length; i += chunkSize) {
      const chunk = oldThumbnails.slice(i, i + chunkSize);
      const thumbnailKeyById = new Map<string, string>();
      const keysToDelete: string[] = [];
      for (const thumbnail of chunk) {
        thumbnailKeyById.set(thumbnail.id, thumbnail.s3Key);
        keysToDelete.push(thumbnail.s3Key);
      }

      try {
        const { deletedKeys, errors } = await this.storageService.deleteFiles(keysToDelete);

        for (const err of errors) {
          this.logger.warn(
            { s3Key: err.key, code: err.code, message: err.message },
            'Failed to delete thumbnail from storage',
          );
        }

        const deletableThumbnailIds: string[] = [];
        for (const [id, s3Key] of thumbnailKeyById) {
          if (deletedKeys.has(s3Key)) {
            deletableThumbnailIds.push(id);
          }
        }

        if (deletableThumbnailIds.length === 0) {
          this.logger.warn('Old thumbnails cleanup: no thumbnails were deleted from storage');
          continue;
        }

        await this.prismaService.thumbnail.deleteMany({
          where: {
            id: { in: deletableThumbnailIds },
            lastAccessedAt: {
              lt: cutoffTime,
            },
          },
        });

        this.logger.info(
          {
            deletedFromDb: deletableThumbnailIds.length,
            deletedFromStorage: deletableThumbnailIds.length,
          },
          'Old thumbnails cleanup completed',
        );
      } catch (error) {
        this.logger.error({ err: error }, 'Failed to cleanup old thumbnails');
      }
    }
  }

  private async claimFileForRetryDeletion(params: {
    fileId: string;
    cutoffTime: Date;
  }): Promise<boolean> {
    const result = await (this.prismaService as any).file.updateMany({
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
    const result = await (this.prismaService as any).file.updateMany({
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

      await (this.prismaService as any).file.update({
        where: { id: fileId },
        data: {
          status: PrismaFileStatus.deleted,
          statusChangedAt: new Date(),
        },
      });

      this.logger.info({ fileId }, 'Successfully deleted file on retry');
    } catch (error) {
      if (error instanceof NotFoundException) {
        await (this.prismaService as any).file.update({
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
    const thumbnails = (await (this.prismaService as any).thumbnail.findMany({
      where: { fileId },
      select: { id: true, s3Key: true },
    })) as ThumbnailRow[];

    try {
      const storageKeysToDelete: string[] = [];
      for (const thumbnail of thumbnails) {
        storageKeysToDelete.push(thumbnail.s3Key);
      }
      if (s3Key) {
        storageKeysToDelete.push(s3Key);
      }
      if (originalS3Key) {
        storageKeysToDelete.push(originalS3Key);
      }

      const { deletedKeys, errors } = await this.storageService.deleteFiles(storageKeysToDelete);

      for (const err of errors) {
        this.logger.error(
          { fileId, s3Key: err.key, code: err.code, message: err.message },
          'Failed to delete object from storage',
        );
      }

      const deletableThumbnailIds = thumbnails
        .filter((thumbnail: ThumbnailRow) => deletedKeys.has(thumbnail.s3Key))
        .map((thumbnail: ThumbnailRow) => thumbnail.id);

      const allThumbnailsDeleted = deletableThumbnailIds.length === thumbnails.length;
      const fileKeyDeleted = !s3Key || deletedKeys.has(s3Key);
      const originalKeyDeleted = !originalS3Key || deletedKeys.has(originalS3Key);

      await this.prismaService.$transaction(async (tx: any) => {
        if (deletableThumbnailIds.length > 0) {
          await tx.thumbnail.deleteMany({
            where: { id: { in: deletableThumbnailIds } },
          });
        }

        if (allThumbnailsDeleted && fileKeyDeleted && originalKeyDeleted) {
          await tx.file.delete({
            where: { id: fileId },
          });
        }
      });

      if (allThumbnailsDeleted && fileKeyDeleted && originalKeyDeleted) {
        if (thumbnails.length > 0) {
          this.logger.info({ fileId, count: thumbnails.length }, 'Deleted thumbnails');
        }
        this.logger.info({ fileId }, 'Removed file record');
      } else {
        this.logger.error(
          {
            fileId,
            thumbnailsDeleted: deletableThumbnailIds.length,
            thumbnailsTotal: thumbnails.length,
            fileKeyDeleted,
            originalKeyDeleted,
          },
          'Failed to fully delete file (storage and/or database). Database records were preserved for non-deleted objects.',
        );
      }
    } catch (error) {
      this.logger.error(
        { err: error, fileId },
        'Failed to fully delete file (storage and/or database). Database records were preserved if storage deletion failed.',
      );
    }
  }
}
