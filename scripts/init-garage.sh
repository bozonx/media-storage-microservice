#!/bin/bash
set -euo pipefail

GARAGE_CONTAINER_NAME=${GARAGE_CONTAINER_NAME:-garaged}
BUCKET_NAME=${S3_BUCKET:-media-files}
KEY_NAME=${GARAGE_KEY_NAME:-media-storage-app}

exec_garage() {
  docker exec -i "$GARAGE_CONTAINER_NAME" /garage "$@"
}

echo "Waiting for Garage to be ready..."
for _ in $(seq 1 60); do
  if exec_garage status >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [ "$_" -eq 60 ]; then
    echo "Garage is not ready after 60 seconds" >&2
    exit 1
  fi
done

echo "Garage is ready. Ensuring cluster layout..."

NODE_ID=$(exec_garage status 2>/dev/null | awk 'NF > 0 && $1 ~ /^[0-9a-f]{4,}$/ { print $1; exit }')
if [ -z "${NODE_ID:-}" ]; then
  echo "Failed to detect Garage node id" >&2
  exec_garage status || true
  exit 1
fi

exec_garage layout assign -z dc1 -c 1G "${NODE_ID}" >/dev/null 2>&1 || true
exec_garage layout apply --version 1 >/dev/null 2>&1 || true

echo "Ensuring bucket '${BUCKET_NAME}' exists..."
if exec_garage bucket list 2>/dev/null | awk '{print $1}' | grep -Fxq "${BUCKET_NAME}"; then
  echo "Bucket '${BUCKET_NAME}' already exists"
else
  exec_garage bucket create "${BUCKET_NAME}"
  echo "Bucket '${BUCKET_NAME}' created"
fi

echo "Ensuring key '${KEY_NAME}' exists..."
KEY_INFO=$(exec_garage key info "${KEY_NAME}" 2>/dev/null || true)
if [ -n "${KEY_INFO}" ]; then
  echo "Key '${KEY_NAME}' already exists"
  echo "NOTE: Garage does not show the secret key again. Use your existing S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY." >&2
else
  KEY_CREATE_OUTPUT=$(exec_garage key create "${KEY_NAME}")
  echo "${KEY_CREATE_OUTPUT}"

  ACCESS_KEY_ID=$(echo "${KEY_CREATE_OUTPUT}" | sed -n 's/.*Key ID: \([^ ]*\).*/\1/p')
  SECRET_ACCESS_KEY=$(echo "${KEY_CREATE_OUTPUT}" | sed -n 's/.*Secret key: \([^ ]*\).*/\1/p')

  if [ -n "${ACCESS_KEY_ID}" ] && [ -n "${SECRET_ACCESS_KEY}" ]; then
    echo ""
    echo "Add these values to your .env.development:"
    echo "S3_ACCESS_KEY_ID=${ACCESS_KEY_ID}"
    echo "S3_SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY}"
    echo ""
  fi
fi

echo "Ensuring key access to bucket..."
exec_garage bucket allow --read --write --owner "${BUCKET_NAME}" --key "${KEY_NAME}" >/dev/null 2>&1 || true

echo "Garage initialization complete"
