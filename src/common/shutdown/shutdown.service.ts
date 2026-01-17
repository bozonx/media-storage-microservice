import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';

@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  private shuttingDown = false;
  private shutdownStartedAtMs: number | null = null;
  private readonly shutdownTimeoutMs: number;

  constructor() {
    const parsed = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '', 10);
    this.shutdownTimeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  getShutdownTimeoutMs(): number {
    return this.shutdownTimeoutMs;
  }

  getShutdownRemainingMs(nowMs: number = Date.now()): number {
    if (!this.shuttingDown || this.shutdownStartedAtMs === null) {
      return this.shutdownTimeoutMs;
    }

    const elapsed = nowMs - this.shutdownStartedAtMs;
    return Math.max(0, this.shutdownTimeoutMs - elapsed);
  }

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
    this.shutdownStartedAtMs = Date.now();
  }
}
