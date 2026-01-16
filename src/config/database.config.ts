import { registerAs } from '@nestjs/config';

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    throw new Error('DATABASE_URL environment variable is required and cannot be empty');
  }
  return url;
}

export default registerAs('database', () => ({
  url: getDatabaseUrl(),
}));
