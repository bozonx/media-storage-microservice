import { IsInt, Min, Max, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

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
}
