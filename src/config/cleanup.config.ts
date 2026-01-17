import { registerAs } from '@nestjs/config';
import { CronTime } from 'cron';

export interface CleanupConfig {
  enabled: boolean;
  cron: string;
  badStatusTtlDays: number;
  softDeletedRetryDelayMinutes: number;
  softDeletedStuckWarnDays: number;
  thumbnailsTtlDays: number;
  batchSize: number;
  tmpTtlDays: number;
  originalsTtlDays: number;
  s3ListPageSize: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseCron(value: string | undefined, fallback: string): string {
  const candidate = (value ?? '').trim();
  if (!candidate) {
    return fallback;
  }

  try {
    // Validate cron expression
    // eslint-disable-next-line no-new
    new CronTime(candidate);
    return candidate;
  } catch {
    return fallback;
  }
}

export default registerAs(
  'cleanup',
  (): CleanupConfig => ({
    enabled: process.env.CLEANUP_ENABLED !== 'false',
    cron: parseCron(process.env.CLEANUP_CRON, '0 */6 * * *'),
    badStatusTtlDays: parsePositiveInt(process.env.CLEANUP_BAD_STATUS_TTL_DAYS, 7),
    softDeletedRetryDelayMinutes: parsePositiveInt(
      process.env.CLEANUP_SOFT_DELETED_RETRY_DELAY_MINUTES,
      30,
    ),
    softDeletedStuckWarnDays: parsePositiveInt(process.env.CLEANUP_SOFT_DELETED_STUCK_WARN_DAYS, 3),
    thumbnailsTtlDays: parsePositiveInt(process.env.THUMBNAIL_MAX_AGE_DAYS, 90),
    batchSize: parsePositiveInt(process.env.CLEANUP_BATCH_SIZE, 200),
    tmpTtlDays: parsePositiveInt(process.env.CLEANUP_TMP_TTL_DAYS, 2),
    originalsTtlDays: parsePositiveInt(process.env.CLEANUP_ORIGINALS_TTL_DAYS, 14),
    s3ListPageSize: parsePositiveInt(process.env.CLEANUP_S3_LIST_PAGE_SIZE, 1000),
  }),
);
