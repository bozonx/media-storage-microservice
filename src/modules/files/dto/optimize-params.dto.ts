import { IsBoolean, IsInt, IsOptional, IsString, Min, Max, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * @deprecated Use CompressParamsDto instead. This DTO is kept for backward compatibility.
 */
export class OptimizeParamsDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  compress?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  quality?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxWidth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxHeight?: number;

  @IsOptional()
  @IsString()
  @IsIn(['jpeg', 'png', 'webp'])
  format?: 'jpeg' | 'png' | 'webp';
}
