import { Exclude, Expose } from 'class-transformer';
import { FileStatus } from '../file-status.js';
import { OptimizationStatus } from '../optimization-status.js';

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
  statusChangedAt!: Date;

  @Expose()
  status?: FileStatus;

  @Expose()
  metadata?: Record<string, any>;

  @Expose()
  originalMimeType?: string;

  @Expose()
  optimizationStatus?: OptimizationStatus;

  @Expose()
  optimizationError?: string;

  @Expose()
  url!: string;

  @Expose()
  exif?: Record<string, any>;
}
