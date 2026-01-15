import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { StorageConfig } from '../../config/storage.config.js';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
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

  async uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      });

      await this.s3Client.send(command);
      this.logger.log(`File uploaded successfully: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to upload file to S3: ${key}`, error);
      throw new InternalServerErrorException('Failed to upload file to storage');
    }
  }

  async downloadFile(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error('Empty response body');
      }

      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];

      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Failed to download file from S3: ${key}`, error);
      throw new InternalServerErrorException('Failed to download file from storage');
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted successfully: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file from S3: ${key}`, error);
      throw new InternalServerErrorException('Failed to delete file from storage');
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
      this.logger.error('S3 connection check failed', error);
      return false;
    }
  }
}
