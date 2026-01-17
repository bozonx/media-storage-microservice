import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import exifr from 'exifr';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class ExifService {
  private readonly maxBytes: number;

  constructor(
    @InjectPinoLogger(ExifService.name)
    private readonly logger: PinoLogger,
    private readonly storageService: StorageService,
  ) {
    this.maxBytes = parseInt(process.env.EXIF_MAX_BYTES ?? '26214400', 10);
  }

  async tryExtractFromBuffer(params: {
    buffer: Buffer;
    mimeType: string;
  }): Promise<Record<string, any> | undefined> {
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
      const res = await exifr.parse(params.buffer, {
        translateKeys: true,
        translateValues: false,
        sanitize: true,
      });

      if (!res || typeof res !== 'object') {
        return undefined;
      }

      return res as Record<string, any>;
    } catch (err) {
      this.logger.debug({ err }, 'Failed to extract EXIF');
      return undefined;
    }
  }

  async tryExtractFromStorageKey(params: {
    key: string;
    mimeType: string;
  }): Promise<Record<string, any> | undefined> {
    if (!this.isImage(params.mimeType)) {
      return undefined;
    }

    const { stream, contentLength } = await this.storageService.downloadStream(params.key);

    if (typeof contentLength === 'number' && contentLength > this.maxBytes) {
      this.logger.debug(
        { contentLength, maxBytes: this.maxBytes },
        'Skip EXIF extraction: file too large',
      );
      return undefined;
    }

    const buffer = await this.readToBufferWithLimit(stream, this.maxBytes);
    return this.tryExtractFromBuffer({ buffer, mimeType: params.mimeType });
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
}
