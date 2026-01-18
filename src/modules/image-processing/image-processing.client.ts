import {
  Injectable,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError, type AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

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
  constructor(
    @InjectPinoLogger(ImageProcessingClient.name)
    private readonly logger: PinoLogger,
    private readonly httpService: HttpService,
  ) {}

  async process(request: ImageProcessingProcessRequest): Promise<ImageProcessingProcessResponse> {
    try {
      const res = await firstValueFrom<AxiosResponse<ImageProcessingProcessResponse>>(
        this.httpService.post<ImageProcessingProcessResponse>('/process', request, {
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
      return res.data;
    } catch (err) {
      throw this.mapError(err, 'Image processing failed');
    }
  }

  async exif(request: ImageProcessingExifRequest): Promise<ImageProcessingExifResponse> {
    try {
      const formData = new FormData();

      if (Buffer.isBuffer(request.image)) {
        const blob = new Blob([request.image], { type: request.mimeType });
        formData.append('file', blob, 'image');
      } else {
        // base64
        const buffer = Buffer.from(request.image, 'base64');
        const blob = new Blob([buffer], { type: request.mimeType });
        formData.append('file', blob, 'image');
      }

      if (request.priority !== undefined) {
        formData.append('params', JSON.stringify({ priority: request.priority }));
      }

      const res = await firstValueFrom<AxiosResponse<ImageProcessingExifResponse>>(
        this.httpService.post<ImageProcessingExifResponse>('/exif', formData),
      );
      return res.data;
    } catch (err) {
      throw this.mapError(err, 'EXIF extraction failed');
    }
  }

  private mapError(err: unknown, fallbackMessage: string): Error {
    if (!this.isAxiosError(err)) {
      this.logger.error({ err }, 'Unexpected error during request to image processing service');
      return new BadRequestException(fallbackMessage);
    }

    if (err.code === 'ECONNABORTED') {
      return new GatewayTimeoutException(fallbackMessage);
    }

    if (
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      err.code === 'EHOSTUNREACH' ||
      err.code === 'ENETUNREACH'
    ) {
      return new ServiceUnavailableException(fallbackMessage);
    }

    const status = err.response?.status;

    const responseMessage = this.extractResponseMessage(err);

    if (typeof status === 'number' && status >= 400 && status < 500) {
      return new BadRequestException(responseMessage ?? fallbackMessage);
    }

    if (typeof status === 'number' && status >= 500) {
      this.logger.error(
        {
          err,
          status,
        },
        'Image processing service responded with server error',
      );
      return new BadGatewayException(fallbackMessage);
    }

    this.logger.error(
      {
        err,
        status,
      },
      'Image processing service request failed',
    );

    return new BadRequestException(fallbackMessage);
  }

  private extractResponseMessage(err: AxiosError): string | undefined {
    const data: any = err.response?.data;
    if (!data) {
      return undefined;
    }

    if (typeof data === 'string') {
      return data;
    }

    if (typeof data.message === 'string') {
      return data.message;
    }

    return undefined;
  }

  private isAxiosError(err: unknown): err is AxiosError {
    return typeof err === 'object' && err !== null && (err as any).isAxiosError === true;
  }
}
