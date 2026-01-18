-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('uploading', 'ready', 'deleting', 'deleted', 'failed', 'missing');

-- CreateEnum
CREATE TYPE "OptimizationStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "app_id" VARCHAR(100),
    "user_id" VARCHAR(100),
    "purpose" VARCHAR(50),
    "original_s3_key" VARCHAR(500),
    "original_mime_type" VARCHAR(100),
    "original_size" BIGINT,
    "original_checksum" VARCHAR(100),
    "s3_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size" BIGINT,
    "checksum" VARCHAR(100),
    "s3_bucket" VARCHAR(100) NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'uploading',
    "optimization_status" "OptimizationStatus",
    "optimization_params" JSONB,
    "optimization_error" TEXT,
    "optimization_started_at" TIMESTAMP(6),
    "optimization_completed_at" TIMESTAMP(6),
    "metadata" JSONB,
    "exif" JSONB,
    "uploaded_at" TIMESTAMP(6),
    "deleted_at" TIMESTAMP(6),
    "status_changed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thumbnails" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "quality" INTEGER NOT NULL,
    "params_hash" VARCHAR(64) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "s3_bucket" VARCHAR(100) NOT NULL,
    "size" BIGINT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "last_accessed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thumbnails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_status_uploaded_at_idx" ON "files"("status", "uploaded_at");

-- CreateIndex
CREATE INDEX "files_status_status_changed_at_idx" ON "files"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "files_mime_type_idx" ON "files"("mime_type");

-- CreateIndex
CREATE INDEX "files_checksum_idx" ON "files"("checksum");

-- CreateIndex
CREATE INDEX "files_s3_key_idx" ON "files"("s3_key");

-- CreateIndex
CREATE INDEX "files_optimization_status_idx" ON "files"("optimization_status");

-- CreateIndex
CREATE INDEX "files_optimization_status_optimization_started_at_idx" ON "files"("optimization_status", "optimization_started_at");

-- CreateIndex
CREATE INDEX "files_deleted_at_idx" ON "files"("deleted_at");

-- CreateIndex
CREATE INDEX "files_app_id_idx" ON "files"("app_id");

-- CreateIndex
CREATE INDEX "files_user_id_idx" ON "files"("user_id");

-- CreateIndex
CREATE INDEX "files_purpose_idx" ON "files"("purpose");

-- CreateIndex
CREATE INDEX "files_app_id_user_id_idx" ON "files"("app_id", "user_id");

-- CreateIndex
CREATE INDEX "thumbnails_file_id_idx" ON "thumbnails"("file_id");

-- CreateIndex
CREATE INDEX "thumbnails_params_hash_idx" ON "thumbnails"("params_hash");

-- CreateIndex
CREATE INDEX "thumbnails_last_accessed_at_idx" ON "thumbnails"("last_accessed_at");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnails_file_id_params_hash_key" ON "thumbnails"("file_id", "params_hash");

-- AddForeignKey
ALTER TABLE "thumbnails" ADD CONSTRAINT "thumbnails_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
