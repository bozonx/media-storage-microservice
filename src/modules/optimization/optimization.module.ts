import { Module } from '@nestjs/common';
import { ImageOptimizerService } from './image-optimizer.service.js';
import { ImageProcessingModule } from '../image-processing/image-processing.module.js';

@Module({
  imports: [ImageProcessingModule],
  providers: [ImageOptimizerService],
  exports: [ImageOptimizerService],
})
export class OptimizationModule {}
