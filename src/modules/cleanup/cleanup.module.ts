import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { CleanupService } from './cleanup.service.js';

@Module({
  imports: [StorageModule],
  providers: [CleanupService],
})
export class CleanupModule {}
