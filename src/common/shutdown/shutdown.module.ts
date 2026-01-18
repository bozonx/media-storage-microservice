import { Global, Module } from '@nestjs/common';

import { ShutdownService } from './shutdown.service.js';

@Global()
@Module({
  providers: [ShutdownService],
  exports: [ShutdownService],
})
export class ShutdownModule {}
