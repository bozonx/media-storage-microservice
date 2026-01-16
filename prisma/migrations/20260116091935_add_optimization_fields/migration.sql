-- CreateEnum
CREATE TYPE "OptimizationStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- Rename existing original_size column (it was storing compressed size before optimization)
-- We'll drop it since the new schema uses originalSize for temporary original file
ALTER TABLE "files" DROP COLUMN "original_size";

-- AlterTable: Add new optimization fields
ALTER TABLE "files" 
ADD COLUMN "original_s3_key" VARCHAR(500),
ADD COLUMN "original_mime_type" VARCHAR(100),
ADD COLUMN "original_size" BIGINT,
ADD COLUMN "original_checksum" VARCHAR(100),
ADD COLUMN "optimization_status" "OptimizationStatus",
ADD COLUMN "optimization_error" TEXT,
ADD COLUMN "optimization_started_at" TIMESTAMP(6),
ADD COLUMN "optimization_completed_at" TIMESTAMP(6);

-- CreateIndex
CREATE INDEX "files_optimization_status_idx" ON "files"("optimization_status");
