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
- Prisma: upgrade to Prisma v7 and add `prisma.config.ts`.
- Env: unify Prisma CLI and NestJS env loading via `dotenv-cli` and `.env.*` files.
