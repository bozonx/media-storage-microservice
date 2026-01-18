import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module.js';
import { ImageProcessingModule } from '../image-processing/image-processing.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ThumbnailController } from './thumbnail.controller.js';
import { ThumbnailService } from './thumbnail.service.js';

@Module({
  imports: [PrismaModule, StorageModule, FilesModule, ImageProcessingModule],
  controllers: [ThumbnailController],
  providers: [ThumbnailService],
  exports: [ThumbnailService],
})
export class ThumbnailModule {}
