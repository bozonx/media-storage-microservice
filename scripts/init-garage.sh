#!/bin/bash
# We avoid 'set -e' here to handle intermediate check failures manually.


BUCKET_NAME=${S3_BUCKET:-media-files}
KEY_NAME=${GARAGE_KEY_NAME:-media-storage-app}

echo "DEBUG: Script started. Bucket=$BUCKET_NAME, Key=$KEY_NAME"
echo "DEBUG: Target container=$GARAGE_CONTAINER_NAME"


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
i=1
while [ $i -le 90 ]; do
  RUNNING=false
  # Use simple if to avoid set -e issues in some shells
  if is_container_running; then
    RUNNING=true
  fi
  
  READY=false
  if [ "$RUNNING" = "true" ]; then
    # Try status check, redirecting stderr to null to keep it clean
    if exec_garage status >/dev/null 2>&1; then
      READY=true
    fi
  fi

  # Explicit debug for every step for now
  echo "DEBUG: i=$i, running=$RUNNING, ready=$READY"

  if [ "$READY" = "true" ]; then
    consecutive_ok=$((consecutive_ok + 1))
    if [ "$consecutive_ok" -ge 2 ]; then
      break
    fi
  else
    consecutive_ok=0
    # Print status every 5 seconds instead of 10 for better feedback
    if [ $((i % 5)) -eq 0 ]; then
       echo "  ... Attempt $i/90: Running=$RUNNING, StatusCheck=$READY"
    fi
  fi

  sleep 1
  if [ "$i" -eq 90 ]; then
    echo "Garage is not ready after 90 seconds" >&2
    docker logs --tail=50 "$GARAGE_CONTAINER_NAME" 2>/dev/null || true
    exit 1
  fi
  i=$((i + 1))
done

echo "Garage is ready. Ensuring cluster layout..."

# We call this once here to make sure we don't crash on assignment
# The subshell $(...) with pipefail can be tricky
STATUS_OUTPUT=$(exec_garage status 2>&1)
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "Failed to run 'garage status'. Exit code: $EXIT_CODE" >&2
  echo "${STATUS_OUTPUT}" >&2
  exit 1
fi

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
