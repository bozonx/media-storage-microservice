import { Exclude, Expose } from 'class-transformer';
import { FileStatus } from '../file-status.js';

@Exclude()
export class FileResponseDto {
  @Expose()
  id!: string;

  @Expose()
  filename!: string;

  @Expose()
  appId?: string;

  @Expose()
  userId?: string;

  @Expose()
  purpose?: string;

  @Expose()
  mimeType!: string;

  @Expose()
  size!: number;

  @Expose()
  originalSize?: number;

  @Expose()
  checksum!: string;

  @Expose()
  uploadedAt!: Date;

  @Expose()
  status?: FileStatus;

  @Expose()
  metadata?: Record<string, any>;

  @Expose()
  url!: string;

  @Expose()
  exif?: Record<string, any>;
}
