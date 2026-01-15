import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrphanCleanupService } from './orphan-cleanup.service.js';
import { FileEntity } from '../files/entities/file.entity.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity]),
    StorageModule,
  ],
  providers: [OrphanCleanupService],
})
export class CleanupModule {}
