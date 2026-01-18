import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Readable, Transform } from 'stream';

import type { UrlUploadConfig } from '../../config/url-upload.config.js';

const BLOCKED_HOSTNAME_SUFFIXES = new Set([
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.svc',
  '.cluster.local',
]);

function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) {
    return false;
  }
  const a = Number(m[1]);
  const b = Number(m[2]);

  if (a === 10) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('fe80:')) {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  return false;
}

function isIpLiteral(hostname: string): boolean {
  return /^(\d+\.){3}\d+$/.test(hostname) || hostname.includes(':');
}

function isBlockedHostnameByPolicy(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return true;
  }

  if (host === 'localhost') {
    return true;
  }

  if (!host.includes('.')) {
    return true;
  }

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

@Injectable()
export class UrlDownloadService {
  constructor(
    @InjectPinoLogger(UrlDownloadService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {}

  private getConfig(): UrlUploadConfig {
    return this.configService.get<UrlUploadConfig>('urlUpload')!;
  }

  private async assertUrlAllowed(params: { url: URL; blockUnsafeConnections: boolean }) {
    const { url, blockUnsafeConnections } = params;

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('Unsupported URL protocol');
    }

    if (blockUnsafeConnections && url.protocol !== 'https:') {
      throw new BadRequestException('Only HTTPS URLs are allowed');
    }

    const hostname = url.hostname;
    if (!hostname) {
      throw new BadRequestException('Invalid URL hostname');
    }

    if (blockUnsafeConnections && isBlockedHostnameByPolicy(hostname)) {
      throw new BadRequestException('URL hostname is not allowed');
    }

    if (blockUnsafeConnections) {
      if (isIpLiteral(hostname)) {
        if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
          throw new BadRequestException('URL hostname is not allowed');
        }
        return;
      }

      try {
        const res = await lookup(hostname, { all: true });
        if (res.length === 0) {
          throw new Error('No addresses');
        }

        for (const addr of res) {
          if (addr.family === 4 && isPrivateIpv4(addr.address)) {
            throw new BadRequestException('URL hostname is not allowed');
          }
          if (addr.family === 6 && isPrivateIpv6(addr.address)) {
            throw new BadRequestException('URL hostname is not allowed');
          }
        }
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw err;
        }
        this.logger.warn({ err, hostname }, 'Failed to resolve hostname');
        throw new BadRequestException('Failed to resolve URL hostname');
      }
    }
  }

  private async readBodyAsStream(response: Response): Promise<Readable> {
    const body = response.body;
    if (!body) {
      throw new BadRequestException('Empty response body');
    }

    return Readable.fromWeb(body as any);
  }

  private createSizeLimitStream(params: { maxBytes: number }): Transform {
    let total = 0;
    return new Transform({
      transform: (chunk, _encoding, callback) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > params.maxBytes) {
          callback(new BadRequestException('File is too large'));
          return;
        }
        callback(null, buf);
      },
    });
  }

  private createDownloadGuardStream(params: {
    maxBytes: number;
    timeoutMs: number;
    expectedContentLength?: number;
    onTimeout: () => void;
  }): Transform {
    let total = 0;

    let timeout: NodeJS.Timeout | undefined;
    const clearTimer = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
    };

    const resetTimer = (stream: Transform) => {
      clearTimer();
      timeout = setTimeout(() => {
        try {
          params.onTimeout();
        } finally {
          stream.destroy(new BadRequestException('Download timeout'));
        }
      }, params.timeoutMs);
    };

    const guard = new Transform({
      transform: (chunk, _encoding, callback) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;

        if (total > params.maxBytes) {
          callback(new BadRequestException('File is too large'));
          return;
        }

        resetTimer(guard);
        callback(null, buf);
      },
      final: callback => {
        clearTimer();
        if (
          typeof params.expectedContentLength === 'number' &&
          Number.isFinite(params.expectedContentLength) &&
          total !== params.expectedContentLength
        ) {
          callback(new BadRequestException('Corrupted download: content-length mismatch'));
          return;
        }
        callback();
      },
    });

    guard.on('close', () => {
      clearTimer();
    });
    guard.on('error', () => {
      clearTimer();
    });

    resetTimer(guard);
    return guard;
  }

  private async readToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async download(params: { url: string }): Promise<{
    stream: Readable;
    filename?: string;
    mimeType?: string;
    contentLength?: number;
  }> {
    const cfg = this.getConfig();

    const blockUnsafeConnections = cfg.blockUnsafeConnections;

    let url: URL;
    try {
      url = new URL(params.url);
    } catch {
      throw new BadRequestException('Invalid url');
    }

    const controller = new AbortController();

    let activeRawStream: Readable | undefined;
    const onTimeout = () => {
      try {
        controller.abort();
      } catch {
        // Ignore abort errors
      }
      if (activeRawStream) {
        activeRawStream.destroy(new BadRequestException('Download timeout'));
      }
    };

    try {
      let currentUrl = url;
      for (let redirect = 0; redirect <= cfg.maxRedirects; redirect += 1) {
        await this.assertUrlAllowed({ url: currentUrl, blockUnsafeConnections });

        const response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        });

        const location = response.headers.get('location');
        const isRedirect = response.status >= 300 && response.status < 400;

        if (isRedirect) {
          if (!location) {
            throw new BadRequestException('Redirect without location');
          }
          if (redirect === cfg.maxRedirects) {
            throw new BadRequestException('Too many redirects');
          }
          currentUrl = new URL(location, currentUrl);
          continue;
        }

        if (!response.ok) {
          throw new BadRequestException(`Failed to download file: HTTP ${response.status}`);
        }

        const contentLengthHeader = response.headers.get('content-length');
        const contentLength = contentLengthHeader
          ? Number.parseInt(contentLengthHeader, 10)
          : undefined;

        if (
          typeof contentLength === 'number' &&
          Number.isFinite(contentLength) &&
          contentLength > cfg.maxBytes
        ) {
          throw new BadRequestException('File is too large');
        }

        const mimeType = response.headers.get('content-type') ?? undefined;

        const rawStream = await this.readBodyAsStream(response);
        activeRawStream = rawStream;

        const stream = rawStream.pipe(
          this.createDownloadGuardStream({
            maxBytes: cfg.maxBytes,
            timeoutMs: cfg.timeoutMs,
            expectedContentLength: contentLength,
            onTimeout,
          }),
        );

        const filename = undefined;

        return {
          stream,
          filename,
          mimeType,
          contentLength,
        };
      }

      throw new BadRequestException('Too many redirects');
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        throw new BadRequestException('Download timeout');
      }
      this.logger.error({ err, url: params.url }, 'Failed to download url');
      throw new BadRequestException('Failed to download url');
    }
  }

  async downloadToBuffer(params: { url: string }): Promise<{
    buffer: Buffer;
    filename?: string;
    mimeType?: string;
  }> {
    const result = await this.download({ url: params.url });
    try {
      const buffer = await this.readToBuffer(result.stream);
      return {
        buffer,
        filename: result.filename,
        mimeType: result.mimeType,
      };
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error({ err, url: params.url }, 'Failed to read downloaded stream');
      throw new BadRequestException('Failed to download url');
    }
  }
}
