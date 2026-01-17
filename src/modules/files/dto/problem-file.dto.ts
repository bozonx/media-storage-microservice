import { Exclude, Expose } from 'class-transformer';

export interface ProblemItemDto {
  code: string;
  message: string;
}

@Exclude()
export class ProblemFileDto {
  @Expose()
  id!: string;

  @Expose()
  filename!: string;

  @Expose()
  appId?: string;

  @Expose()
  userId?: string;

  @Expose()
  purpose?: string;

  @Expose()
  status?: string;

  @Expose()
  optimizationStatus?: string;

  @Expose()
  uploadedAt?: Date;

  @Expose()
  statusChangedAt!: Date;

  @Expose()
  problems!: ProblemItemDto[];

  @Expose()
  url!: string;
}
