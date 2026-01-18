import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ThumbnailParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(4096)
  width!: number;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(4096)
  height!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  quality?: number;

  @IsIn(['cover', 'contain', 'fill', 'inside', 'outside'])
  @IsOptional()
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
}
