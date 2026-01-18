import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { ImageProcessingClient } from '../image-processing/image-processing.client.js';
import { StorageService } from '../storage/storage.service.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;
const DEFAULT_MAX_BYTES = 25 * BYTES_PER_MEGABYTE;

@Injectable()
export class ExifService {
  private readonly maxBytes: number;

  constructor(
    @InjectPinoLogger(ExifService.name)
    private readonly logger: PinoLogger,
    private readonly storageService: StorageService,
    private readonly imageProcessingClient: ImageProcessingClient,
  ) {
    const parsedMb = this.parseMegabytes(process.env.IMAGE_MAX_BYTES_MB);
    this.maxBytes = parsedMb ?? DEFAULT_MAX_BYTES;
  }

  async tryExtractFromBuffer(params: {
    buffer: Buffer;
    mimeType: string;
  }): Promise<Record<string, any> | undefined> {
    if (this.maxBytes === 0) {
      return undefined;
    }

    if (!this.isImage(params.mimeType)) {
      return undefined;
    }

    if (params.buffer.length > this.maxBytes) {
      this.logger.debug(
        { size: params.buffer.length, maxBytes: this.maxBytes },
        'Skip EXIF extraction: file too large',
      );
      return undefined;
    }

    try {
      const res = await this.imageProcessingClient.exif({
        buffer: params.buffer,
        mimeType: params.mimeType,
        priority: 0,
      });

      if (!res.exif || typeof res.exif !== 'object') {
        return undefined;
      }

      return res.exif;
    } catch (err) {
      this.logger.debug({ err }, 'Failed to extract EXIF');
      return undefined;
    }
  }

  async tryExtractFromStorageKey(params: {
    key: string;
    mimeType: string;
  }): Promise<Record<string, any> | undefined> {
    if (this.maxBytes === 0) {
      return undefined;
    }

    if (!this.isImage(params.mimeType)) {
      return undefined;
    }

    try {
      const { stream, contentLength } = await this.storageService.downloadStream(params.key);

      if (typeof contentLength === 'number' && contentLength > this.maxBytes) {
        this.logger.debug(
          { contentLength, maxBytes: this.maxBytes },
          'Skip EXIF extraction: file too large',
        );
        return undefined;
      }

      const buffer = await this.readToBufferWithLimit(stream, this.maxBytes);

      const res = await this.imageProcessingClient.exif({
        buffer: buffer,
        mimeType: params.mimeType,
        priority: 0,
      });

      if (!res.exif || typeof res.exif !== 'object') {
        return undefined;
      }

      return res.exif;
    } catch (err) {
      this.logger.debug({ err }, 'Failed to extract EXIF');
      return undefined;
    }
  }

  private isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  private async readToBufferWithLimit(
    stream: NodeJS.ReadableStream,
    maxBytes: number,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream as any) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        throw new Error('EXIF read limit exceeded');
      }
      chunks.push(buf);
    }

    return Buffer.concat(chunks);
  }

  private parseMegabytes(value: string | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }

    return Math.floor(parsed * BYTES_PER_MEGABYTE);
  }
}
