import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function getDatabaseUrl(): string {
  const existing = process.env.DATABASE_URL;
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const host = process.env.DATABASE_HOST ?? 'localhost';
  const port = process.env.DATABASE_PORT ?? '5432';
  const database = process.env.DATABASE_NAME ?? 'media_storage';
  const user = process.env.DATABASE_USER ?? 'media_user';
  const password = process.env.DATABASE_PASSWORD ?? 'changeme';

  const sslEnabled = (process.env.DATABASE_SSL ?? 'false') === 'true';
  const params = new URLSearchParams();
  if (sslEnabled) {
    params.set('sslmode', 'require');
  }

  const query = params.toString();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${query ? `?${query}` : ''}`;
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  datasource: {
    url: getDatabaseUrl(),
  },
});
