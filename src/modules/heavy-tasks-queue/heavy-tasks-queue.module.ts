import { Module } from '@nestjs/common';
import { HeavyTasksQueueService } from './heavy-tasks-queue.service.js';

@Module({
  providers: [HeavyTasksQueueService],
  exports: [HeavyTasksQueueService],
})
export class HeavyTasksQueueModule {}
