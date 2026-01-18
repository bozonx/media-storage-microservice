import { registerAs } from '@nestjs/config';
import { plainToClass } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, validateSync } from 'class-validator';

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

class StorageConfigClass implements StorageConfig {
  @IsString()
  @IsNotEmpty()
  public endpoint!: string;

  @IsString()
  @IsNotEmpty()
  public region!: string;

  @IsString()
  @IsNotEmpty()
  public accessKeyId!: string;

  @IsString()
  @IsNotEmpty()
  public secretAccessKey!: string;

  @IsString()
  @IsNotEmpty()
  public bucket!: string;

  @IsBoolean()
  public forcePathStyle!: boolean;
}

export default registerAs('storage', (): StorageConfig => {
  const config = plainToClass(StorageConfigClass, {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:3900',
    region: process.env.S3_REGION || 'garage',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    bucket: process.env.S3_BUCKET || 'media-files',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  });

  const errors = validateSync(config, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map(err => Object.values(err.constraints ?? {}).join(', '));
    throw new Error(`Storage config validation error: ${errorMessages.join('; ')}`);
  }

  return config;
});
