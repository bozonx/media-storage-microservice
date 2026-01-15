#!/bin/bash
set -euo pipefail

NODE_ENV_VALUE="${NODE_ENV:-}"
PRISMA_ENV_FILE_VALUE="${PRISMA_ENV_FILE:-}"

resolve_env_file() {
  if [ -n "${PRISMA_ENV_FILE_VALUE}" ]; then
    echo "${PRISMA_ENV_FILE_VALUE}"
    return
  fi

  case "${NODE_ENV_VALUE}" in
    development) echo ".env.development" ;;
    production) echo ".env.production" ;;
    test) echo ".env.test" ;;
    *)
      if [ -f ".env" ]; then
        echo ".env"
        return
      fi

      if [ -f ".env.development" ]; then
        echo ".env.development"
        return
      fi

      if [ -f ".env.production" ]; then
        echo ".env.production"
        return
      fi

      echo ""
      ;;
  esac
}

ENV_FILE="$(resolve_env_file)"

if [ -n "${ENV_FILE}" ]; then
  if [ ! -f "${ENV_FILE}" ]; then
    echo "Env file '${ENV_FILE}' is not found. Create it (e.g. from an example) or set PRISMA_ENV_FILE/DATABASE_URL." >&2
    exit 1
  fi

  set -a
  . "${ENV_FILE}"
  set +a
fi

PRISMA_SUBCOMMAND="${1:-}"

requires_database_url() {
  case "${PRISMA_SUBCOMMAND}" in
    migrate | db | studio | introspect)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if requires_database_url && [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Prisma requires it for '${PRISMA_SUBCOMMAND}'." >&2
  echo "Resolved env file: ${ENV_FILE:-<none>} (NODE_ENV='${NODE_ENV_VALUE:-<empty>}')" >&2
  exit 1
fi

exec pnpm exec prisma "$@"
