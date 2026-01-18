import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { ImageProcessingConfig } from '../../config/image-processing.config.js';
import { ImageProcessingClient } from './image-processing.client.js';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const cfg = configService.get<ImageProcessingConfig>('imageProcessing')!;

        return {
          baseURL: cfg.baseUrl,
          timeout: cfg.requestTimeoutMs,
          maxRedirects: 0,
        };
      },
    }),
  ],
  providers: [ImageProcessingClient],
  exports: [ImageProcessingClient],
})
export class ImageProcessingModule {}
