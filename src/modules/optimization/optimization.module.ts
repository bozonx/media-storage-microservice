import { Module } from '@nestjs/common';
import { ImageOptimizerService } from './image-optimizer.service.js';
import { HeavyTasksQueueModule } from '../heavy-tasks-queue/heavy-tasks-queue.module.js';

@Module({
  imports: [HeavyTasksQueueModule],
  providers: [ImageOptimizerService],
  exports: [ImageOptimizerService],
})
export class OptimizationModule {}
