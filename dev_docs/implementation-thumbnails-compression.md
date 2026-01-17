# Implementation Plan: Dynamic Thumbnails & Image Compression

## Overview

Реализация динамической генерации thumbnail с параметрами из query string и улучшенного пережатия оригинальных изображений при загрузке с использованием библиотеки Sharp.

## Goals

1. **Dynamic Thumbnails**: Генерация thumbnail по запросу с параметрами из query params
2. **Original Compression**: Пережатие оригиналов при загрузке с настраиваемыми ограничениями
3. **WebP/AVIF Format**: Использование WebP для thumbnail, WebP/AVIF для оригиналов
4. **Metadata Stripping**: Очистка EXIF/metadata для thumbnail (всегда) и оригиналов (опционально)
5. **Environment Configuration**: Гибкая настройка через переменные окружения

## Technical Stack

- **Image Processing**: Sharp (с поддержкой AVIF)
- **Format**: WebP (thumbnail), WebP/AVIF (compressed originals)
- **Storage**: Единое S3 хранилище для оригиналов и thumbnails
- **Caching**: S3 storage + DB metadata
- **CDN-Ready**: Cache-Control headers для Cloudflare
- **Metadata**: Автоматическая очистка EXIF/metadata

---

## Part 1: Dynamic Thumbnails

### 1.1 API Design

#### Endpoint
```
GET /api/v1/files/:id/thumbnail?width=300&height=200&quality=80&fit=cover
```

#### Query Parameters
- `width` (required): ширина в пикселях (10-4096)
- `height` (required): высота в пикселях (10-4096)
- `quality` (optional): качество WebP, берется из env если не указано
- `fit` (optional): режим resize - `cover`, `contain`, `fill`, `inside`, `outside` (default: `cover`)

**Note**: Metadata (EXIF, ICC profile, etc.) всегда удаляется из thumbnail для уменьшения размера.

#### Response
```
HTTP/1.1 200 OK
Content-Type: image/webp
Content-Length: <size>
Cache-Control: public, max-age=31536000, immutable
ETag: "<thumbnail-hash>"

<binary webp data>
```

#### Errors
- `400 Bad Request`: Invalid parameters (width/height out of range, unsupported fit mode)
- `404 Not Found`: File not found or not ready
- `415 Unsupported Media Type`: File is not an image

### 1.2 Environment Variables

Добавить в `.env.production.example`:

```bash
###### Thumbnails
THUMBNAIL_FORMAT=webp
THUMBNAIL_MAX_DIMENSION=2048
THUMBNAIL_MAX_AGE_DAYS=90

THUMBNAIL_QUALITY=80
THUMBNAIL_EFFORT=6

# Note: Minimum width/height hardcoded to 10px in constants
```

### 1.3 Database Schema

Добавить таблицу `Thumbnail` в Prisma schema:

```prisma
model Thumbnail {
  id              String   @id @default(uuid())
  fileId          String
  file            File     @relation(fields: [fileId], references: [id], onDelete: Cascade)
  
  s3Key           String   @unique
  s3Bucket        String
  
  width           Int
  height          Int
  quality         Int
  fit             String   // cover, contain, fill, inside, outside
  
  size            BigInt
  paramsHash      String   // SHA-256 hash of normalized params for deduplication
  
  lastAccessedAt  DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([fileId, paramsHash])
  @@index([fileId])
  @@index([lastAccessedAt])
  @@map("thumbnails")
}
```

### 1.4 Implementation Steps

#### Step 1: Configuration Module
**File**: `src/config/thumbnail.config.ts`

```typescript
// Hardcoded constants
const THUMBNAIL_MIN_SIZE = 10; // pixels

export default () => ({
  thumbnail: {
    format: (process.env.THUMBNAIL_FORMAT || 'webp') as 'webp' | 'avif',
    quality: parseInt(process.env.THUMBNAIL_QUALITY || '80', 10),
    effort: parseInt(process.env.THUMBNAIL_EFFORT || '6', 10),
    maxWidth: parseInt(process.env.THUMBNAIL_MAX_DIMENSION || '2048', 10),
    maxHeight: parseInt(process.env.THUMBNAIL_MAX_DIMENSION || '2048', 10),
    minWidth: THUMBNAIL_MIN_SIZE,
    minHeight: THUMBNAIL_MIN_SIZE,
    cacheMaxAgeSeconds: parseInt(process.env.THUMBNAIL_MAX_AGE_DAYS || '365', 10) * 24 * 60 * 60,
  },
});
```

#### Step 2: DTO для Thumbnail Parameters
**File**: `src/modules/files/dto/thumbnail-params.dto.ts`

```typescript
import { IsInt, Min, Max, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class ThumbnailParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(4096)
  width: number;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(4096)
  height: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  quality?: number;

  @IsIn(['cover', 'contain', 'fill', 'inside', 'outside'])
  @IsOptional()
  fit?: string;
}
```

#### Step 3: Thumbnail Service
**File**: `src/modules/thumbnails/thumbnail.service.ts`

Основные методы:
- `generateThumbnail(fileId, params)`: Генерация или получение из кэша
- `createThumbnail(buffer, params)`: Создание thumbnail через Sharp
- `calculateParamsHash(params)`: Хэш параметров для дедупликации
- `saveThumbnailMetadata(...)`: Сохранение в БД
- `findCachedThumbnail(fileId, paramsHash)`: Поиск в кэше

Логика:
1. Валидация параметров (размеры в пределах min/max)
2. Нормализация параметров (quality из env если не указан)
3. Вычисление paramsHash
4. Проверка кэша в БД
5. Если есть - вернуть из S3
6. Если нет - загрузить оригинал, создать thumbnail, сохранить в S3 и БД
7. Обновить lastAccessedAt

#### Step 4: Controller Endpoint
**File**: `src/modules/files/files.controller.ts`

Добавить endpoint:
```typescript
@Get(':id/thumbnail')
async getThumbnail(
  @Param('id') id: string,
  @Query() params: ThumbnailParamsDto,
  @Res() res: FastifyReply,
) {
  // Validate file exists and is an image
  // Call thumbnailService.generateThumbnail()
  // Stream from S3 with proper headers
  // Cache-Control: public, max-age=31536000, immutable
  // ETag: paramsHash
}
```

#### Step 5: Sharp Integration
**File**: `src/modules/thumbnails/thumbnail-generator.service.ts`

```typescript
async generateThumbnail(buffer: Buffer, params: ThumbnailParams): Promise<Buffer> {
  return sharp(buffer)
    .resize(params.width, params.height, {
      fit: params.fit as keyof sharp.FitEnum,
      withoutEnlargement: true,
    })
    .rotate() // Auto-rotate based on EXIF orientation
    .withMetadata(false) // Strip all metadata (EXIF, ICC profile, etc.)
    .webp({ quality: params.quality })
    .toBuffer();
}
```

### 1.5 Storage Strategy

**Single S3 Bucket**: Thumbnails и оригиналы хранятся в одном S3 bucket.

**S3 Key Structure**:
- Оригиналы: `{prefix}/{middle}/{hash}.{ext}` (например: `ab/cd/abcd1234...jpg`)
- Thumbnails: `thumbs/{fileId}/{paramsHash}.webp` (например: `thumbs/550e8400-e29b-41d4-a716-446655440000/abc123.webp`)

**Преимущества единого bucket**:
- Упрощенная конфигурация (один endpoint, одни credentials)
- Единая политика backup и retention
- Проще управление правами доступа
- Меньше накладных расходов на подключения

**Альтернатива** (отдельный bucket для thumbnails):
- Можно настроить отдельный bucket с другим retention policy
- Полезно если нужна разная географическая репликация
- Не рекомендуется для текущей реализации (избыточная сложность)

### 1.6 Caching Strategy

1. **First Request**: Generate → Save to S3 → Save metadata to DB → Return
2. **Subsequent Requests**: Check DB → Stream from S3 → Update lastAccessedAt
3. **CDN Layer**: Cloudflare caches based on Cache-Control headers
4. **ETag Support**: Use paramsHash as ETag for 304 Not Modified responses
5. **S3 Path**: `thumbs/{fileId}/{paramsHash}.webp` for easy cleanup

---

## Part 2: Original Image Compression

### 2.1 API Design

#### Upload Endpoint Enhancement
```
POST /api/v1/files
Content-Type: multipart/form-data

Fields:
- file: binary data (required)
- optimize: JSON string (optional)
  {
    "quality": 85,        // 1-100, optional (uses env default if compress specified)
    "maxDimension": 1920, // optional (uses env max if compress specified)
    "format": "webp",     // optional: "webp" or "avif" (required if optimize specified)
    "stripMetadata": true // optional: remove EXIF/metadata (default: false)
  }
```

#### Compression Logic

**Сценарий 1: Force Compression (FORCE_IMAGE_COMPRESSION_ENABLED=true)**
- Всегда применяется сжатие независимо от наличия `optimize` параметра
- Используются env переменные как параметры сжатия:
  - `IMAGE_COMPRESSION_MAX_DIMENSION`
  - `IMAGE_COMPRESSION_FORMAT` (webp или avif)
  - `IMAGE_COMPRESSION_STRIP_METADATA`
  - `IMAGE_COMPRESSION_LOSSLESS`
  - `IMAGE_COMPRESSION_QUALITY`
- Если `optimize` указан в запросе - игнорируется (force режим приоритетнее)

**Сценарий 2: Optional Compression (FORCE_IMAGE_COMPRESSION_ENABLED=false, optimize указан)**
- Применяется сжатие с параметрами из `optimize`
- Env переменные выступают как defaults и ограничения:
  - `quality`: используется из `optimize.quality` или `IMAGE_COMPRESSION_QUALITY`
  - `maxDimension`: `min(optimize.maxDimension, IMAGE_COMPRESSION_MAX_DIMENSION)`
  - `format`: используется из `optimize.format` или `IMAGE_COMPRESSION_FORMAT`

**Сценарий 3: No Compression (FORCE_IMAGE_COMPRESSION_ENABLED=false, optimize не указан)**
- Сохраняется оригинал без изменений
- Env переменные не влияют

**Форматы:**
- `webp` → конвертировать в WebP
- `avif` → конвертировать в AVIF (лучшее сжатие, но медленнее)

**Metadata:**
- Если `stripMetadata: true` → удалить все EXIF/ICC/XMP данные
- Если `stripMetadata: false` или не указан → сохранить metadata

### 2.2 Environment Variables

Обновить `.env.production.example`:

```bash
###### Image Compression (Upload)
# Force compression for all uploads (ignores compress parameter in request)
FORCE_IMAGE_COMPRESSION_ENABLED=false

# Default/max values used when compression is applied
IMAGE_COMPRESSION_MAX_DIMENSION=3840
IMAGE_COMPRESSION_FORMAT=webp  # webp or avif
IMAGE_COMPRESSION_STRIP_METADATA=false
IMAGE_COMPRESSION_LOSSLESS=false
```

### 2.3 Implementation Steps

#### Step 1: Update Configuration
**File**: `src/config/compression.config.ts`

```typescript
export default () => ({
  compression: {
    // Force compression for all uploads
    forceEnabled: process.env.FORCE_IMAGE_COMPRESSION_ENABLED === 'true',
    
    // Default/max values
    defaultQuality: parseInt(process.env.IMAGE_COMPRESSION_DEFAULT_QUALITY || '85', 10),
    maxDimension: parseInt(process.env.IMAGE_COMPRESSION_MAX_DIMENSION || '3840', 10),
    defaultFormat: (process.env.IMAGE_COMPRESSION_DEFAULT_FORMAT || 'webp') as 'webp' | 'avif',
  },
});
```

#### Step 2: Update DTO
**File**: `src/modules/files/dto/compress-params.dto.ts`

```typescript
import { IsInt, Min, Max, IsOptional, IsIn } from 'class-validator';
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
  maxDimension?: number;

  @IsIn(['webp', 'avif'])
  @IsOptional()
  format?: 'webp' | 'avif';

  @Type(() => Boolean)
  @IsOptional()
  stripMetadata?: boolean;
}
```

#### Step 3: Enhance Image Optimizer Service
**File**: `src/modules/optimization/image-optimizer.service.ts`

Обновить метод `optimizeImage()`:

```typescript
async optimizeImage(
  buffer: Buffer,
  originalMimeType: string,
  params: CompressParamsDto,
  envDefaults: CompressionConfig,
  forceCompress: boolean,
): Promise<{ buffer: Buffer; format: string; size: number }> {
  // Determine compression parameters based on mode
  let quality: number;
  let maxDimension: number;
  let format: 'webp' | 'avif';
  let stripMetadata: boolean;

  if (forceCompress) {
    // Force mode: use only env defaults, ignore params
    quality = envDefaults.defaultQuality;
    maxDimension = envDefaults.maxDimension;
    format = envDefaults.defaultFormat;
    stripMetadata = false; // Can be configured via env if needed
  } else {
    // Optional mode: merge params with env defaults
    quality = params.quality ?? envDefaults.defaultQuality;
    maxDimension = Math.min(params.maxDimension ?? Infinity, envDefaults.maxDimension);
    format = params.format ?? envDefaults.defaultFormat;
    stripMetadata = params.stripMetadata ?? false;
  }

  // Get original dimensions
  const metadata = await sharp(buffer).metadata();
  
  // Calculate resize dimensions (preserve aspect ratio)
  let resizeWidth = metadata.width ?? 0;
  let resizeHeight = metadata.height ?? 0;
  
  if (resizeWidth > maxDimension || resizeHeight > maxDimension) {
    const aspectRatio = resizeWidth / resizeHeight;
    if (resizeWidth > maxDimension) {
      resizeWidth = maxDimension;
      resizeHeight = Math.round(maxDimension / aspectRatio);
    }
    if (resizeHeight > maxDimension) {
      resizeHeight = maxDimension;
      resizeWidth = Math.round(maxDimension * aspectRatio);
    }
  }

  // Build Sharp pipeline
  let pipeline = sharp(buffer);
  
  // Auto-rotate based on EXIF orientation
  pipeline = pipeline.rotate();

  // Resize if needed
  if (resizeWidth !== metadata.width || resizeHeight !== metadata.height) {
    pipeline = pipeline.resize(resizeWidth, resizeHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // Strip metadata if requested
  if (stripMetadata) {
    pipeline = pipeline.withMetadata(false);
  }

  // Apply format conversion
  let outputMimeType: string;
  
  if (format === 'webp') {
    pipeline = pipeline.webp({ 
      quality,
      effort: 4, // Balance between speed and compression
    });
    outputMimeType = 'image/webp';
  } else if (format === 'avif') {
    pipeline = pipeline.avif({ 
      quality,
      effort: 4, // 0-9, higher = slower but better compression
    });
    outputMimeType = 'image/avif';
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }

  const resultBuffer = await pipeline.toBuffer();

  return {
    buffer: resultBuffer,
    format: outputMimeType,
    size: resultBuffer.length,
  };
}
```

#### Step 4: Update Upload Logic
**File**: `src/modules/files/files.service.ts`

Обновить метод `uploadFile()`:

```typescript
async uploadFile(params: UploadFileParams): Promise<FileResponseDto> {
  const { buffer, filename, mimeType, compressParams, metadata } = params;

  let processedBuffer = buffer;
  let processedMimeType = mimeType;
  let originalSize: number | null = null;

  // Check if compression should be applied
  const forceCompress = this.configService.get('compression.forceEnabled');
  const shouldCompress = forceCompress || (compressParams && this.isImage(mimeType));

  if (shouldCompress && this.isImage(mimeType)) {
    const envDefaults = this.configService.get('compression');
    const result = await this.imageOptimizer.optimizeImage(
      buffer,
      mimeType,
      compressParams ?? {},
      envDefaults,
      forceCompress,
    );
    
    // Only use compressed version if it's smaller
    if (result.size < buffer.length) {
      processedBuffer = result.buffer;
      processedMimeType = result.format;
      originalSize = buffer.length;
      this.logger.info(
        { 
          filename, 
          beforeBytes: buffer.length, 
          afterBytes: result.size,
          savings: `${((1 - result.size / buffer.length) * 100).toFixed(1)}%`
        },
        'Image compressed',
      );
    }
  }

  // Continue with existing upload logic...
}
```

---

## Part 3: Database Migration

### Migration File
**File**: `prisma/migrations/YYYYMMDDHHMMSS_add_thumbnails/migration.sql`

```sql
CREATE TABLE "thumbnails" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Bucket" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "quality" INTEGER NOT NULL,
    "fit" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thumbnails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "thumbnails_s3Key_key" ON "thumbnails"("s3Key");
CREATE UNIQUE INDEX "thumbnails_fileId_paramsHash_key" ON "thumbnails"("fileId", "paramsHash");
CREATE INDEX "thumbnails_fileId_idx" ON "thumbnails"("fileId");
CREATE INDEX "thumbnails_lastAccessedAt_idx" ON "thumbnails"("lastAccessedAt");

ALTER TABLE "thumbnails" ADD CONSTRAINT "thumbnails_fileId_fkey" 
    FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Part 4: Testing Strategy

### Unit Tests

#### Thumbnail Service Tests
**File**: `test/unit/thumbnail.service.spec.ts`

Test cases:
- ✅ Generate thumbnail with valid parameters
- ✅ Use cached thumbnail if exists
- ✅ Validate parameters (min/max width/height)
- ✅ Calculate params hash correctly
- ✅ Handle non-image files (throw 415)
- ✅ Apply default quality from env
- ✅ Update lastAccessedAt on cache hit

#### Image Optimizer Tests
**File**: `test/unit/image-optimizer.service.spec.ts`

Test cases:
- ✅ Compress image with quality parameter
- ✅ Resize image respecting max dimensions
- ✅ Convert format (JPEG → WebP, PNG → WebP)
- ✅ Preserve aspect ratio
- ✅ Skip compression if result is larger
- ✅ Handle original format preservation
- ✅ Apply env defaults when params not provided

### E2E Tests

#### Thumbnail Endpoint Tests
**File**: `test/e2e/thumbnail.e2e-spec.ts`

Test cases:
- ✅ GET /files/:id/thumbnail with valid params returns 200
- ✅ Thumbnail is cached on second request
- ✅ Invalid width/height returns 400
- ✅ Non-existent file returns 404
- ✅ Non-image file returns 415
- ✅ Cache-Control headers are correct
- ✅ ETag header is present

#### Upload with Compression Tests
**File**: `test/e2e/upload-compression.e2e-spec.ts`

Test cases:
- ✅ Upload without compress params saves original
- ✅ Upload with compress params applies compression
- ✅ Upload respects env max dimensions
- ✅ Upload converts format correctly
- ✅ originalSize is saved when compressed
- ✅ Compression skipped if result is larger

---

## Part 5: Cleanup Job Enhancement

### Thumbnail Cleanup

Добавить в существующий cleanup job очистку старых thumbnail.

**File**: `src/modules/cleanup/cleanup.service.ts`

```typescript
async cleanupOldThumbnails(): Promise<void> {
  const daysThreshold = this.configService.get('cleanup.thumbnailDays', 90);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

  const oldThumbnails = await this.prisma.thumbnail.findMany({
    where: {
      lastAccessedAt: {
        lt: cutoffDate,
      },
    },
  });

  for (const thumb of oldThumbnails) {
    try {
      await this.storageService.deleteFile(thumb.s3Key);
      await this.prisma.thumbnail.delete({ where: { id: thumb.id } });
      this.logger.info({ thumbnailId: thumb.id }, 'Old thumbnail cleaned up');
    } catch (error) {
      this.logger.error({ err: error, thumbnailId: thumb.id }, 'Failed to cleanup thumbnail');
    }
  }
}
```

Environment variable:
```bash
CLEANUP_THUMBNAIL_DAYS=90
```

---

## Part 6: Documentation Updates

### API Documentation

Обновить OpenAPI/Swagger спецификацию:
- Добавить endpoint `GET /files/:id/thumbnail`
- Обновить `POST /files` с новым полем `compress`
- Добавить примеры использования

### README Updates

Добавить секции:
- **Thumbnails**: Как генерировать thumbnail
- **Compression**: Как настроить пережатие при загрузке
- **Environment Variables**: Описание всех новых переменных

---

## Implementation Phases

### Phase 1: Original Compression Enhancement (Week 1)
**Priority**: High  
**Effort**: 3-4 days

1. ✅ Update configuration module
2. ✅ Create CompressParamsDto
3. ✅ Enhance ImageOptimizerService
4. ✅ Update FilesService upload logic
5. ✅ Add unit tests
6. ✅ Add e2e tests
7. ✅ Update documentation

**Deliverables**:
- Пережатие оригиналов работает
- Env переменные применяются корректно
- Формат конвертируется (WebP/JPEG/PNG)
- Тесты покрывают все сценарии

### Phase 2: Dynamic Thumbnails (Week 2-3)
**Priority**: High  
**Effort**: 7-10 days

1. ✅ Database migration (Thumbnail table)
2. ✅ Create ThumbnailParamsDto
3. ✅ Implement ThumbnailService
4. ✅ Implement ThumbnailGeneratorService
5. ✅ Add controller endpoint
6. ✅ Implement caching logic
7. ✅ Add unit tests
8. ✅ Add e2e tests
9. ✅ Update documentation

**Deliverables**:
- Thumbnail endpoint работает
- Кэширование в S3 + DB
- Cache-Control headers для CDN
- ETag support
- Тесты покрывают все сценарии

### Phase 3: Cleanup & Optimization (Week 3)
**Priority**: Medium  
**Effort**: 2-3 days

1. ✅ Implement thumbnail cleanup job
2. ✅ Add monitoring metrics
3. ✅ Performance testing
4. ✅ CDN integration testing (Cloudflare)

**Deliverables**:
- Старые thumbnail удаляются автоматически
- Метрики работают
- Performance приемлемый
- CDN кэширование работает

---

## Performance Considerations

### Thumbnail Generation
- **First Request**: 500-2000ms (зависит от размера оригинала)
- **Cached Request**: 50-200ms (stream from S3)
- **CDN Hit**: <50ms

### Compression on Upload
- **Small images (<1MB)**: +100-300ms
- **Medium images (1-5MB)**: +300-1000ms
- **Large images (5-10MB)**: +1000-3000ms

### Optimization Strategies
1. **Async Processing**: Рассмотреть очередь (BullMQ) для больших файлов
2. **Streaming**: Использовать stream где возможно
3. **Connection Pooling**: Оптимизировать S3 connections
4. **CDN**: Cloudflare кэширует на год (immutable)

---

## Security Considerations

1. **Parameter Validation**: Строгая валидация width/height/quality
2. **Resource Limits**: Ограничение максимальных размеров thumbnail
3. **Rate Limiting**: Защита от abuse генерации thumbnail
4. **File Type Validation**: Только изображения для thumbnail
5. **DoS Protection**: Ограничение одновременных генераций

---

## Monitoring & Metrics

### Metrics to Track
- Thumbnail generation time (p50, p95, p99)
- Thumbnail cache hit rate
- Compression savings (bytes saved)
- Thumbnail storage usage
- Cleanup job statistics

### Alerts
- High thumbnail generation latency (>5s p95)
- Low cache hit rate (<70%)
- Thumbnail storage exceeds threshold
- Cleanup job failures

---

## Open Questions

1. **Thumbnail Limits**: Ограничить количество уникальных thumbnail на файл?
2. **Async Generation**: Генерировать thumbnail асинхронно через очередь?
3. **Video Thumbnails**: Поддержка извлечения кадров из видео (FFmpeg)?
4. **Smart Cropping**: Использовать Sharp smart crop для лучшего качества?
5. **AVIF Support**: Добавить поддержку AVIF формата (лучше WebP)?

---

## Success Metrics

### Phase 1 (Compression)
- [ ] Compression reduces file size by 30%+ on average
- [ ] Upload latency increase <500ms for images <5MB
- [ ] 90%+ test coverage
- [ ] Zero data loss

### Phase 2 (Thumbnails)
- [ ] Thumbnail generation <2s (p95)
- [ ] Cache hit rate >80% after warmup
- [ ] CDN cache hit rate >95%
- [ ] 90%+ test coverage

### Phase 3 (Cleanup)
- [ ] Cleanup reduces storage by 20%+
- [ ] Zero false positives (no active thumbnails deleted)
- [ ] Cleanup job completes in <10min

---

## Dependencies

### NPM Packages
- `sharp` (already installed)

### Infrastructure
- PostgreSQL 18 (already configured)
- S3-compatible storage (already configured)
- Cloudflare CDN (external, configuration only)

### Environment
- Node.js 22+
- Sufficient memory for Sharp operations (recommend 2GB+ per instance)
