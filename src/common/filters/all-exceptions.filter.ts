import {
  type ArgumentsHost,
  Catch,
  ConflictException,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

function isPrismaKnownRequestError(exception: unknown): exception is {
  name: string;
  code: string;
} {
  if (typeof exception !== 'object' || exception === null) {
    return false;
  }

  const e = exception as Record<string, unknown>;
  return e.name === 'PrismaClientKnownRequestError' && typeof e.code === 'string';
}

/**
 * Global exception filter that catches all exceptions
 * and formats them in a consistent way for Fastify responses
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const normalized = this.normalizeException(exception);
    const status = normalized.status;
    const message = normalized.message;
    const errorResponse = normalized.errorResponse;

    if (status >= 500) {
      this.logger.error(
        {
          err: exception,
          req: {
            method: request.method,
            url: request.url,
          },
          statusCode: status,
        },
        'Unhandled exception',
      );
    } else {
      this.logger.warn(
        {
          req: {
            method: request.method,
            url: request.url,
          },
          statusCode: status,
        },
        message,
      );
    }

    void response.status(status).send({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      error: errorResponse,
    });
  }

  private normalizeException(exception: unknown): {
    status: number;
    message: string;
    errorResponse?: object;
  } {
    if (isPrismaKnownRequestError(exception)) {
      if (exception.code === 'P2002') {
        const mapped = new ConflictException('Resource already exists');
        return this.fromHttpException(mapped);
      }
      if (exception.code === 'P2025') {
        const mapped = new NotFoundException('Resource not found');
        return this.fromHttpException(mapped);
      }
    }

    if (exception instanceof HttpException) {
      const base = this.fromHttpException(exception);
      if (base.status >= 500) {
        return {
          status: base.status,
          message: 'Internal server error',
          errorResponse: undefined,
        };
      }
      return base;
    }

    const status =
      typeof (exception as { statusCode?: unknown })?.statusCode === 'number'
        ? (exception as { statusCode: number }).statusCode
        : HttpStatus.INTERNAL_SERVER_ERROR;

    return {
      status,
      message: status >= 500 ? 'Internal server error' : 'Request failed',
      errorResponse: undefined,
    };
  }

  private fromHttpException(exception: HttpException): {
    status: number;
    message: string;
    errorResponse?: object;
  } {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { status, message: response, errorResponse: undefined };
    }

    if (typeof response === 'object' && response !== null) {
      const message = this.extractHttpExceptionMessage(exception, response);

      const safeResponse: Record<string, unknown> = {};
      if ('error' in response && typeof (response as any).error === 'string') {
        safeResponse.error = (response as any).error;
      }
      if ('message' in response) {
        safeResponse.message = (response as any).message;
      }

      return {
        status,
        message,
        errorResponse: Object.keys(safeResponse).length > 0 ? safeResponse : undefined,
      };
    }

    return { status, message: exception.message, errorResponse: undefined };
  }

  private extractHttpExceptionMessage(exception: HttpException, response: object): string {
    if ('message' in response) {
      const msg = (response as { message: unknown }).message;
      if (Array.isArray(msg)) {
        return msg.join(', ');
      }
      if (typeof msg === 'string') {
        return msg;
      }
    }

    return exception.message;
  }
}
