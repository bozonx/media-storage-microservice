import { registerAs } from '@nestjs/config';
import { plainToClass } from 'class-transformer';
import { IsInt, Min, validateSync } from 'class-validator';

export class UploadConfig {
  @IsInt()
  @Min(1)
  public imageMaxBytesMb!: number;

  @IsInt()
  @Min(1)
  public videoMaxBytesMb!: number;

  @IsInt()
  @Min(1)
  public audioMaxBytesMb!: number;

  @IsInt()
  @Min(1)
  public documentMaxBytesMb!: number;

  @IsInt()
  @Min(1)
  public maxFileSizeMb!: number;
}

export default registerAs('upload', (): UploadConfig => {
  const imageMaxBytesMb = parseInt(process.env.IMAGE_MAX_BYTES_MB ?? '25', 10);
  const videoMaxBytesMb = parseInt(process.env.VIDEO_MAX_BYTES_MB ?? '100', 10);
  const audioMaxBytesMb = parseInt(process.env.AUDIO_MAX_BYTES_MB ?? '50', 10);
  const documentMaxBytesMb = parseInt(process.env.DOCUMENT_MAX_BYTES_MB ?? '50', 10);

  const maxFileSizeMb = Math.max(
    imageMaxBytesMb,
    videoMaxBytesMb,
    audioMaxBytesMb,
    documentMaxBytesMb,
  );

  const config = plainToClass(UploadConfig, {
    imageMaxBytesMb,
    videoMaxBytesMb,
    audioMaxBytesMb,
    documentMaxBytesMb,
    maxFileSizeMb,
  });

  const errors = validateSync(config, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map(err => Object.values(err.constraints ?? {}).join(', '));
    throw new Error(`Upload config validation error: ${errorMessages.join('; ')}`);
  }

  return config;
});
