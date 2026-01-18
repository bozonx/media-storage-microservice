import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { getDatabaseUrl } from '../../config/database.config.js';
import { PrismaClient } from '../../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL ?? getDatabaseUrl();
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
