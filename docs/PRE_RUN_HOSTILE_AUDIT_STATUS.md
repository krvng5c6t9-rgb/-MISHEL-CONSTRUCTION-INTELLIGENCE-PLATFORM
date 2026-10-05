# Hostile Pre-Run Audit Status

## Scope
Final zero-trust pre-run review performed on the complete Construction / Fit-Out Enterprise ERP source before local PostgreSQL runtime testing.

## Verified PASS in this environment
- Full static import consistency.
- Permission consistency.
- Schema/code column consistency.
- Tenant-isolation static gate, strengthened to explicitly cover relationship-owned procurement/cost/security child tables.
- Phase 2–7 security/integrity gates.
- REV20 regression gate.
- Final hostile pre-run gate.
- Migration numbering: `001` through `032`, contiguous and unique.
- TypeScript/TSX parser check: 82 source files, 0 parse errors.
- Release package contains Docker local stack, migration runner, preflight scripts and first-run setup.

## Material defects found and remediated in this pass
1. Core procurement/cost child tables could previously rely on parent joins instead of owning a tenant key. Migration 032 now adds/backfills `org_id`, enforces parent-derived tenant consistency and FORCE RLS for the affected core tables.
2. PO total used JavaScript floating-point arithmetic. PO totals are now calculated in PostgreSQL `NUMERIC`.
3. Inventory sufficiency checks converted PostgreSQL NUMERIC balances to JavaScript Number. Sufficiency comparison now executes in PostgreSQL NUMERIC.
4. Payment approval did not persist `approval_instance_id`. It now does.
5. Manual journals could mix currencies while being checked as one nominal balance. Creation and submission now fail closed unless exactly one currency is present.
6. The old tenant static gate could PASS without proving direct tenant ownership of several core relationship tables. The gate now explicitly asserts those tables are hardened.
7. Projects UI was read-only. Project creation and reference selectors were added.
8. CRM lacked client creation, lead-activity capture and opportunity-to-tender conversion in the UI. These operational paths were added.
9. Procurement UI was largely read-only. MR, RFQ, quotation, PO, GRN, confirmation, vendor invoice and 3-way-match flows were added.
10. Finance UI was largely read-only. COA, bank accounts, fiscal periods, FX, payments, manual journals and IPC creation were added.
11. Raw numeric IDs across key engineering screens were replaced with tenant-scoped reference selectors where they represent system references.
12. Docker builds now require lockfiles and use `npm ci`; local preflight includes a dependency-freeze step and full regression before the stack starts.

## Environment-blocked pre-run item
`backend/package-lock.json` and `frontend/package-lock.json` could not be generated in this execution environment because npm registry access is unavailable and the required metadata is not cached. The included `scripts/freeze-dependencies.sh` generates both lockfiles from exact direct dependency versions before Docker startup; `scripts/run-local.sh` invokes it before `check:immutable` and `check:release`.

Current strict immutable-release gate therefore correctly reports **BLOCKED** until the dependency freeze completes on a network-enabled local machine. This is not marked PASS.

## Runtime status
PostgreSQL migrations, backend/frontend compiled build, browser runtime, E2E, concurrency, hostile tenant runtime tests, performance and backup/restore remain **UNVERIFIED** until the local stack is actually executed. No runtime PASS is claimed here.
