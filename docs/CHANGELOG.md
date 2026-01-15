# Changelog

## Unreleased

- Logging: unify application logs on Pino (nestjs-pino) with structured error fields.
- Errors: harden global exception responses and map Prisma errors to HTTP.
- Cleanup: make cron schedule configurable via `CLEANUP_CRON`.
- Files: harden download headers and improve deduplication behavior.
