#!/bin/sh
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  DB_HOST="${DATABASE_HOST:-localhost}"
  DB_PORT="${DATABASE_PORT:-5432}"
  DB_NAME="${DATABASE_NAME:-media_storage}"
  DB_USER="${DATABASE_USER:-media_user}"
  DB_PASSWORD="${DATABASE_PASSWORD:-changeme}"

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  export DATABASE_URL
fi

pnpm prisma migrate deploy

exec node dist/src/main.js
