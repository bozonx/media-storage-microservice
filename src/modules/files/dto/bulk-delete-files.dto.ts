import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BulkDeleteFilesDto {
  @IsOptional()
  @IsString()
  appId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  @Type(() => Number)
  limit?: number = 1000;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  dryRun?: boolean = false;
}
