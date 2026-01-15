#!/bin/bash
set -e

echo "Waiting for MinIO to be ready..."
until curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; do
  sleep 1
done

echo "MinIO is ready. Creating bucket..."

mc alias set local http://localhost:9000 minioadmin minioadmin

if mc ls local/media-files > /dev/null 2>&1; then
  echo "Bucket 'media-files' already exists"
else
  mc mb local/media-files
  echo "Bucket 'media-files' created successfully"
fi

echo "MinIO initialization complete"
