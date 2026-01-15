import { registerAs } from '@nestjs/config';

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

export default registerAs(
  'storage',
  (): StorageConfig => ({
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:3900',
    region: process.env.S3_REGION || 'garage',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    bucket: process.env.S3_BUCKET || 'media-files',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  }),
);
