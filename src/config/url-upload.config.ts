import { registerAs } from '@nestjs/config';

export interface UrlUploadConfig {
  blockUnsafeConnections: boolean;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export default registerAs(
  'urlUpload',
  (): UrlUploadConfig => {
    const imageMax = parsePositiveInt(process.env.IMAGE_MAX_BYTES_MB, 25);
    const videoMax = parsePositiveInt(process.env.VIDEO_MAX_BYTES_MB, 100);
    const audioMax = parsePositiveInt(process.env.AUDIO_MAX_BYTES_MB, 50);
    const documentMax = parsePositiveInt(process.env.DOCUMENT_MAX_BYTES_MB, 50);
    const fallbackMax = Math.max(imageMax, videoMax, audioMax, documentMax);

    return {
      blockUnsafeConnections: (process.env.URL_UPLOAD_BLOCK_UNSAFE_CONNECTIONS ?? 'true') !== 'false',
      timeoutMs: parsePositiveInt(process.env.URL_UPLOAD_TIMEOUT_MS, 15000),
      maxBytes: parsePositiveInt(process.env.URL_UPLOAD_MAX_BYTES_MB, fallbackMax) * 1024 * 1024,
      maxRedirects: parsePositiveInt(process.env.URL_UPLOAD_MAX_REDIRECTS, 3),
    };
  },
);
