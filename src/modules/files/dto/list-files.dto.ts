import { IsInt, IsOptional, IsString, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

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
}
