import { Module } from '@nestjs/common';
import { ThumbnailService } from './thumbnail.service.js';
import { ThumbnailController } from './thumbnail.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { FilesModule } from '../files/files.module.js';
import { ImageProcessingModule } from '../image-processing/image-processing.module.js';

@Module({
  imports: [PrismaModule, StorageModule, FilesModule, ImageProcessingModule],
  controllers: [ThumbnailController],
  providers: [ThumbnailService],
  exports: [ThumbnailService],
})
export class ThumbnailModule {}
