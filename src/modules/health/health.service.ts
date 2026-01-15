import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {}

  async check() {
    const timestamp = new Date().toISOString();
    const dbStatus = await this.checkDatabase();
    const s3Status = await this.checkS3();

    const overallStatus = dbStatus && s3Status ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp,
      storage: {
        s3: s3Status ? 'connected' : 'disconnected',
        database: dbStatus ? 'connected' : 'disconnected',
      },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return false;
    }
  }

  private async checkS3(): Promise<boolean> {
    try {
      return await this.storageService.checkConnection();
    } catch (error) {
      this.logger.error('S3 health check failed', error);
      return false;
    }
  }
}
