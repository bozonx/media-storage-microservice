#!/bin/bash
set -euo pipefail

BUCKET_NAME=${S3_BUCKET:-media-files}
KEY_NAME=${GARAGE_KEY_NAME:-media-storage-app}

# Auto-detect container name if not specified
if [ -z "${GARAGE_CONTAINER_NAME:-}" ]; then
  if docker ps --format '{{.Names}}' | grep -q "^media-storage-garage$"; then
    GARAGE_CONTAINER_NAME="media-storage-garage"
  elif docker ps --format '{{.Names}}' | grep -q "^garaged$"; then
    GARAGE_CONTAINER_NAME="garaged"
  else
    GARAGE_CONTAINER_NAME="garaged" # Default fallback
  fi
  echo "Auto-detected Garage container: $GARAGE_CONTAINER_NAME"
fi

exec_garage() {
  docker exec -i "$GARAGE_CONTAINER_NAME" /garage "$@"
}

is_container_running() {
  docker inspect -f '{{.State.Running}}' "$GARAGE_CONTAINER_NAME" 2>/dev/null | grep -Fxq true
}

echo "Waiting for Garage (${GARAGE_CONTAINER_NAME}) to be ready..."
consecutive_ok=0
for i in $(seq 1 90); do
  # Check if container is running and 'garage status' works
  # We use -i without -t to support pipes
  if is_container_running && exec_garage status >/dev/null 2>&1; then
    consecutive_ok=$((consecutive_ok + 1))
    if [ "$consecutive_ok" -ge 2 ]; then
      break
    fi
  else
    consecutive_ok=0
    # Optional: print progress every 10 seconds
    if [ $((i % 10)) -eq 0 ]; then
       echo "Still waiting for Garage... (Attempt $i/90)"
       if ! is_container_running; then echo "Hint: Container ${GARAGE_CONTAINER_NAME} is NOT running"; fi
    fi
  fi

  sleep 1
  if [ "$_" -eq 90 ]; then
    echo "Garage is not ready after 90 seconds" >&2
    docker logs --tail=50 "$GARAGE_CONTAINER_NAME" 2>/dev/null || true
    exit 1
  fi
done

echo "Garage is ready. Ensuring cluster layout..."

STATUS_OUTPUT=$(exec_garage status 2>&1) || {
  echo "Failed to run 'garage status'" >&2
  echo "${STATUS_OUTPUT}" >&2
  exit 1
}

NODE_ID=$(echo "${STATUS_OUTPUT}" | awk 'NF > 0 && $1 ~ /^[0-9a-f]{4,}$/ { print $1; exit }')
if [ -z "${NODE_ID:-}" ]; then
  echo "Failed to detect Garage node id" >&2
  echo "${STATUS_OUTPUT}" >&2
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
