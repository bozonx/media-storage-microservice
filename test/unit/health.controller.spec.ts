import { Test, type TestingModule } from '@nestjs/testing';

import { HealthController } from '../../src/modules/health/health.controller.js';
import { HealthService } from '../../src/modules/health/health.service.js';

describe('HealthController (unit)', () => {
  let controller: HealthController;
  let moduleRef: TestingModule;
  const healthServiceMock: Pick<HealthService, 'check'> = {
    check: async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      storage: {
        s3: 'connected',
        database: 'connected',
      },
    }),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: healthServiceMock,
        },
      ],
    }).compile();

    controller = moduleRef.get<HealthController>(HealthController);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /api/v1/health returns ok', async () => {
    const res = await controller.check();
    expect(res).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      storage: {
        s3: 'connected',
        database: 'connected',
      },
    });
  });
});
