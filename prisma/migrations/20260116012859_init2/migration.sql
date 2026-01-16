-- AlterTable
ALTER TABLE "files" ALTER COLUMN "updated_at" DROP DEFAULT;

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
CREATE INDEX "thumbnails_file_id_idx" ON "thumbnails"("file_id");

-- CreateIndex
CREATE INDEX "thumbnails_params_hash_idx" ON "thumbnails"("params_hash");

-- CreateIndex
CREATE INDEX "thumbnails_last_accessed_at_idx" ON "thumbnails"("last_accessed_at");

-- CreateIndex
CREATE UNIQUE INDEX "thumbnails_file_id_params_hash_key" ON "thumbnails"("file_id", "params_hash");
