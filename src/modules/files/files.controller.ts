import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Res,
  Req,
  HttpStatus,
  HttpCode,
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FilesService } from './files.service.js';
import { ListFilesDto } from './dto/list-files.dto.js';

function buildContentDispositionHeader(filename: string): string {
  const safeAscii = sanitizeContentDispositionFilename(filename);
  const encoded = encodeRFC5987ValueChars(filename);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

function sanitizeContentDispositionFilename(filename: string): string {
  const stripped = filename.replace(/[\r\n]/g, ' ').trim();
  const noQuotes = stripped.replace(/"/g, "'");
  const noBackslash = noQuotes.replace(/\\/g, '_');
  const normalized = noBackslash.replace(/[\u0000-\u001F\u007F]/g, '');
  return normalized.length > 0 ? normalized : 'file';
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(/['()]/g, escape).replace(/\*/g, '%2A');
}

/**
 * Returns true if uploads of the given MIME type should be blocked as executable content.
 *
 * Can be toggled via `BLOCK_EXECUTABLE_UPLOADS=false`.
 */
function isExecutableMimeType(mimeType: string): boolean {
  const enabled = (process.env.BLOCK_EXECUTABLE_UPLOADS ?? 'true') !== 'false';
  if (!enabled) {
    return false;
  }

  const defaults = new Set([
    'application/x-msdownload',
    'application/x-dosexec',
    'application/x-msi',
    'application/x-bat',
    'application/x-executable',
    'application/x-sh',
    'application/x-elf',
    'application/x-mach-binary',
    'application/java-archive',
  ]);

  const extra = (process.env.BLOCKED_MIME_TYPES ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  for (const v of extra) {
    defaults.add(v);
  }

  return defaults.has(mimeType);
}

/**
 * Returns true if uploads of the given MIME type should be blocked as archive content.
 *
 * Can be toggled via `BLOCK_ARCHIVE_UPLOADS=false`.
 */
function isArchiveMimeType(mimeType: string): boolean {
  const enabled = (process.env.BLOCK_ARCHIVE_UPLOADS ?? 'true') !== 'false';
  if (!enabled) {
    return false;
  }

  const archiveMimeTypes = new Set([
    'application/zip',
    'application/x-zip-compressed',
    'application/x-tar',
    'application/x-gzip',
    'application/gzip',
    'application/x-gtar',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/x-bzip',
    'application/x-bzip2',
    'application/x-compress',
    'application/x-lzh',
    'application/x-stuffit',
    'application/x-sit',
    'application/java-archive',
  ]);

  return archiveMimeTypes.has(mimeType);
}

@Controller('api/v1/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * Uploads a file using multipart/form-data.
   *
   * Supported multipart fields:
   * - `file` (required)
   * - `optimize` (optional JSON string, images only)
   * - `metadata` (optional JSON string)
   *
   * Depending on `optimize` presence, the controller either:
   * - reads the whole file into memory and performs optional image optimization, or
   * - streams the upload directly to storage.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async uploadFile(@Req() request: FastifyRequest) {
    const data = await request.file();

    if (!data) {
      throw new BadRequestException('File is required');
    }

    let metadata: Record<string, any> | undefined;

    const metadataField = data.fields.metadata as any;

    if (metadataField?.value) {
      try {
        metadata = JSON.parse(metadataField.value);
      } catch {
        throw new BadRequestException('Invalid metadata parameter');
      }
    }

    if (isExecutableMimeType(data.mimetype)) {
      throw new UnsupportedMediaTypeException('Executable file types are not allowed');
    }

    if (isArchiveMimeType(data.mimetype)) {
      throw new UnsupportedMediaTypeException('Archive file types are not allowed');
    }

    return this.filesService.uploadFileStream({
      stream: data.file,
      filename: data.filename,
      mimeType: data.mimetype,
      metadata,
    });
  }

  @Get(':id')
  async getFileMetadata(@Param('id') id: string) {
    return this.filesService.getFileMetadata(id);
  }

  /**
   * Downloads a file by streaming it from storage.
   *
   * If the service provides an `etag`, the handler supports conditional GET via `If-None-Match`.
   */
  @Get(':id/download')
  async downloadFile(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.filesService.downloadFileStream(id);

    const ifNoneMatch = request.headers['if-none-match'];
    if (
      result.etag &&
      typeof ifNoneMatch === 'string' &&
      ifNoneMatch.replace(/\"/g, '') === result.etag
    ) {
      return reply.status(HttpStatus.NOT_MODIFIED).header('ETag', `"${result.etag}"`).send();
    }

    const response = reply
      .status(HttpStatus.OK)
      .header('Content-Type', result.mimeType)
      .header('Content-Disposition', buildContentDispositionHeader(result.filename))
      .header('Cache-Control', 'public, max-age=31536000, immutable');

    if (result.etag) {
      response.header('ETag', `"${result.etag}"`);
    }
    if (typeof result.size === 'number') {
      response.header('Content-Length', result.size.toString());
    }

    return response.send(result.stream);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFile(@Param('id') id: string) {
    await this.filesService.deleteFile(id);
  }

  @Get()
  async listFiles(@Query() query: ListFilesDto) {
    return this.filesService.listFiles(query);
  }
}
