import { Injectable } from '@nestjs/common';
import { FileStatus } from './file-status.js';
import { OptimizationStatus } from './optimization-status.js';
import { ProblemItemDto } from './dto/problem-file.dto.js';

export interface ProblemThresholds {
  stuckUploadingAt: Date;
  stuckDeletingAt: Date;
  stuckOptimizationAt: Date;
}

@Injectable()
export class FileProblemDetector {
  detectProblems(
    file: {
      status?: any;
      deletedAt?: Date | null;
      statusChangedAt?: Date | null;
      s3Key?: string | null;
      checksum?: string | null;
      size?: bigint | null;
      uploadedAt?: Date | null;
      optimizationStatus?: any;
      optimizationError?: string | null;
      optimizationStartedAt?: Date | null;
    },
    thresholds: ProblemThresholds,
  ): ProblemItemDto[] {
    const problems: ProblemItemDto[] = [];
    const status = file.status;

    if (status === FileStatus.FAILED) {
      problems.push({ code: 'status_failed', message: 'File status is FAILED' });
    }
    if (status === FileStatus.MISSING) {
      problems.push({ code: 'status_missing', message: 'File status is MISSING' });
    }
    if (
      status === FileStatus.UPLOADING &&
      file.statusChangedAt instanceof Date &&
      file.statusChangedAt.getTime() < thresholds.stuckUploadingAt.getTime()
    ) {
      problems.push({ code: 'upload_stuck', message: 'Upload is stuck' });
    }
    if (
      status === FileStatus.DELETING &&
      file.statusChangedAt instanceof Date &&
      file.statusChangedAt.getTime() < thresholds.stuckDeletingAt.getTime()
    ) {
      problems.push({ code: 'delete_stuck', message: 'Delete is stuck' });
    }

    if (file.deletedAt && status !== FileStatus.DELETED) {
      problems.push({
        code: 'deleted_at_mismatch',
        message: 'deletedAt is set but status is not DELETED',
      });
    }
    if (!file.deletedAt && status === FileStatus.DELETED) {
      problems.push({
        code: 'deleted_at_missing',
        message: 'status is DELETED but deletedAt is not set',
      });
    }

    if (status === FileStatus.READY) {
      if (!file.s3Key) {
        problems.push({ code: 's3_key_missing', message: 'READY file has no S3 key' });
      }
      if (!file.checksum) {
        problems.push({ code: 'checksum_missing', message: 'READY file has no checksum' });
      }
      if (file.size === null || file.size === undefined) {
        problems.push({ code: 'size_missing', message: 'READY file has no size' });
      }
      if (!file.uploadedAt) {
        problems.push({ code: 'uploaded_at_missing', message: 'READY file has no uploadedAt' });
      }
    }

    if (file.optimizationStatus === OptimizationStatus.FAILED) {
      problems.push({
        code: 'optimization_failed',
        message: `Optimization failed: ${file.optimizationError || 'Unknown error'}`,
      });
    }

    if (
      (file.optimizationStatus === OptimizationStatus.PENDING ||
        file.optimizationStatus === OptimizationStatus.PROCESSING) &&
      file.optimizationStartedAt instanceof Date &&
      file.optimizationStartedAt.getTime() < thresholds.stuckOptimizationAt.getTime()
    ) {
      problems.push({ code: 'optimization_stuck', message: 'Optimization is stuck' });
    }

    return problems;
  }
}
