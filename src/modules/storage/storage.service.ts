import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Readable } from 'stream';

import { StorageConfig } from '../../config/storage.config.js';

export interface StorageDeleteManyError {
  key: string;
  code?: string;
  message?: string;
}

export interface StorageDeleteManyResult {
  deletedKeys: Set<string>;
  errors: StorageDeleteManyError[];
}

export interface StorageListObjectItem {
  key: string;
  lastModified?: Date;
}

export interface StorageListObjectsResult {
  items: StorageListObjectItem[];
  nextContinuationToken?: string;
}

@Injectable()
export class StorageService implements OnModuleDestroy {
  constructor(
    @InjectPinoLogger(StorageService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.get<StorageConfig>('storage')!;

    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });

    this.bucket = config.bucket;
  }

  private readonly s3Client: S3Client;
  private readonly bucket: string;

  onModuleDestroy(): void {
    this.s3Client.destroy();
  }

  async copyObject(params: {
    sourceKey: string;
    destinationKey: string;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    try {
      const command = new CopyObjectCommand({
        Bucket: this.bucket,
        Key: params.destinationKey,
        CopySource: `${this.bucket}/${params.sourceKey}`,
        ContentType: params.contentType,
        Metadata: params.metadata,
        MetadataDirective: params.metadata ? 'REPLACE' : undefined,
      });

      await this.s3Client.send(command);
      this.logger.info(
        { sourceKey: params.sourceKey, destinationKey: params.destinationKey },
        'File copied successfully',
      );
    } catch (error) {
      this.logger.error(
        { err: error, sourceKey: params.sourceKey, destinationKey: params.destinationKey },
        'Failed to copy file in storage',
      );
      throw this.mapS3Error(error, 'Failed to copy file in storage');
    }
  }

  async uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      });

      await this.s3Client.send(command);
      this.logger.info({ key }, 'File uploaded successfully');
    } catch (error) {
      this.logger.error({ err: error, key }, 'Failed to upload file to storage');
      throw this.mapS3Error(error, 'Failed to upload file to storage');
    }
  }

  async uploadStream(params: {
    key: string;
    body: Readable;
    mimeType: string;
    contentLength?: number;
    metadata?: Record<string, string>;
    onAbort?: () => void | Promise<void>;
  }): Promise<void> {
    const uploader = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.mimeType,
        ...(params.contentLength !== undefined && { ContentLength: params.contentLength }),
        Metadata: params.metadata,
      },
    });

    try {
      if (params.onAbort) {
        params.body.once('error', () => {
          uploader.abort().catch(() => {});
          void params.onAbort?.();
        });
        params.body.once('close', () => {
          if (!params.body.readableEnded) {
            uploader.abort().catch(() => {});
            void params.onAbort?.();
          }
        });
      }

      await uploader.done();
      this.logger.info({ key: params.key }, 'File uploaded successfully');
    } catch (error) {
      this.logger.error({ err: error, key: params.key }, 'Failed to upload file to storage');
      throw this.mapS3Error(error, 'Failed to upload file to storage');
    }
  }

  async downloadStreamWithRange(params: { key: string; range?: string }): Promise<{
    stream: Readable;
    contentLength?: number;
    contentRange?: string;
    etag?: string;
    isPartial: boolean;
  }> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        ...(params.range && { Range: params.range }),
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error('Empty response body');
      }

      return {
        stream: response.Body as Readable,
        contentLength:
          typeof response.ContentLength === 'number' ? response.ContentLength : undefined,
        contentRange: response.ContentRange,
        etag: response.ETag ? response.ETag.replace(/"/g, '') : undefined,
        isPartial: response.ContentRange !== undefined,
      };
    } catch (error) {
      this.logger.error({ err: error, key: params.key }, 'Failed to download file from storage');
      throw this.mapS3Error(error, 'Failed to download file from storage');
    }
  }

  async downloadStream(
    key: string,
  ): Promise<{ stream: Readable; contentLength?: number; etag?: string }> {
    const result = await this.downloadStreamWithRange({ key });
    return {
      stream: result.stream,
      contentLength: result.contentLength,
      etag: result.etag,
    };
  }

  async headObject(
    key: string,
  ): Promise<{ contentLength?: number; etag?: string; contentType?: string }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      return {
        contentLength:
          typeof response.ContentLength === 'number' ? response.ContentLength : undefined,
        etag: response.ETag ? response.ETag.replace(/"/g, '') : undefined,
        contentType: response.ContentType,
      };
    } catch (error) {
      this.logger.error({ err: error, key }, 'Failed to get file metadata from storage');
      throw this.mapS3Error(error, 'Failed to get file metadata from storage');
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.info({ key }, 'File deleted successfully');
    } catch (error) {
      this.logger.error({ err: error, key }, 'Failed to delete file from storage');
      throw this.mapS3Error(error, 'Failed to delete file from storage');
    }
  }

  async deleteFiles(
    keys: string[],
    params?: { chunkSize?: number },
  ): Promise<StorageDeleteManyResult> {
    const uniqueKeys = Array.from(
      new Set(keys.map(key => key.trim()).filter(key => key.length > 0)),
    );

    const chunkSize = params?.chunkSize ?? 1000;
    const deletedKeys = new Set<string>();
    const errors: StorageDeleteManyError[] = [];

    if (uniqueKeys.length === 0) {
      return { deletedKeys, errors };
    }

    for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
      const chunk = uniqueKeys.slice(i, i + chunkSize);

      try {
        const command = new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: chunk.map(Key => ({ Key })),
            Quiet: true,
          },
        });

        const response = await this.s3Client.send(command);

        for (const item of response.Deleted ?? []) {
          if (item.Key) {
            deletedKeys.add(item.Key);
          }
        }

        for (const err of response.Errors ?? []) {
          const key = err.Key;
          if (!key) {
            continue;
          }

          const code = err.Code;
          if (code === 'NoSuchKey' || code === 'NotFound') {
            deletedKeys.add(key);
            continue;
          }

          errors.push({
            key,
            code,
            message: err.Message,
          });
        }
      } catch (error) {
        this.logger.error(
          { err: error, count: chunk.length },
          'Failed to delete files from storage',
        );
        throw this.mapS3Error(error, 'Failed to delete files from storage');
      }
    }

    if (errors.length === 0) {
      this.logger.info({ count: uniqueKeys.length }, 'Files deleted successfully');
    } else {
      this.logger.warn(
        { count: uniqueKeys.length, errorCount: errors.length },
        'Batch delete completed with errors',
      );
    }

    return { deletedKeys, errors };
  }

  async listObjects(params: {
    prefix: string;
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<StorageListObjectsResult> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: params.prefix,
        ContinuationToken: params.continuationToken,
        MaxKeys: params.maxKeys,
      });

      const response = await this.s3Client.send(command);

      const items: StorageListObjectItem[] = [];
      for (const entry of response.Contents ?? []) {
        if (!entry.Key) {
          continue;
        }
        items.push({
          key: entry.Key,
          lastModified: entry.LastModified,
        });
      }

      return {
        items,
        nextContinuationToken: response.NextContinuationToken,
      };
    } catch (error) {
      this.logger.error(
        { err: error, prefix: params.prefix },
        'Failed to list objects from storage',
      );
      throw this.mapS3Error(error, 'Failed to list objects from storage');
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({
        Bucket: this.bucket,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'S3 connection check failed');
      return false;
    }
  }

  private mapS3Error(error: unknown, fallbackMessage: string): Error {
    const err = error as any;

    const statusCode: number | undefined =
      typeof err?.$metadata?.httpStatusCode === 'number'
        ? err.$metadata.httpStatusCode
        : typeof err?.statusCode === 'number'
          ? err.statusCode
          : undefined;

    const name: string | undefined = typeof err?.name === 'string' ? err.name : undefined;

    if (statusCode === 404 || name === 'NoSuchKey' || name === 'NotFound') {
      return new NotFoundException('File not found in storage');
    }

    if (statusCode === 403 || name === 'AccessDenied') {
      return new ForbiddenException('Storage access denied');
    }

    if (statusCode === 400) {
      return new BadRequestException(fallbackMessage);
    }

    if (typeof statusCode === 'number' && statusCode >= 500) {
      return new InternalServerErrorException(fallbackMessage);
    }

    return new InternalServerErrorException(fallbackMessage);
  }
}
