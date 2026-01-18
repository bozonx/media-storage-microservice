# Cleanup Service Audit Report

**Date:** 2026-01-16  
**Status:** ⚠️ Generally well-implemented with some critical issues

---

## Executive Summary

The cleanup service is well-structured and follows NestJS best practices. However, there are several critical issues that need attention, particularly around error handling, transaction safety, and missing test coverage.

---

## ✅ What's Done Well

### 1. **Architecture & Structure**
- ✅ Proper module separation (`CleanupModule`, `CleanupService`)
- ✅ Correct use of NestJS lifecycle hooks (`OnModuleInit`, `OnModuleDestroy`)
- ✅ Configuration-driven approach with environment variables
- ✅ Proper dependency injection

### 2. **Scheduling Implementation**
- ✅ Correct use of `@nestjs/schedule` with `SchedulerRegistry`
- ✅ Proper cron job registration and cleanup
- ✅ Configurable cron schedule via environment variables
- ✅ Graceful shutdown handling in `onModuleDestroy`

### 3. **Logging**
- ✅ Comprehensive logging with structured data
- ✅ Proper use of Pino logger with context
- ✅ Good balance of info/warn/error levels

### 4. **Configuration**
- ✅ Well-defined configuration interface
- ✅ Sensible defaults (6-hour cron, 30-day TTL for bad status, 90-day TTL for thumbnails)
- ✅ Batch processing with configurable batch size

---

## 🔴 Critical Issues

### 1. **Missing Database Transactions**
**Severity:** HIGH  
**Location:** All cleanup methods

**Problem:**
The cleanup operations perform multiple database operations without transactions. If any operation fails mid-process, the database can be left in an inconsistent state.

**Example:**
```typescript
// In deleteFileCompletely()
await this.storageService.deleteFile(thumbnail.s3Key); // May fail
await this.prismaService.thumbnail.deleteMany({ where: { fileId } }); // Leaves orphaned records
await this.storageService.deleteFile(s3Key); // May fail
await this.prismaService.file.delete({ where: { id: fileId } }); // May leave orphaned storage
```

**Impact:**
- Orphaned database records if S3 deletion succeeds but DB deletion fails
- Orphaned S3 objects if DB deletion succeeds but S3 deletion fails
- Data inconsistency between storage and database

**Recommendation:**
Implement transaction-safe cleanup with proper rollback handling:
```typescript
await this.prismaService.$transaction(async (tx) => {
  // Perform all DB operations within transaction
  // Handle S3 operations with proper error recovery
});
```

### 2. **Race Conditions with File Operations**
**Severity:** HIGH  
**Location:** `cleanupCorruptedRecords()`, `cleanupBadStatusFiles()`

**Problem:**
The cleanup service can delete files that are currently being processed by other services (upload, optimization, thumbnail generation).

**Scenario:**
1. File is in `UPLOADING` status for 29 days
2. Upload completes and changes status to `READY`
3. Cleanup job runs simultaneously and deletes the file based on old status

**Impact:**
- Active uploads/optimizations can be interrupted
- Data loss for legitimate operations

**Recommendation:**
- Add locking mechanism or status check before deletion
- Use optimistic locking with version field
- Implement distributed locks for multi-instance deployments

### 3. **No Retry Logic for Failed Operations**
**Severity:** MEDIUM  
**Location:** `deleteFileCompletely()`, `cleanupOldThumbnails()`

**Problem:**
If S3 deletion fails (network issue, temporary outage), the operation is logged but not retried. The file remains in the database but cleanup continues.

**Impact:**
- Accumulation of files that should be deleted
- Manual intervention required to clean up failed deletions

**Recommendation:**
Implement exponential backoff retry logic or mark files for retry in next cleanup cycle.

### 4. **Missing Monitoring & Metrics**
**Severity:** MEDIUM  
**Location:** Entire service

**Problem:**
No metrics are exposed for:
- Number of files cleaned up per run
- Cleanup job duration
- Failure rates
- Storage space reclaimed

**Impact:**
- Difficult to monitor cleanup effectiveness
- No alerting on cleanup failures
- Cannot track storage cost savings

**Recommendation:**
Add metrics collection (Prometheus/StatsD) for key operations.

---

## ⚠️ Medium Priority Issues

### 5. **Batch Processing Without Pagination**
**Severity:** MEDIUM  
**Location:** All cleanup methods

**Problem:**
Each cleanup method processes only one batch per run. If there are more records than `batchSize`, they won't be processed until the next cron run.

**Current behavior:**
```typescript
take: this.config.batchSize, // Only processes 200 records
```

**Impact:**
- Large backlogs take multiple days to clear
- Inconsistent cleanup performance

**Recommendation:**
Process all matching records in batches:
```typescript
let hasMore = true;
while (hasMore) {
  const batch = await this.prismaService.file.findMany({ take: batchSize });
  hasMore = batch.length === batchSize;
  // process batch
}
```

### 6. **Hardcoded Error Handling**
**Severity:** MEDIUM  
**Location:** Multiple methods

**Problem:**
`NotFoundException` is caught and ignored, but other S3 errors (permissions, network) are only logged without proper handling.

```typescript
} catch (error) {
  if (!(error instanceof NotFoundException)) {
    this.logger.warn({ err: error, s3Key }, 'Failed to delete file');
  }
}
// Continues execution despite failure
```

**Impact:**
- Silent failures for permission issues
- No distinction between temporary and permanent failures

**Recommendation:**
Implement proper error classification and handling strategy.

### 7. **Missing Idempotency Guarantees**
**Severity:** MEDIUM  
**Location:** All cleanup methods

**Problem:**
If cleanup job crashes mid-execution and restarts, some files may be processed twice or partially processed.

**Impact:**
- Duplicate deletion attempts
- Wasted resources
- Potential errors from trying to delete already-deleted records

**Recommendation:**
Add idempotency checks or use database flags to track cleanup progress.

---

## 🟡 Low Priority Issues

### 8. **No Test Coverage**
**Severity:** LOW (but important)  
**Location:** No test files found

**Problem:**
No unit tests or integration tests for the cleanup service.

**Impact:**
- Difficult to refactor safely
- No regression protection
- Cannot verify edge cases

**Recommendation:**
Create comprehensive test suite covering:
- Cron job scheduling
- Each cleanup method
- Error scenarios
- Edge cases (empty results, partial failures)

### 9. **Magic Numbers in Time Calculations**
**Severity:** LOW  
**Location:** `cleanupBadStatusFiles()`, `cleanupOldThumbnails()`

**Problem:**
```typescript
const cutoffTime = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
```

**Recommendation:**
Extract to named constants:
```typescript
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const cutoffTime = new Date(Date.now() - ttlDays * MS_PER_DAY);
```

### 10. **Inconsistent Null Handling**
**Severity:** LOW  
**Location:** `cleanupCorruptedRecords()`

**Problem:**
Checks for both `null` and empty string:
```typescript
OR: [{ s3Key: null }, { s3Key: '' }, { mimeType: null }, { mimeType: '' }]
```

**Question:**
Should the database schema enforce `NOT NULL` constraints to prevent this?

### 11. **No Configuration Validation**
**Severity:** LOW  
**Location:** `cleanup.config.ts`

**Problem:**
No validation for:
- Invalid cron expressions
- Negative TTL values
- Zero or negative batch sizes

**Recommendation:**
Add validation using `class-validator` or custom validation logic.

---

## 🔧 Minor Issues Fixed

### ✅ Type Safety Improvements
**Fixed:** Removed all `as any` type casts for Prisma client calls
- Improved type safety
- Better IDE autocomplete
- Compile-time error detection

---

## 🚨 Schema/Type Mismatch Issue

### Critical: Prisma Client Type Mismatch
**Severity:** CRITICAL  
**Location:** `cleanup.service.ts` lines 75, 77, 86, 114

**Problem:**
TypeScript compilation errors indicate Prisma client types don't match the schema:
- `originalS3Key` field not recognized in select statement
- `statusChangedAt` field not recognized in where clause
- Null value type errors in filter conditions

**Possible Causes:**
1. Prisma client not regenerated after schema changes
2. Schema migrations not applied to database
3. Type cache issue in IDE/TypeScript

**Required Actions:**
```bash
# Regenerate Prisma client
pnpm prisma generate

# Restart TypeScript server in IDE
```

**Impact:**
- Code will not compile in production build
- Type safety is compromised
- Runtime errors possible if types don't match actual schema

---

## 📊 Performance Considerations

### Potential Bottlenecks

1. **Sequential Processing**
   - Files are processed one-by-one in loops
   - Could benefit from parallel processing with `Promise.all()`

2. **Database Query Efficiency**
   - Multiple queries per file (thumbnails, file record)
   - Could be optimized with joins or batch operations

3. **S3 API Calls**
   - Sequential S3 deletions can be slow
   - Consider batch delete API if available

---

## 🎯 Recommendations Priority

### Immediate (Before Production)
1. ✅ **DONE:** Fix type safety issues (removed `as any` casts)
2. ⚠️ **TODO:** Implement database transactions for atomic operations
3. ⚠️ **TODO:** Add race condition protection
4. ⚠️ **TODO:** Implement retry logic for failed deletions

### Short Term (Next Sprint)
5. Add comprehensive test coverage
6. Implement batch pagination for large datasets
7. Add monitoring and metrics
8. Improve error handling and classification

### Long Term (Future Improvements)
9. Add distributed locking for multi-instance deployments
10. Implement dead letter queue for failed cleanups
11. Add admin API to trigger manual cleanup
12. Create cleanup reports/dashboards

---

## 🔍 Questions for Team Discussion

1. **Multi-instance deployment:** Will this service run on multiple instances? If yes, need distributed locking.
2. **Cleanup frequency:** Is 6-hour interval appropriate for production load?
3. **Batch size:** Is 200 records per batch sufficient?
4. **S3 consistency:** How do we handle eventual consistency issues with S3?
5. **Monitoring:** What metrics are most important to track?
6. **Alerting:** What cleanup failures should trigger alerts?

---

## 📝 Conclusion

The cleanup service has a solid foundation but requires critical improvements before production deployment. The main concerns are:

1. **Data integrity:** Lack of transactions can cause inconsistencies
2. **Race conditions:** Concurrent operations can interfere with cleanup
3. **Error recovery:** No retry mechanism for failed operations
4. **Observability:** Missing metrics and monitoring

**Estimated effort to address critical issues:** 2-3 days

**Overall assessment:** 7/10 - Good structure, needs production hardening
