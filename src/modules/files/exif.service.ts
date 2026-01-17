import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import exifr from 'exifr';
import { StorageService } from '../storage/storage.service.js';
import {
  HeavyTasksQueueService,
  TaskPriority,
} from '../heavy-tasks-queue/heavy-tasks-queue.service.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;
const DEFAULT_MAX_BYTES = 25 * BYTES_PER_MEGABYTE;

@Injectable()
export class ExifService {
  private readonly maxBytes: number;

  constructor(
    @InjectPinoLogger(ExifService.name)
    private readonly logger: PinoLogger,
    private readonly storageService: StorageService,
    private readonly heavyTasksQueue: HeavyTasksQueueService,
  ) {
    const parsedMb = this.parseMegabytes(process.env.EXIF_MAX_BYTES_MB);
    if (parsedMb !== undefined) {
      this.maxBytes = parsedMb;
      return;
    }

    const parsedBytes = this.parseBytes(process.env.EXIF_MAX_BYTES);
    if (parsedBytes !== undefined) {
      this.maxBytes = parsedBytes;
      return;
    }

    this.maxBytes = DEFAULT_MAX_BYTES;
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

    return this.heavyTasksQueue.execute(async () => {
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
    }, TaskPriority.EXIF_EXTRACTION);
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

    return this.heavyTasksQueue.execute(async () => {
      const { stream, contentLength } = await this.storageService.downloadStream(params.key);

      if (typeof contentLength === 'number' && contentLength > this.maxBytes) {
        this.logger.debug(
          { contentLength, maxBytes: this.maxBytes },
          'Skip EXIF extraction: file too large',
        );
        return undefined;
      }

      const buffer = await this.readToBufferWithLimit(stream, this.maxBytes);

      try {
        const res = await exifr.parse(buffer, {
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
    }, TaskPriority.EXIF_EXTRACTION);
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

  private parseBytes(value: string | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }

    return parsed;
  }
}
