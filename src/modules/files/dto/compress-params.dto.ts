import { IsInt, Min, Max, IsOptional, IsIn, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class CompressParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  quality?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  @IsOptional()
  maxWidth?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  @IsOptional()
  maxHeight?: number;

  @IsIn(['webp', 'avif'])
  @IsOptional()
  format?: 'webp' | 'avif';

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  lossless?: boolean;

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  stripMetadata?: boolean;
}
