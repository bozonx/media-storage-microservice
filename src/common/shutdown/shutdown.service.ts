import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  private shuttingDown = false;
  private shutdownStartedAtMs: number | null = null;
  private readonly shutdownTimeoutMs: number;

  constructor() {
    const parsedSeconds = Number.parseInt(process.env.SHUTDOWN_TIMEOUT ?? '', 10);
    const timeoutSeconds =
      Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : 30;
    this.shutdownTimeoutMs = timeoutSeconds * 1000;
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
