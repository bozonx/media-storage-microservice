import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { FormData, request } from 'undici';

import type { ImageProcessingConfig } from '../../config/image-processing.config.js';

export interface ImageProcessingProcessRequest {
  buffer: Buffer;
  mimeType: string;
  priority?: number;
  transform?: Record<string, any>;
  output?: Record<string, any>;
  watermark?: {
    buffer: Buffer;
    mimeType: string;
  };
}

export interface ImageProcessingHealthResponse {
  status: string;
  timestamp: string;
  queue: {
    size: number;
    pending: number;
  };
}

export interface ImageProcessingProcessResponse {
  buffer: Buffer;
  mimeType: string;
}

export interface ImageProcessingExifRequest {
  buffer: Buffer;
  mimeType: string;
  priority?: number;
}

export interface ImageProcessingExifResponse {
  exif: Record<string, any> | null;
}

@Injectable()
export class ImageProcessingClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    @InjectPinoLogger(ImageProcessingClient.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    const cfg = this.configService.get<ImageProcessingConfig>('imageProcessing')!;
    this.baseUrl = cfg.baseUrl;
    this.timeout = cfg.requestTimeoutMs;
  }

  async process(req: ImageProcessingProcessRequest): Promise<ImageProcessingProcessResponse> {
    try {
      const formData = new FormData();

      // Add main image file
      const imageBlob = new Blob([req.buffer as any], { type: req.mimeType });
      formData.append('file', imageBlob, 'image');

      // Add watermark if provided
      if (req.watermark) {
        const watermarkBlob = new Blob([req.watermark.buffer as any], {
          type: req.watermark.mimeType,
        });
        formData.append('watermark', watermarkBlob, 'watermark');
      }

      // Add processing parameters
      const params: Record<string, any> = {};
      if (req.priority !== undefined) {
        params.priority = req.priority;
      }
      if (req.transform) {
        params.transform = req.transform;
      }
      if (req.output) {
        params.output = req.output;
      }

      if (Object.keys(params).length > 0) {
        formData.append('params', JSON.stringify(params));
      }

      const { statusCode, headers, body } = await request(`${this.baseUrl}/process`, {
        method: 'POST',
        body: formData,
        bodyTimeout: this.timeout,
        headersTimeout: this.timeout,
      });

      if (statusCode >= 400) {
        throw await this.mapResponseError(statusCode, body, 'Image processing failed');
      }

      // Response is binary stream
      const arrayBuffer = await body.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Extract Content-Type from response headers
      const contentType = (headers['content-type'] as string) || req.mimeType;

      return {
        buffer,
        mimeType: contentType,
      };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof GatewayTimeoutException ||
        err instanceof ServiceUnavailableException ||
        err instanceof BadGatewayException
      ) {
        throw err;
      }
      throw this.mapConnectionError(err, 'Image processing failed');
    }
  }

  async exif(req: ImageProcessingExifRequest): Promise<ImageProcessingExifResponse> {
    try {
      const formData = new FormData();

      // Add image file
      const blob = new Blob([req.buffer as any], { type: req.mimeType });
      formData.append('file', blob, 'image');

      // Add priority parameter if provided
      if (req.priority !== undefined) {
        formData.append('params', JSON.stringify({ priority: req.priority }));
      }

      const { statusCode, body } = await request(`${this.baseUrl}/exif`, {
        method: 'POST',
        body: formData,
        bodyTimeout: this.timeout,
        headersTimeout: this.timeout,
      });

      if (statusCode >= 400) {
        throw await this.mapResponseError(statusCode, body, 'EXIF extraction failed');
      }

      return (await body.json()) as ImageProcessingExifResponse;
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof GatewayTimeoutException ||
        err instanceof ServiceUnavailableException ||
        err instanceof BadGatewayException
      ) {
        throw err;
      }
      throw this.mapConnectionError(err, 'EXIF extraction failed');
    }
  }

  async health(): Promise<ImageProcessingHealthResponse> {
    try {
      const { statusCode, body } = await request(`${this.baseUrl}/health`, {
        method: 'GET',
        headersTimeout: 2000,
        bodyTimeout: 2000,
      });

      if (statusCode >= 400) {
        throw new ServiceUnavailableException('Image processing service health check failed');
      }

      return (await body.json()) as ImageProcessingHealthResponse;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        throw err;
      }
      throw new ServiceUnavailableException('Image processing service is unreachable');
    }
  }

  private async mapResponseError(
    status: number,
    body: any,
    fallbackMessage: string,
  ): Promise<Error> {
    let responseMessage: string | undefined;
    try {
      const text = await body.text();
      try {
        const data = JSON.parse(text);
        responseMessage = typeof data === 'string' ? data : data?.message;
      } catch {
        // Fallback to raw text if not JSON
        responseMessage = text.trim();
      }
    } catch {
      // Body could not be read
    }

    const finalMessage = responseMessage || fallbackMessage;

    if (status >= 400 && status < 500) {
      return new BadRequestException(finalMessage);
    }

    if (status >= 500) {
      this.logger.error(
        { status, responseMessage },
        'Image processing service responded with server error',
      );
      return new BadGatewayException(finalMessage);
    }

    return new BadRequestException(finalMessage);
  }

  private mapConnectionError(err: any, fallbackMessage: string): Error {
    const code = err?.code;

    if (
      code === 'UND_ERR_HEADERS_TIMEOUT' ||
      code === 'UND_ERR_BODY_TIMEOUT' ||
      code === 'ECONNABORTED'
    ) {
      return new GatewayTimeoutException(fallbackMessage);
    }

    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EHOSTUNREACH' ||
      code === 'ENETUNREACH' ||
      code === 'UND_ERR_CONNECT_TIMEOUT'
    ) {
      return new ServiceUnavailableException(fallbackMessage);
    }

    this.logger.error({ err }, 'Image processing service request failed');
    return new BadRequestException(fallbackMessage);
  }
}
