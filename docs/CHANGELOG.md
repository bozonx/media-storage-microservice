# Changelog

## Unreleased

- Logging: unify application logs on Pino (nestjs-pino) with structured error fields.
- Compression (breaking): replace `IMAGE_COMPRESSION_MAX_WIDTH`/`IMAGE_COMPRESSION_MAX_HEIGHT` with `IMAGE_COMPRESSION_MAX_DIMENSION` and replace request optimize params `maxWidth`/`maxHeight` with `maxDimension`.
- Compression (breaking): rename env vars to remove DEFAULT suffixes/prefixes:
  - `IMAGE_COMPRESSION_DEFAULT_FORMAT` -> `IMAGE_COMPRESSION_FORMAT`
  - `IMAGE_COMPRESSION_STRIP_METADATA_DEFAULT` -> `IMAGE_COMPRESSION_STRIP_METADATA`
  - `IMAGE_COMPRESSION_LOSSLESS_DEFAULT` -> `IMAGE_COMPRESSION_LOSSLESS`
- Thumbnails (breaking): replace `THUMBNAIL_MAX_WIDTH`/`THUMBNAIL_MAX_HEIGHT` with `THUMBNAIL_MAX_DIMENSION`.
- Files: add EXIF extraction (no persistence).
  - Return optional `exif` field in upload response when available.
  - Add `GET /api/v1/files/:id/exif` endpoint to extract EXIF for stored images.
  - Add `EXIF_MAX_BYTES` env var to limit bytes read for EXIF extraction (`0` disables EXIF).
- Errors: harden global exception responses and map Prisma errors to HTTP.
- Cleanup: comprehensive cleanup service with TTL-based policies for bad status files and old thumbnails.
  - Add `statusChangedAt` field to track when file status changes.
  - Replace `CLEANUP_ORPHAN_TIMEOUT_MINUTES` with `CLEANUP_BAD_STATUS_TTL_DAYS` (default 30 days).
  - Add `THUMBNAIL_MAX_AGE_DAYS` for unused thumbnail cleanup and thumbnail cache max-age (default 365 days).
  - Add `CLEANUP_BATCH_SIZE` for controlling cleanup batch operations.
  - Unified cleanup pipeline: corrupted records, bad status files, and old thumbnails.
- Files: harden download headers and improve deduplication behavior.
  - **Fix**: Handle deduplication race conditions in image optimization pipeline (`optimizeImage`).
  - **Fix**: Ensure temporary objects (`tmp/`, `originals/`) are cleaned up via cleanup job to reduce storage waste.
  - **Enhancement**: Pre-check for existing optimized content before upload to avoid duplicate work.
  - **Enhancement**: Graceful handling of P2002 unique constraint violations during concurrent uploads.
  - **Enhancement**: Improved error logging for deduplication and cleanup operations.
- **Files: add optional tagging support** (`appId`, `userId`, `purpose`).
  - Add nullable `appId`, `userId`, `purpose` fields to File model with indexes for filtering.
  - Support multipart fields `appId`, `userId`, `purpose` on upload (`POST /api/v1/files`).
  - Expose tags in file response DTO and list endpoint (`GET /api/v1/files`).
  - Add `POST /api/v1/files/bulk-delete` endpoint for mass soft delete by tags (requires at least one tag filter).
  - Update UI to display tags and support bulk delete by tag filters.
- Cleanup: rely on cleanup job expiration for `tmp/` and `originals/` objects.
- Prisma: upgrade to Prisma v7 and add `prisma.config.ts`.
- Env: unify Prisma CLI and NestJS env loading via `dotenv-cli` and `.env.*` files.
