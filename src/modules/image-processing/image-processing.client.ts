import {
  Injectable,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request, FormData } from 'undici';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ImageProcessingConfig } from '../../config/image-processing.config.js';

export interface ImageProcessingProcessRequest {
  image: string;
  mimeType: string;
  priority?: number;
  transform?: Record<string, any>;
  output?: Record<string, any>;
}

export interface ImageProcessingProcessResponse {
  buffer: string;
  size: number;
  mimeType: string;
  dimensions?: {
    width: number;
    height: number;
  };
  stats?: {
    beforeBytes: number;
    afterBytes: number;
    reductionPercent: number;
  };
}

export interface ImageProcessingExifRequest {
  image: string | Buffer;
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
      const { statusCode, body } = await request(`${this.baseUrl}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req),
        bodyTimeout: this.timeout,
        headersTimeout: this.timeout,
      });

      if (statusCode >= 400) {
        throw await this.mapResponseError(statusCode, body, 'Image processing failed');
      }

      return (await body.json()) as ImageProcessingProcessResponse;
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

      if (Buffer.isBuffer(req.image)) {
        const blob = new Blob([req.image as any], { type: req.mimeType });
        formData.append('file', blob, 'image');
      } else {
        const buffer = Buffer.from(req.image, 'base64');
        const blob = new Blob([buffer as any], { type: req.mimeType });
        formData.append('file', blob, 'image');
      }

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

  private async mapResponseError(
    status: number,
    body: any,
    fallbackMessage: string,
  ): Promise<Error> {
    let responseMessage: string | undefined;
    try {
      const data = await body.json();
      responseMessage = typeof data === 'string' ? data : data?.message;
    } catch {
      // Body might not be JSON
    }

    if (status >= 400 && status < 500) {
      return new BadRequestException(responseMessage ?? fallbackMessage);
    }

    if (status >= 500) {
      this.logger.error(
        { status, responseMessage },
        'Image processing service responded with server error',
      );
      return new BadGatewayException(fallbackMessage);
    }

    return new BadRequestException(fallbackMessage);
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
