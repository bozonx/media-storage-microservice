import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FileStatus {
  UPLOADING = 'uploading',
  READY = 'ready',
  DELETING = 'deleting',
  DELETED = 'deleted',
  FAILED = 'failed',
  MISSING = 'missing',
}

@Entity('files')
export class FileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 100, name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column({ type: 'bigint', nullable: true, name: 'original_size' })
  originalSize: number | null;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  checksum: string;

  @Column({ type: 'varchar', length: 500, name: 's3_key' })
  @Index()
  s3Key: string;

  @Column({ type: 'varchar', length: 100, name: 's3_bucket' })
  s3Bucket: string;

  @Column({
    type: 'enum',
    enum: FileStatus,
    default: FileStatus.UPLOADING,
  })
  @Index()
  status: FileStatus;

  @Column({ type: 'jsonb', nullable: true, name: 'optimization_params' })
  optimizationParams: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: 'timestamp', name: 'uploaded_at', nullable: true })
  @Index()
  uploadedAt: Date | null;

  @Column({ type: 'timestamp', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
