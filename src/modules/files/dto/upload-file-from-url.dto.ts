import { IsOptional, IsString, IsUrl, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { CompressParamsDto } from './compress-params.dto.js';

export class UploadFileFromUrlDto {
  @IsUrl({ require_protocol: true })
  url!: string;

  @IsString()
  @IsOptional()
  filename?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsString()
  @IsOptional()
  appId?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  purpose?: string;

  @ValidateNested()
  @Type(() => CompressParamsDto)
  @IsOptional()
  optimize?: CompressParamsDto;
}
