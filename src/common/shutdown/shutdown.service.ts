import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';

@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  private shuttingDown = false;

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }
}
