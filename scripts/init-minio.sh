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

echo "Configuring bucket lifecycle rules (expire tmp/ and originals/ after 2 days)..."

if mc ilm rule ls local/media-files 2>/dev/null | grep -q "tmp/"; then
  echo "Lifecycle rule for 'tmp/' already exists"
else
  mc ilm rule add local/media-files --prefix "tmp/" --expire-days 2
  echo "Lifecycle rule for 'tmp/' added"
fi

if mc ilm rule ls local/media-files 2>/dev/null | grep -q "originals/"; then
  echo "Lifecycle rule for 'originals/' already exists"
else
  mc ilm rule add local/media-files --prefix "originals/" --expire-days 2
  echo "Lifecycle rule for 'originals/' added"
fi

echo "MinIO initialization complete"
