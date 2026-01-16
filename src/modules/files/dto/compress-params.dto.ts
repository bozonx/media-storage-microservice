import { IsInt, Min, Max, IsOptional, IsIn, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

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
