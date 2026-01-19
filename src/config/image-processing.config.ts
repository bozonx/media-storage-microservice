import { registerAs } from '@nestjs/config';

export interface ImageProcessingConfig {
  baseUrl: string;
  requestTimeoutMs: number;
}

export default registerAs(
  'imageProcessing',
  (): ImageProcessingConfig => ({
    baseUrl: process.env.IMAGE_PROCESSING_BASE_URL || 'http://localhost:8080/api/v1',
    requestTimeoutMs:
      Number.parseInt(process.env.IMAGE_PROCESSING_REQUEST_TIMEOUT || '60', 10) *
      1000,
  }),
);
