import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { OptimizationModule } from '../optimization/optimization.module.js';
import { ImageProcessingModule } from '../image-processing/image-processing.module.js';
import { ExifService } from './exif.service.js';
import { UrlDownloadService } from './url-download.service.js';

@Module({
  imports: [StorageModule, OptimizationModule, ImageProcessingModule],
  controllers: [FilesController],
  providers: [FilesService, ExifService, UrlDownloadService],
  exports: [FilesService],
})
export class FilesModule {}
