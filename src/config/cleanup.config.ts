import { registerAs } from '@nestjs/config';
import { CronTime } from 'cron';

export interface CleanupConfig {
  enabled: boolean;
  cron: string;
  badStatusTtlDays: number;
  thumbnailsTtlDays: number;
  batchSize: number;
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
    badStatusTtlDays: parsePositiveInt(process.env.CLEANUP_BAD_STATUS_TTL_DAYS, 30),
    thumbnailsTtlDays: parsePositiveInt(process.env.CLEANUP_THUMBNAILS_TTL_DAYS, 90),
    batchSize: parsePositiveInt(process.env.CLEANUP_BATCH_SIZE, 200),
  }),
);
