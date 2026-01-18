# Deduplication Improvements

## Overview

This document describes improvements made to the file deduplication system to ensure consistency, handle race conditions, and properly cleanup orphaned objects.

## Problems Identified

### 1. Missing Deduplication in Image Optimization Pipeline

**Issue**: When `optimizeImage()` processed files, it didn't check for existing optimized content before uploading. If two identical images were optimized concurrently, the unique constraint violation (`P2002`) was treated as a failure, marking `optimizationStatus=FAILED`.

**Impact**: 
- False failures in optimization
- Potential duplicate objects in S3-compatible storage
- Inconsistent state between DB and storage

### 2. Orphaned Temporary Objects

**Issue**: When uploads failed or race conditions occurred during `uploadFileStream()`, temporary objects in `tmp/` or `originals/` prefixes could remain in storage without proper cleanup.

**Impact**:
- Storage waste
- No automatic cleanup mechanism for failed uploads

### 3. Incomplete Error Handling

**Issue**: Cleanup operations during failures weren't always attempted, and errors during cleanup weren't logged properly.

**Impact**:
- Silent failures
- Difficult debugging

## Solutions Implemented

### 1. Enhanced `optimizeImage()` Deduplication

**Changes**:
- Added pre-check for existing optimized content before upload
- Handle `P2002` race condition during update by finding existing file
- Delete current file record and reuse existing on deduplication
- Proper cleanup of `originalS3Key` on both success and failure paths

**Code**: `src/modules/files/files.service.ts` (метод `optimizeImage`)

**Benefits**:
- Idempotent optimization process
- No false `FAILED` status on deduplication
- Consistent behavior with upload deduplication

### 2. Improved `uploadFileStream()` Cleanup

**Changes**:
- Track `tmpKeyToCleanup` throughout upload lifecycle
- Ensure cleanup on all failure paths
- Better error logging for cleanup operations
- Handle cleanup failures gracefully (log but don't fail the operation)

**Code**: `src/modules/files/files.service.ts` (метод `uploadFileStream`)

**Benefits**:
- Reduced orphaned objects
- Better observability through logs
- Consistent cleanup behavior

### 3. Cleanup Service Enhancement

**Changes**:
- Added `cleanupTemporaryObjects()` method
- Finds files in `UPLOADING` status older than configured TTL
- Deletes both DB records and storage objects

**Code**: `src/modules/cleanup/cleanup.service.ts` (метод `cleanupTemporaryObjects`)

**Benefits**:
- Automatic recovery from partial failures
- Prevents storage waste accumulation
- Configurable TTL for orphaned files

## Best Practices Applied

### 1. Idempotency

All deduplication operations are idempotent:
- Multiple uploads of same content return same result
- Race conditions are handled gracefully
- No duplicate objects in storage for same content

### 2. Consistency

Database unique constraint `@@unique([checksum, mimeType, status])` ensures:
- At most one `READY` file per (checksum, mimeType)
- Race conditions caught at DB level
- Automatic conflict resolution

### 3. Observability

Enhanced logging for:
- Deduplication events (with existing file ID)
- Race condition detection
- Cleanup operations (success and failure)
- Orphaned object handling

### 4. Graceful Degradation

Cleanup failures don't block main operations:
- Log errors but continue
- Cleanup service will retry on next run
- No cascading failures

## Testing

Unit tests added for critical scenarios:
- Concurrent uploads of identical content
- P2002 race conditions during create/update
- Cleanup of temporary files on failure
- Deduplication in optimization pipeline
- Race conditions during optimization

**Test file**: `test/unit/files-deduplication.spec.ts`

## Configuration

### Cleanup Service

Orphaned temporary files cleanup is controlled by:
- `CLEANUP_ENABLED`: Enable/disable cleanup service (default: true)
- `CLEANUP_CRON`: Schedule for cleanup job (default: "0 2 * * *")
- `CLEANUP_BATCH_SIZE`: Max files to process per run (default: 100)
- `CLEANUP_STUCK_UPLOAD_TIMEOUT_MS`: TTL for stuck uploads

## Migration Required

After applying these changes, run:

```bash
pnpm prisma generate
```

This regenerates Prisma Client types to match the schema (fields like `statusChangedAt`, `originalS3Key`).

## Monitoring Recommendations

Monitor these metrics:
- Count of files in `UPLOADING` status older than 1 hour
- Count of files with `tmp/` or `originals/` keys
- Cleanup service execution time and processed files count
- Deduplication rate (log messages with "deduplication" keyword)

## Known Limitations

### 1. MIME Type in Deduplication Key

Current implementation includes `mimeType` in uniqueness constraint. This means:
- Same binary content with different MIME types = different S3 keys
- Intentional design to preserve content-type semantics
- Small duplication acceptable for different formats

**Alternative**: Use pure content-based deduplication (checksum only) and store MIME in metadata.

### 2. NULL Checksum Allows Multiple UPLOADING Records

PostgreSQL unique indexes allow multiple NULL values. This means:
- Multiple `UPLOADING` files with `checksum=NULL` can coexist
- Not a bug - checksum is set only after upload completes
- Uniqueness enforced only for `READY` status

### 3. No Reference Counting

Current design returns existing file on deduplication rather than creating separate records pointing to same blob. This means:
- Cannot have multiple logical files with different metadata for same content
- Deleting a file always deletes the storage object
- Simpler design, acceptable for most use cases

**Alternative**: Implement blob reference counting with separate `File` and `Blob` tables.

## Rollback Plan

If issues arise:

1. Revert changes to `files.service.ts`:
   ```bash
   git checkout HEAD~1 src/modules/files/files.service.ts
   ```

2. Revert cleanup service changes:
   ```bash
   git checkout HEAD~1 src/modules/cleanup/cleanup.service.ts
   ```

3. Regenerate Prisma Client:
   ```bash
   pnpm prisma generate
   ```

## Future Improvements

1. **S3 Lifecycle Policies**: Configure bucket lifecycle rules for `tmp/` and `originals/` prefixes (TTL: 2 days)
2. **Metrics Dashboard**: Track deduplication rate, storage savings, cleanup efficiency
3. **Blob Reference Counting**: If multiple logical files per blob needed
4. **Content-Only Deduplication**: Remove MIME from uniqueness if strict deduplication required
