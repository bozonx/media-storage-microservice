import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { FileEntity } from './entities/file.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { OptimizationModule } from '../optimization/optimization.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity]),
    StorageModule,
    OptimizationModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
