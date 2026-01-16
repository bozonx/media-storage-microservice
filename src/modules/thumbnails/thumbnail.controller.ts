import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { FastifyReply } from 'fastify';
import { ThumbnailService } from './thumbnail.service.js';
import { ThumbnailParamsDto } from '../files/dto/thumbnail-params.dto.js';

@Controller('files')
export class ThumbnailController {
  constructor(
    @InjectPinoLogger(ThumbnailController.name)
    private readonly logger: PinoLogger,
    private readonly thumbnailService: ThumbnailService,
  ) {}

  @Get(':id/thumbnail')
  async getThumbnail(
    @Param('id') id: string,
    @Query() params: ThumbnailParamsDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.thumbnailService.getThumbnail(id, params);

    reply
      .type(result.mimeType)
      .header('Content-Length', result.size)
      .header('Cache-Control', `public, max-age=${result.cacheMaxAge}, immutable`)
      .header('ETag', `"${result.etag}"`)
      .send(result.buffer);
  }
}
