import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  providers: [CleanupService],
})
export class CleanupModule {}
