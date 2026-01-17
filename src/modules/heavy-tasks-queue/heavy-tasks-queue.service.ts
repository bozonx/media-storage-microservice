import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import PQueue from 'p-queue';

export enum TaskPriority {
  EXIF_EXTRACTION = 0,
  THUMBNAIL_GENERATION = 1,
  LAZY_COMPRESSION = 2,
}

@Injectable()
export class HeavyTasksQueueService implements OnModuleDestroy {
  private readonly queue: PQueue;
  private readonly timeoutMs: number;

  constructor(
    @InjectPinoLogger(HeavyTasksQueueService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    const maxConcurrency = this.configService.get<number>('heavyTasksQueue.maxConcurrency')!;
    this.timeoutMs = this.configService.get<number>('heavyTasksQueue.timeoutMs')!;

    this.queue = new PQueue({
      concurrency: maxConcurrency,
    });

    this.logger.info({ maxConcurrency, timeoutMs: this.timeoutMs }, 'HeavyTasksQueue initialized');
  }

  async execute<T>(task: () => Promise<T>, priority: TaskPriority): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await this.queue.add(task, { priority });

      const duration = Date.now() - startTime;
      this.logger.debug(
        { priority, durationMs: duration, queueSize: this.queue.size, pending: this.queue.pending },
        'Heavy task completed',
      );

      return result as T;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error({ err: error, priority, durationMs: duration }, 'Heavy task failed');
      throw error;
    }
  }

  getQueueStats() {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
    };
  }

  async onModuleDestroy() {
    this.logger.info('Shutting down HeavyTasksQueue');
    await this.queue.onIdle();
    this.queue.clear();
  }
}
