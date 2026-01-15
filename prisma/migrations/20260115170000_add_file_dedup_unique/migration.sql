-- Add unique constraint to protect deduplication (checksum + mime_type + status)
--
-- This enforces at most one row per (checksum, mime_type, status), which allows
-- safe deduplication for READY files when status='ready'.

CREATE UNIQUE INDEX "files_checksum_mime_type_status_key" ON "files"("checksum", "mime_type", "status");
