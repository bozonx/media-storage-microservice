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
import { Upload } from '@aws-sdk/lib-storage';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StorageConfig } from '../../config/storage.config.js';

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
    onAbort?: () => void;
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
          params.onAbort?.();
        });
        params.body.once('close', () => {
          if (!params.body.readableEnded) {
            uploader.abort().catch(() => {});
            params.onAbort?.();
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
        etag: response.ETag ? response.ETag.replace(/\"/g, '') : undefined,
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
        etag: response.ETag ? response.ETag.replace(/\"/g, '') : undefined,
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
