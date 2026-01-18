import { Module } from '@nestjs/common';
import { ImageProcessingClient } from './image-processing.client.js';

@Module({
  providers: [ImageProcessingClient],
  exports: [ImageProcessingClient],
})
export class ImageProcessingModule {}
