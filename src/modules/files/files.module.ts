import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { OptimizationModule } from '../optimization/optimization.module.js';

@Module({
  imports: [StorageModule, OptimizationModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
