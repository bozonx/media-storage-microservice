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
import { OptimizeParamsDto } from './dto/optimize-params.dto.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

@Controller('api/v1/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async uploadFile(@Req() request: FastifyRequest) {
    const data = await request.file();

    if (!data) {
      throw new BadRequestException('File is required');
    }

    let optimizeParams: OptimizeParamsDto | undefined;
    let metadata: Record<string, any> | undefined;

    const optimizeField = data.fields.optimize as any;
    const metadataField = data.fields.metadata as any;

    if (optimizeField?.value) {
      try {
        const raw = JSON.parse(optimizeField.value);
        const dto = plainToInstance(OptimizeParamsDto, raw);
        const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length > 0) {
          throw new BadRequestException('Invalid optimize parameter');
        }
        optimizeParams = dto;
      } catch {
        throw new BadRequestException('Invalid optimize parameter');
      }
    }

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

    if (optimizeParams) {
      if (!data.mimetype.startsWith('image/')) {
        throw new UnsupportedMediaTypeException('Optimization is supported only for images');
      }
      const buffer = await data.toBuffer();
      return this.filesService.uploadFile({
        buffer,
        filename: data.filename,
        mimeType: data.mimetype,
        optimizeParams,
        metadata,
      });
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
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
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
