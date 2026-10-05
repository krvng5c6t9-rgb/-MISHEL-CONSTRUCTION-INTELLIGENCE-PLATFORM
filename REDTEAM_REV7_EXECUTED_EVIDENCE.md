# REV7 Executed Evidence

## Executed on extracted REV6 source
- Root static import check: PASS.
- Permission consistency check: PASS.
- Schema/code column check: PASS (111 tables, 46 backend SQL files).
- Tenant isolation static check: PASS (46 TypeScript source files, 21 SQL migrations).
- Phase 2–7 static/security gates: PASS.
- REV5 regression gate: PASS.
- Red-team release gate initially FAILED because it referenced the obsolete migration path `020_redteam_integrity_hardening.sql` after the migration was renumbered to `021_redteam_integrity_hardening.sql`.
- The stale reference was corrected to `021_redteam_integrity_hardening.sql` and the red-team release gate was rerun: PASS.

## Build/runtime evidence
- Node v22.16.0 and npm 10.9.2 are available.
- Dependency installation was attempted with npm and timed out before dependencies were installed.
- Therefore dependency-resolved TypeScript/Vite build remains UNVERIFIED; no claim of source compile success or source compile failure is made.
- `psql` and Docker are not available in the execution environment used for this review; PostgreSQL migration execution, RLS attack tests, runtime E2E, concurrency and backup/restore remain UNVERIFIED here.

## Additional hostile findings retained
- No Jest/Vitest/Playwright/Cypress/Supertest test framework was found in package manifests/source search; existing gates are predominantly static structural checks, not a substitute for runtime tests.
- Historical migrations contain explicit placeholder DOA/business seed values. Migration 020 removes unconfirmed placeholder DOA rows and demonstrative master data where safe. Real company DOA remains configuration-required before go-live.
- `database/seed_minimal.sql` contains `CHANGE_ME_HASH`; it must never be treated as production credentials.
- Financial/approval code converts some PostgreSQL numeric values with JavaScript `Number(...)`; financial decimal precision remains a hostile-review item requiring runtime boundary tests and/or a decimal-string/decimal-library policy before production certification.

## Release decision
NOT PRODUCTION CERTIFIED. Static gates passing does not close the blocked runtime acceptance requirements above.
