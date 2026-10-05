# REV6 executed red-team evidence

This file records only checks actually executed in the packaging environment.

## Closed defects
- Duplicate migration sequence `020` removed: integrity hardening migration is now `021_redteam_integrity_hardening.sql`.
- PostgreSQL advisory lock corrected for BIGINT warehouse/item identifiers by using one BIGINT hash advisory key.
- Warehouse transfer no longer mutates an append-only inventory transaction after insertion.
- Contract direct status/edit path cannot bypass signing approval or mutate a contract while approval is pending.
- Tender direct edit path cannot set `submitted` and cannot mutate a tender while submission approval is pending.
- Stale runtime logs and TypeScript build-info artifact removed from release package.
- Docker Compose no longer contains a committed database password; `.env.example` uses explicit secret placeholders.

## Executed checks after repairs
- `node scripts/redteam-rev5-check.mjs` — PASS, including unique migration sequence and newly added bypass checks.
- `npm run check:all` — PASS.
- Backend tenant isolation check — PASS.
- Backend Phase 2 through Phase 7 static/security gates — PASS before the final source edits; relevant global import/schema checks were rerun after edits.

## Not proven in this environment
- Dependency-resolved TypeScript production build.
- PostgreSQL execution of migrations 001–021.
- Runtime tenant/RLS attacks.
- Browser E2E.
- Concurrency/load/backup-restore tests.

These remain UNVERIFIED, not PASS.
