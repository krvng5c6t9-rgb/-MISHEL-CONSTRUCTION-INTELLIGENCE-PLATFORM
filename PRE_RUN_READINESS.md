# Construction ERP — Pre-Run Readiness

This package is prepared for the next step: local runtime acceptance.

## One-command local start

```bash
./scripts/run-local.sh
```

The script generates local secrets in `.env.local`, runs the pre-run structural gate, builds the Docker stack, applies migrations through a checksum-tracked migrator, and starts PostgreSQL + Backend + Frontend.

Frontend: `http://localhost:5173`
First-run setup: `http://localhost:5173/setup`
Backend health: `http://localhost:4000/api/health`

## Safety behavior

- Migrations are tracked in `schema_migrations` by filename + SHA-256 checksum.
- A changed already-applied migration fails closed.
- Automatic migration refuses to guess a baseline on an existing legacy ERP database without migration history.
- Historical demo seed behavior is disabled.
- No default administrator credentials are shipped.
- Local secrets are generated outside source control.

## Verification boundary

Static/security/pre-run checks can be executed in this package. Full PostgreSQL runtime, E2E, negative, concurrency, performance, and backup/restore acceptance must be executed on the local runtime environment before any Production Ready claim.
