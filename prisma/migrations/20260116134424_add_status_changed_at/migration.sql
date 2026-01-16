-- AlterTable
ALTER TABLE "files" ADD COLUMN     "status_changed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "files_status_status_changed_at_idx" ON "files"("status", "status_changed_at");
