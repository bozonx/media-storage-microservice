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
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { FilesService } from './files.service.js';
import { ListFilesDto } from './dto/list-files.dto.js';
import { OptimizeParamsDto } from './dto/optimize-params.dto.js';

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
        optimizeParams = JSON.parse(optimizeField.value);
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

    const buffer = await data.toBuffer();

    return this.filesService.uploadFile({
      buffer,
      filename: data.filename,
      mimeType: data.mimetype,
      optimizeParams,
      metadata,
    });
  }

  @Get(':id')
  async getFileMetadata(@Param('id') id: string) {
    return this.filesService.getFileMetadata(id);
  }

  @Get(':id/download')
  async downloadFile(@Param('id') id: string, @Res() reply: FastifyReply) {
    const result = await this.filesService.downloadFile(id);

    reply
      .status(HttpStatus.OK)
      .header('Content-Type', result.mimeType)
      .header('Content-Length', result.size.toString())
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.buffer);
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
