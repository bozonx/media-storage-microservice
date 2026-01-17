import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { OptimizationModule } from '../optimization/optimization.module.js';
import { ExifService } from './exif.service.js';

@Module({
  imports: [StorageModule, OptimizationModule],
  controllers: [FilesController],
  providers: [FilesService, ExifService],
  exports: [FilesService],
})
export class FilesModule {}
