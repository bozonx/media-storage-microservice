import { registerAs } from '@nestjs/config';

export interface CleanupConfig {
  enabled: boolean;
  cron: string;
  orphanTimeoutMinutes: number;
}

export default registerAs(
  'cleanup',
  (): CleanupConfig => ({
    enabled: process.env.CLEANUP_ENABLED !== 'false',
    cron: process.env.CLEANUP_CRON || '0 */6 * * *',
    orphanTimeoutMinutes: parseInt(process.env.CLEANUP_ORPHAN_TIMEOUT_MINUTES || '30', 10),
  }),
);
