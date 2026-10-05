# REV9 Executed Adversarial Evidence

## Newly discovered defects in REV8
1. Vendor-invoice 3-way matching converted PostgreSQL NUMERIC monetary values to JavaScript Number and used Math.abs for variance/tolerance decisions.
2. Vendor-invoice actual-cost posting added invoice + tax in JavaScript Number.
3. Manual-journal creation and submission still contained JavaScript Float64 balance arithmetic despite the earlier hardening of the final GL posting service.
4. GL posting service still coerced source monetary amounts through Number before insertion.
5. Approval service accepted monetary amounts only as number, encouraging precision-loss conversion of PostgreSQL NUMERIC values.

## Remediation executed
- Moved 3-way match PO/GRN/invoice/tolerance/variance calculation to PostgreSQL NUMERIC.
- Moved vendor-invoice actual cost calculation to PostgreSQL NUMERIC.
- Moved manual-journal creation and pre-approval balancing to PostgreSQL NUMERIC.
- GL posting now accepts/preserves numeric strings from PostgreSQL and validates positivity using PostgreSQL NUMERIC.
- Approval service accepts number|string|null and preserves database NUMERIC strings for DOA matching.
- Added `scripts/redteam-rev9-check.mjs` to prevent regression of these precision defects.

## Executed after remediation
- `node scripts/redteam-rev9-check.mjs` — PASS.
- `npm run check:all` — PASS (imports, permissions, schema/code; 111 tables / 46 backend SQL files).
- Tenant isolation static gate — PASS.
- Phase 2–7 security/integrity gates — PASS.

## Dependency-resolved build attempt
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund` was attempted in backend and timed out at 120 seconds. No dependency-resolved compile is claimed.

## Runtime boundary
PostgreSQL/Docker are unavailable in this execution environment, so DB migrations, runtime RLS attacks, E2E/concurrency and backup/restore remain UNVERIFIED.
