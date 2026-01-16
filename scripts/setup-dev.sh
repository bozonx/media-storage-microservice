#!/bin/bash
set -e

echo "Setting up development environment..."

if [ ! -f .env.development ]; then
  echo "Creating .env.development from example..."
  cp .env.development.example .env.development
fi

echo "Starting PostgreSQL and Garage..."
docker compose -f docker-compose.yml up -d --remove-orphans postgres garage

echo "Waiting for services to be healthy..."
sleep 5

echo "Installing dependencies..."
pnpm install

echo "Initializing Garage bucket and key..."
bash scripts/init-garage.sh

echo ""
echo "✅ Development environment is ready!"
echo ""
echo "Services:"
echo "  - PostgreSQL: localhost:5432"
echo "  - Garage S3 API: http://localhost:3900"
echo "  - Garage Admin API: http://localhost:3903"
echo ""
echo "To start the application:"
echo "  pnpm start:dev"
echo ""
