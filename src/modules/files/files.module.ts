import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { OptimizationModule } from '../optimization/optimization.module.js';
import { HeavyTasksQueueModule } from '../heavy-tasks-queue/heavy-tasks-queue.module.js';
import { ExifService } from './exif.service.js';
import { UrlDownloadService } from './url-download.service.js';

@Module({
  imports: [StorageModule, OptimizationModule, HeavyTasksQueueModule],
  controllers: [FilesController],
  providers: [FilesService, ExifService, UrlDownloadService],
  exports: [FilesService],
})
export class FilesModule {}
