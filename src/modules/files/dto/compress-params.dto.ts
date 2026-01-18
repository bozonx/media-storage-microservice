import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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
  maxDimension?: number;

  @IsIn(['webp', 'avif'])
  @IsOptional()
  format?: 'webp' | 'avif';

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  lossless?: boolean;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  stripMetadata?: boolean;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  autoOrient?: boolean;
}
