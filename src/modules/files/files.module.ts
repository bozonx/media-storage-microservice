import { Module } from '@nestjs/common';

import { ImageProcessingModule } from '../image-processing/image-processing.module.js';
import { OptimizationModule } from '../optimization/optimization.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ExifService } from './exif.service.js';
import { FileProblemDetector } from './file-problem.detector.js';
import { FilesController } from './files.controller.js';
import { FilesMapper } from './files.mapper.js';
import { FilesService } from './files.service.js';
import { UrlDownloadService } from './url-download.service.js';

@Module({
  imports: [StorageModule, OptimizationModule, ImageProcessingModule],
  controllers: [FilesController],
  providers: [FilesService, ExifService, UrlDownloadService, FilesMapper, FileProblemDetector],
  exports: [FilesService],
})
export class FilesModule {}
