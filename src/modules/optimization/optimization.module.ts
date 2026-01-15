import { Module } from '@nestjs/common';
import { ImageOptimizerService } from './image-optimizer.service.js';

@Module({
  providers: [ImageOptimizerService],
  exports: [ImageOptimizerService],
})
export class OptimizationModule {}
