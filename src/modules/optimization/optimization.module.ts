import { Module } from '@nestjs/common';

import { ImageProcessingModule } from '../image-processing/image-processing.module.js';
import { ImageOptimizerService } from './image-optimizer.service.js';

@Module({
  imports: [ImageProcessingModule],
  providers: [ImageOptimizerService],
  exports: [ImageOptimizerService],
})
export class OptimizationModule {}
