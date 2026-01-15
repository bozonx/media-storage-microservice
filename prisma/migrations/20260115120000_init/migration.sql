-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('uploading', 'ready', 'deleting', 'deleted', 'failed', 'missing');

-- CreateTable
CREATE TABLE "files" (
  "id" UUID NOT NULL,
  "filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size" BIGINT,
  "original_size" BIGINT,
  "checksum" VARCHAR(100),
  "s3_key" VARCHAR(500) NOT NULL,
  "s3_bucket" VARCHAR(100) NOT NULL,
  "status" "FileStatus" NOT NULL DEFAULT 'uploading',
  "optimization_params" JSONB,
  "metadata" JSONB,
  "uploaded_at" TIMESTAMP(6),
  "deleted_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_status_uploaded_at_idx" ON "files"("status", "uploaded_at");

-- CreateIndex
CREATE INDEX "files_mime_type_idx" ON "files"("mime_type");

-- CreateIndex
CREATE INDEX "files_checksum_idx" ON "files"("checksum");

-- CreateIndex
CREATE INDEX "files_s3_key_idx" ON "files"("s3_key");
