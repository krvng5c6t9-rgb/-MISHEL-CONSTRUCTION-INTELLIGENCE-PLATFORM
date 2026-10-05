# CURRENT STATE — MISHEL Construction Intelligence Platform (POST-R0)

| Item | Value |
|---|---|
| Git repository | `krvng5c6t9-rgb/-MISHEL-CONSTRUCTION-INTELLIGENCE-PLATFORM` |
| Git branch | `claude/read-file-dsz1qx` |
| Git commit | Exact snapshot commit SHA is in `SNAPSHOT_COMMIT.txt` inside the archive (this file cannot contain the SHA of the commit that adds it). R0 suites were last executed on that exact code (see archive verification below) |
| Snapshot date | 2026-10-05 (UTC) |
| Node / npm tested | v22.22.0 / 10.9.4 |
| PostgreSQL tested | 16.14 locally; 16.15 and 17.11 in CI (CI run 37272015775 (jobs 111640832716 PG 16.15, 111640833225 PG 17.11), commit 60db79c): build, migrations 001–037, E2E chain and negative suite all passed |
| Migrations | 37 (`database/migrations/001…037`), all applied from an empty DB |
| Baseline source | `MISHEL_COMMERCIAL_PRODUCT_V0_2_ACTUAL_MERGE.zip` (SHA-256 verified vs Drive manifest), imported unmodified in commit `8351acc` |

## Repository map
- `backend/`: Express + TypeScript API (37 module routers), `src/db/migrate.ts` migrator, `scripts/` security checks
- `frontend/`: React + Vite UI
- `database/migrations/`: schema and RLS. `database/docker-init/`: app-role creation for compose
- `tests/e2e/`: R0 runtime suites (`chain.mjs` E2E, `isolation.mjs` tenant negative tests, `lib.mjs`, `probe.mjs`)
- `takeover/R0_REPORT.md`, `takeover/evidence/`: R0 verdict and raw logs
- `governance/DECISION_LEDGER.md`: Controlled Changes, autonomous decisions, open findings
- `governance/owner_directives/`: governing owner directives (Product Constitution, post-R0 execution directive, start prompts)
- `governance/baseline_pack/`: the 56-file MISHEL Complete Pack (M01–M11, D01–D20, registers): mandatory input baseline, not a ceiling
- Root `*_EVIDENCE.md`, `FINAL_HANDOVER_*`, `REDTEAM_*`: inherited v0.2 documentation. **Not trusted as evidence** (see F-09)

## Controlled Changes CC-001 → CC-012
| CC | Summary |
|---|---|
| CC-001 | Lockfiles generated (reproducible `npm ci`) |
| CC-002 | TypeScript build errors fixed (type-only) |
| CC-003 | Migrations apply from zero (011/017/019/020/028/032 + migrator-managed txns); migrator/app role separation; production refuses superuser/BYPASSRLS API role |
| CC-004 | pg bigint → number (all authenticated calls were 401) |
| CC-005 | DOA confirm endpoint cast (was 500; approvals impossible) |
| CC-006 | Migration 035: state-machine trigger fixed (tender/contract/variation updates were impossible) |
| CC-007 | Typed tender conversion; `FOR UPDATE OF vi`; migration 036 cost-ledger GL-posted flag exception |
| CC-008 | Only actual (not committed) cost posts to GL |
| CC-009 | Migration 037: RLS on `organizations` |
| CC-010 | docker-compose: backend runs as non-superuser `erp_app` |
| CC-011 | Check script / frontend lint alignment |
| CC-012 | Migrator needs only DB settings (found by verifying this snapshot from zero) |
Full Decision/Evidence/Alternatives/Reason/Impact/Rollback: `governance/DECISION_LEDGER.md`.

## R0 results (fresh database, executed)
| Suite | Result | Log |
|---|---|---|
| Backend + frontend `tsc` | clean | (CI-equivalent: `npm run lint`) |
| Migrations from zero | `MIGRATIONS_OK 37` | `takeover/evidence/C4_migrate_from_zero_after_CC009.log` |
| E2E chain Lead→…→Payment→GL (API only) | 74/74 PASS, GL balanced | `takeover/evidence/R0-4_e2e_chain.log` |
| Tenant isolation negative tests | 32/32 PASS | `takeover/evidence/R0-5_tenant_isolation.log` |
| Inherited static check scripts | 26/26 PASS | `takeover/evidence/R0-6_existing_check_scripts.log` |

## Known open issues (see ledger §3)
F-01 no execution-BOQ (`project_boq`) creation path · F-02 no vendor API · F-03 no tenant provisioning · F-04 no DOA create API / approver permissions; DOA values are placeholders/test fixtures · F-05 IPC revenue/retention posting: OPEN accounting design decision · F-06 `/projects` lacks `authorize()` · F-07 DB exceptions return HTTP 500 · F-08 unlimited bootstrap-token tenant creation · F-09 inherited static checks are not functional evidence · F-10 documentation drift · F-11 three Drive archives > 10 MB UNREAD.

## Install / build / migrate / run / test from zero
Prerequisites: Node 22, npm 10, PostgreSQL 16 or 17 (both verified in CI).
```bash
# 1. Database roles (as a PostgreSQL superuser)
psql -c "create role erp_owner login bypassrls password '<OWNER_PW>'"
psql -c "create role erp_app login password '<APP_PW>'"          # no superuser, no bypassrls
psql -c "create database construction_erp owner erp_owner"

# 2. Build
(cd backend && npm ci && npm run build)
(cd frontend && npm ci && npm run build)

# 3. Migrate (owner role), granting the app role
cd backend
MIGRATION_DATABASE_URL=postgresql://erp_owner:<OWNER_PW>@localhost:5432/construction_erp \
DATABASE_URL=postgresql://erp_app:<APP_PW>@localhost:5432/construction_erp \
APP_DB_ROLE=erp_app MIGRATIONS_DIR=../database/migrations node dist/db/migrate.js   # expect MIGRATIONS_OK 37

# 4. Run API as the app role
DATABASE_URL=postgresql://erp_app:<APP_PW>@localhost:5432/construction_erp \
JWT_SECRET=<32+ chars> BOOTSTRAP_ADMIN_TOKEN=<32+ chars> PORT=4000 node dist/server.js

# 5. Runtime tests (API on :4000)
cd ../tests/e2e && mkdir -p out
BOOTSTRAP_ADMIN_TOKEN=<token> node probe.mjs          # bootstraps tenant A (org 1) and tenant B (org 2)
PSQL_URL=postgresql://erp_owner:<OWNER_PW>@localhost:5432/construction_erp node chain.mjs
APP_PSQL_URL=postgresql://erp_app:<APP_PW>@localhost:5432/construction_erp node isolation.mjs out/chain_<RUN>.json

# 6. Static checks
(cd backend && npm run lint && for s in tenant phase2 phase3 phase4 phase5 phase6 phase7; do npm run -s security:$s; done)
for f in scripts/*.mjs; do node "$f"; done
```
Docker alternative: set `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_TOKEN`, then `docker compose up --build`. **UNVERIFIED at runtime.**

## VERIFIED vs UNVERIFIED
**VERIFIED (executed, logs in `takeover/evidence/`):** build, migrations from zero on PG 16.14, API authentication, DOA-driven approvals with SoD and wrong-role rejection, the commercial-procurement-finance chain to a balanced GL, AP/AR creation, idempotency of GRN confirm and GL posting, cross-tenant read/write/approval isolation at API and DB level, bootstrap refusal on orgs with active users.

**UNVERIFIED:** docker-compose runtime; frontend behaviour in a browser; every module outside the chain (HR/payroll, assets/plant, QA/QC, HSE, EDMS/CDE, planning, site, subcontracts, claims, variations, inventory transfers, portals, dashboards/reports, AI platform, automation, knowledge); performance/load; backup/restore/DR; penetration testing; production readiness of any kind. All DOA thresholds, CoA codes, GL rules and amounts used in tests are **TEST FIXTURES**, not owner-approved values.

No secrets are included: credentials appear only as `<placeholders>` and as test-only fixture passwords inside `tests/e2e`.
