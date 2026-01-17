import { registerAs } from '@nestjs/config';

export default registerAs('heavyTasksQueue', () => ({
  maxConcurrency: Number.parseInt(process.env.HEAVY_TASKS_MAX_CONCURRENCY || '4', 10),
  timeoutMs: Number.parseInt(process.env.HEAVY_TASKS_QUEUE_TIMEOUT_MS || '30000', 10),
}));
