# Changelog

## Unreleased

- Logging: unify application logs on Pino (nestjs-pino) with structured error fields.
- Errors: harden global exception responses and map Prisma errors to HTTP.
- Cleanup: comprehensive cleanup service with TTL-based policies for bad status files and old thumbnails.
  - Add `statusChangedAt` field to track when file status changes.
  - Replace `CLEANUP_ORPHAN_TIMEOUT_MINUTES` with `CLEANUP_BAD_STATUS_TTL_DAYS` (default 30 days).
  - Add `CLEANUP_THUMBNAILS_TTL_DAYS` for unused thumbnail cleanup (default 90 days).
  - Add `CLEANUP_BATCH_SIZE` for controlling cleanup batch operations.
  - Unified cleanup pipeline: corrupted records, bad status files, and old thumbnails.
- Files: harden download headers and improve deduplication behavior.
  - **Fix**: Handle deduplication race conditions in image optimization pipeline (`optimizeImage`).
  - **Fix**: Expire temporary objects (`tmp/`, `originals/`) via MinIO lifecycle policy to reduce cleanup service load.
  - **Enhancement**: Pre-check for existing optimized content before upload to avoid duplicate work.
  - **Enhancement**: Graceful handling of P2002 unique constraint violations during concurrent uploads.
  - **Enhancement**: Improved error logging for deduplication and cleanup operations.
- Cleanup: rely on MinIO lifecycle expiration for `tmp/` and `originals/` objects.
- Prisma: upgrade to Prisma v7 and add `prisma.config.ts`.
- Env: unify Prisma CLI and NestJS env loading via `dotenv-cli` and `.env.*` files.
