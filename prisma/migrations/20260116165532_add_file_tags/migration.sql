-- AlterTable
ALTER TABLE "files" ADD COLUMN     "app_id" VARCHAR(100),
ADD COLUMN     "purpose" VARCHAR(50),
ADD COLUMN     "user_id" VARCHAR(100);

-- CreateIndex
CREATE INDEX "files_app_id_idx" ON "files"("app_id");

-- CreateIndex
CREATE INDEX "files_user_id_idx" ON "files"("user_id");

-- CreateIndex
CREATE INDEX "files_purpose_idx" ON "files"("purpose");

-- CreateIndex
CREATE INDEX "files_app_id_user_id_idx" ON "files"("app_id", "user_id");
