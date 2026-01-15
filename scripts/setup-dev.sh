#!/bin/bash
set -e

echo "Setting up development environment..."

if [ ! -f .env.development ]; then
  echo "Creating .env.development from example..."
  cp .env.development.example .env.development
fi

echo "Starting PostgreSQL and MinIO..."
docker compose -f docker/docker-compose.yml up -d postgres minio

echo "Waiting for services to be healthy..."
sleep 5

echo "Installing dependencies..."
pnpm install

echo "Initializing MinIO bucket..."
bash scripts/init-minio.sh

echo ""
echo "✅ Development environment is ready!"
echo ""
echo "Services:"
echo "  - PostgreSQL: localhost:5432"
echo "  - MinIO API: http://localhost:9000"
echo "  - MinIO Console: http://localhost:9001"
echo ""
echo "To start the application:"
echo "  pnpm start:dev"
echo ""
