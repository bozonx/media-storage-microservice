import { Module } from '@nestjs/common';

import { ImageProcessingModule } from '../image-processing/image-processing.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [StorageModule, ImageProcessingModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
