import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

import { ImageProcessingClient } from '../image-processing/image-processing.client.js';

@Injectable()
export class HealthService {
  constructor(
    @InjectPinoLogger(HealthService.name)
    private readonly logger: PinoLogger,
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly imageProcessingClient: ImageProcessingClient,
  ) {}

  async check() {
    const timestamp = new Date().toISOString();
    const dbStatus = await this.checkDatabase();
    const s3Status = await this.checkS3();
    const imageProcessingStatus = await this.checkImageProcessing();

    const overallStatus = dbStatus && s3Status && imageProcessingStatus.ok ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp,
      storage: {
        s3: s3Status ? 'connected' : 'disconnected',
        database: dbStatus ? 'connected' : 'disconnected',
      },
      imageProcessing: {
        status: imageProcessingStatus.ok ? 'connected' : 'disconnected',
        queue: imageProcessingStatus.queue,
      },
    };
  }

  private async checkImageProcessing() {
    try {
      const health = await this.imageProcessingClient.health();
      return { ok: health.status === 'ok', queue: health.queue };
    } catch (error) {
      this.logger.error({ err: error }, 'Image processing health check failed');
      return { ok: false, queue: { size: 0, pending: 0 } };
    }
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Database health check failed');
      return false;
    }
  }

  private async checkS3(): Promise<boolean> {
    try {
      return await this.storageService.checkConnection();
    } catch (error) {
      this.logger.error({ err: error }, 'S3 health check failed');
      return false;
    }
  }
}
