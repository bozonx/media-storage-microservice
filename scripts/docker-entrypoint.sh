#!/bin/sh
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is required" >&2
  exit 1
fi

pnpm prisma migrate deploy

exec node dist/src/main.js
