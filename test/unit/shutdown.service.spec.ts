import { Test, type TestingModule } from '@nestjs/testing';
import { ShutdownService } from '../../src/common/shutdown/shutdown.service.js';

describe('ShutdownService (unit)', () => {
  let service: ShutdownService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [ShutdownService],
    }).compile();

    service = moduleRef.get(ShutdownService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('isShuttingDown returns false by default', () => {
    expect(service.isShuttingDown()).toBe(false);
  });

  it('sets shutdown flag on beforeApplicationShutdown', () => {
    service.beforeApplicationShutdown();
    expect(service.isShuttingDown()).toBe(true);
  });
});
