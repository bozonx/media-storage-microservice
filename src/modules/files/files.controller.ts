import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  Res,
  Req,
  HttpStatus,
  HttpCode,
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { basename } from 'path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FilesService } from './files.service.js';
import { ListFilesDto } from './dto/list-files.dto.js';
import { BulkDeleteFilesDto } from './dto/bulk-delete-files.dto.js';
import { CompressParamsDto } from './dto/compress-params.dto.js';

function sanitizeFilename(filename: string): string {
  const normalized = (filename ?? '').normalize('NFKC');
  const asBasename = basename(normalized.replace(/\\/g, '/'));
  const withoutCrLf = asBasename.replace(/[\r\n]/g, ' ');
  const withoutControls = withoutCrLf.replace(/[\u0000-\u001F\u007F]/g, '');
  const collapsedWhitespace = withoutControls.replace(/\s+/g, ' ');
  const withoutSeparators = collapsedWhitespace.replace(/[\/]/g, '_');
  const trimmed = withoutSeparators.trim();
  const limited = trimmed.length > 255 ? trimmed.slice(0, 255) : trimmed;
  return limited.length > 0 ? limited : 'file';
}

function buildContentDispositionHeader(filename: string): string {
  const safeFilename = sanitizeFilename(filename);
  const safeAscii = sanitizeContentDispositionFilename(safeFilename);
  const encoded = encodeRFC5987ValueChars(safeFilename);
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

  private getOptionalMultipartField(data: any, fieldName: string): string | undefined {
    const field = data?.fields?.[fieldName] as any;
    const value = typeof field?.value === 'string' ? field.value.trim() : '';
    return value.length > 0 ? value : undefined;
  }

  /**
   * Uploads a file using multipart/form-data.
   *
   * Supported multipart fields:
   * - `file` (required)
   * - `optimize` (optional JSON string, images only)
   * - `metadata` (optional JSON string)
   * - `appId` (optional string)
   * - `userId` (optional string)
   * - `purpose` (optional string)
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

    const appId = this.getOptionalMultipartField(data, 'appId');
    const userId = this.getOptionalMultipartField(data, 'userId');
    const purpose = this.getOptionalMultipartField(data, 'purpose');

    let compressParams: CompressParamsDto | undefined;
    const optimizeField = data.fields.optimize as any;
    if (optimizeField?.value) {
      try {
        const raw = JSON.parse(optimizeField.value);
        const instance = plainToInstance(CompressParamsDto, raw);
        const errors = validateSync(instance, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        if (errors.length > 0) {
          throw new Error('Validation failed');
        }
        compressParams = instance;
      } catch {
        throw new BadRequestException('Invalid optimize parameter');
      }
    }

    if (isExecutableMimeType(data.mimetype)) {
      throw new UnsupportedMediaTypeException('Executable file types are not allowed');
    }

    if (isArchiveMimeType(data.mimetype)) {
      throw new UnsupportedMediaTypeException('Archive file types are not allowed');
    }

    if (compressParams) {
      const buffer = await data.toBuffer();
      return this.filesService.uploadFile({
        buffer,
        filename: sanitizeFilename(data.filename),
        mimeType: data.mimetype,
        compressParams,
        metadata,
        appId,
        userId,
        purpose,
      });
    }

    return this.filesService.uploadFileStream({
      stream: data.file,
      filename: sanitizeFilename(data.filename),
      mimeType: data.mimetype,
      metadata,
      appId,
      userId,
      purpose,
    });
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: BulkDeleteFilesDto) {
    return this.filesService.bulkDeleteFiles(body);
  }

  @Get(':id')
  async getFileMetadata(@Param('id') id: string) {
    return this.filesService.getFileMetadata(id);
  }

  @Get(':id/exif')
  async getFileExif(@Param('id') id: string) {
    return {
      exif: await this.filesService.getFileExif(id),
    };
  }

  /**
   * Downloads a file by streaming it from storage.
   *
   * Supports:
   * - Conditional GET via `If-None-Match` (304 Not Modified)
   * - Range requests via `Range` header (206 Partial Content)
   */
  @Get(':id/download')
  async downloadFile(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const rangeHeader = request.headers['range'];
    const result = await this.filesService.downloadFileStream(id, rangeHeader);

    const ifNoneMatch = request.headers['if-none-match'];
    if (
      result.etag &&
      typeof ifNoneMatch === 'string' &&
      ifNoneMatch.replace(/\"/g, '') === result.etag
    ) {
      return reply.status(HttpStatus.NOT_MODIFIED).header('ETag', `"${result.etag}"`).send();
    }

    const statusCode = result.isPartial ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;

    const response = reply
      .status(statusCode)
      .header('Content-Type', result.mimeType)
      .header('Content-Disposition', buildContentDispositionHeader(result.filename))
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'public, max-age=31536000, immutable');

    if (result.etag) {
      response.header('ETag', `"${result.etag}"`);
    }
    if (result.contentRange) {
      response.header('Content-Range', result.contentRange);
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
