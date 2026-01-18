import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListProblemFilesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 10;
}
