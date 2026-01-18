export { FileStatus } from '../../../generated/prisma/enums.js';

export interface FileEntity {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  originalSize: number | null;
  checksum: string;
  s3Key: string;
  s3Bucket: string;
  status: string;
  optimizationParams: Record<string, any> | null;
  metadata: Record<string, any> | null;
  uploadedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
