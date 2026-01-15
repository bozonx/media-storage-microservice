import { Module } from '@nestjs/common';
import { OrphanCleanupService } from './orphan-cleanup.service.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  providers: [OrphanCleanupService],
})
export class CleanupModule {}
