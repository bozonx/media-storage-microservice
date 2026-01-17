import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import PQueue from 'p-queue';
import { ShutdownService } from '../../common/shutdown/shutdown.service.js';

export enum TaskPriority {
  EXIF_EXTRACTION = 0,
  THUMBNAIL_GENERATION = 1,
  LAZY_COMPRESSION = 2,
}

@Injectable()
export class HeavyTasksQueueService implements OnModuleDestroy {
  private readonly queue: PQueue;
  private readonly timeoutMs: number;
  private acceptingNewTasks = true;

  constructor(
    @InjectPinoLogger(HeavyTasksQueueService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly shutdownService: ShutdownService,
  ) {
    const maxConcurrency = this.configService.get<number>('heavyTasksQueue.maxConcurrency')!;
    this.timeoutMs = this.configService.get<number>('heavyTasksQueue.timeoutMs')!;

    this.queue = new PQueue({
      concurrency: maxConcurrency,
    });

    this.logger.info({ maxConcurrency, timeoutMs: this.timeoutMs }, 'HeavyTasksQueue initialized');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async runWithTimeout<T>(params: {
    task: () => Promise<T>;
    timeoutMs: number;
  }): Promise<T> {
    if (params.timeoutMs <= 0) {
      return params.task();
    }

    return Promise.race([
      params.task(),
      this.delay(params.timeoutMs).then(() => {
        throw new Error('Heavy task timeout');
      }),
    ]);
  }

  async execute<T>(task: () => Promise<T>, priority: TaskPriority): Promise<T> {
    if (!this.acceptingNewTasks || this.shutdownService.isShuttingDown()) {
      throw new Error('Service is shutting down');
    }

    const startTime = Date.now();

    try {
      const result = await this.queue.add(
        () => this.runWithTimeout({ task, timeoutMs: this.timeoutMs }),
        { priority },
      );

      const duration = Date.now() - startTime;
      this.logger.debug(
        { priority, durationMs: duration, queueSize: this.queue.size, pending: this.queue.pending },
        'Heavy task completed',
      );

      return result as T;
    } catch (error) {
      const duration = Date.now() - startTime;
      const timedOut = error instanceof Error && error.message === 'Heavy task timeout';

      if (timedOut) {
        this.logger.warn(
          { err: error, priority, durationMs: duration, timeoutMs: this.timeoutMs },
          'Heavy task timed out',
        );
      } else {
        this.logger.error({ err: error, priority, durationMs: duration }, 'Heavy task failed');
      }
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

    this.acceptingNewTasks = false;
    this.queue.pause();

    const remainingMs = this.shutdownService.getShutdownRemainingMs();
    try {
      await Promise.race([
        this.queue.onIdle(),
        this.delay(remainingMs).then(() => {
          throw new Error('HeavyTasksQueue shutdown timeout');
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        {
          err,
          remainingMs,
          queueSize: this.queue.size,
          pending: this.queue.pending,
        },
        'HeavyTasksQueue did not drain before shutdown timeout',
      );
    } finally {
      this.queue.clear();
    }
  }
}
