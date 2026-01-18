import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [StorageModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
