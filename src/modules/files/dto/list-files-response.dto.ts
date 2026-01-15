import type { FileResponseDto } from './file-response.dto.js';

export class ListFilesResponseDto {
  items!: FileResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
