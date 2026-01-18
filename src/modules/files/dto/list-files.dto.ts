import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListFilesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  @IsIn(['uploadedAt', 'size', 'filename'])
  sortBy?: string = 'uploadedAt';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  appId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  purpose?: string;
}
