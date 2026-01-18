import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { FileResponseDto } from './dto/file-response.dto.js';

@Injectable()
export class FilesMapper {
  private readonly basePath: string;

  constructor(private readonly configService: ConfigService) {
    this.basePath =
      this.configService.get<string>('app.basePath') ||
      this.configService.get<string>('BASE_PATH') ||
      '';
  }

  toResponseDto(file: any): FileResponseDto {
    const dto = plainToInstance(FileResponseDto, file, {
      excludeExtraneousValues: true,
    });

    dto.size = Number(file.size ?? 0n);
    dto.originalSize =
      file.originalSize === null || file.originalSize === undefined
        ? undefined
        : Number(file.originalSize);
    dto.checksum = file.checksum ?? '';
    dto.uploadedAt = file.uploadedAt ?? new Date(0);
    dto.statusChangedAt = file.statusChangedAt ?? new Date(0);
    dto.appId = file.appId ?? undefined;
    dto.userId = file.userId ?? undefined;
    dto.purpose = file.purpose ?? undefined;

    dto.status = file.status ?? undefined;
    dto.metadata = file.metadata ?? undefined;
    dto.exif = file.exif ?? undefined;

    dto.originalMimeType = file.originalMimeType ?? undefined;
    dto.optimizationStatus = file.optimizationStatus ?? undefined;
    dto.optimizationError = file.optimizationError ?? undefined;

    dto.url = `${this.basePath ? `/${this.basePath}` : ''}/api/v1/files/${file.id}/download`;

    return dto;
  }
}
