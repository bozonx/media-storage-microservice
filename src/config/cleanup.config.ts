import { registerAs } from '@nestjs/config';

export interface CleanupConfig {
  enabled: boolean;
  cron: string;
  badStatusTtlDays: number;
  thumbnailsTtlDays: number;
  batchSize: number;
}

export default registerAs(
  'cleanup',
  (): CleanupConfig => ({
    enabled: process.env.CLEANUP_ENABLED !== 'false',
    cron: process.env.CLEANUP_CRON || '0 */6 * * *',
    badStatusTtlDays: parseInt(process.env.CLEANUP_BAD_STATUS_TTL_DAYS || '30', 10),
    thumbnailsTtlDays: parseInt(process.env.CLEANUP_THUMBNAILS_TTL_DAYS || '90', 10),
    batchSize: parseInt(process.env.CLEANUP_BATCH_SIZE || '200', 10),
  }),
);
