import { Module } from '@nestjs/common';
import { ThumbnailService } from './thumbnail.service.js';
import { ThumbnailController } from './thumbnail.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { FilesModule } from '../files/files.module.js';
import { HeavyTasksQueueModule } from '../heavy-tasks-queue/heavy-tasks-queue.module.js';

@Module({
  imports: [PrismaModule, StorageModule, FilesModule, HeavyTasksQueueModule],
  controllers: [ThumbnailController],
  providers: [ThumbnailService],
  exports: [ThumbnailService],
})
export class ThumbnailModule {}
