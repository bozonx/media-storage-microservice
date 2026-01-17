-- Replace global dedup unique index with a partial index that respects soft delete.
--
-- Previous behavior:
-- - UNIQUE (checksum, mime_type, status)
--   blocked re-upload of the same content after soft-delete (deleted_at set) because status stayed 'ready'.
--
-- New behavior:
-- - UNIQUE (checksum, mime_type) only for active READY rows (deleted_at IS NULL).
--   This keeps deduplication for active files and allows re-upload after soft-delete.

DROP INDEX IF EXISTS "files_checksum_mime_type_status_key";

CREATE UNIQUE INDEX "files_checksum_mime_type_active_ready_key"
ON "files" ("checksum", "mime_type")
WHERE "deleted_at" IS NULL AND "status" = 'ready' AND "checksum" IS NOT NULL;
