# CURRENT STATE — MISHEL Construction Intelligence Platform (POST-R0 + Investigation R01–R09)

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
- `tests/e2e/`: runtime suites (`chain.mjs` E2E, `isolation.mjs` negative/isolation/authorization/error-hygiene, `run_from_zero.sh` full gate, `lib.mjs`, `probe.mjs`)
- `.github/workflows/runtime-gate.yml`: CI gate on PostgreSQL 16 + 17 (build, lint, static checks, runtime from zero)
- `governance/HANDOFF.md`: current position, open gaps, owner decisions, next step (M09 template)
- `governance/registers/`: the 20 M09 registers (05 tests, 06 evidence, 07 gaps, 08 issues, 09 decisions, 10 change control, 12 risks, 14 sources populated)
- `governance/reconciliation/`: R01–R09 reconciliation records + extracted datasets (table inventory, carry-through map, D-entity coverage, scenarios, SOP skeleton, v1 feature inventory, agent archetypes)
- `governance/discovery/NEWLY_DISCOVERED_CAPABILITY_REGISTER.csv`: NDC-001…009 + dropped-frozen-scope DFS-001…006
- `governance/SOURCE_REGISTER.csv`: 4,936 source files, 1,268 unique by SHA-256, read status per file, version families
- `governance/tools/`: `mark_read.py` (register status), `d_entity_map.py` (manual D-entity mapping)
- `takeover/R0_REPORT.md`, `takeover/evidence/`: R0 verdict and raw logs
- `governance/DECISION_LEDGER.md`: Controlled Changes, autonomous decisions, open findings
- `governance/owner_directives/`: governing owner directives (Product Constitution, post-R0 execution directive, start prompts)
- `governance/baseline_pack/`: the 56-file MISHEL Complete Pack (M01–M11, D01–D20, registers): mandatory input baseline, not a ceiling
- Root `*_EVIDENCE.md`, `FINAL_HANDOVER_*`, `REDTEAM_*`: inherited v0.2 documentation. **Not trusted as evidence** (see F-09)

## Controlled Changes CC-001 → CC-014
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
| CC-013 | `POST /projects` requires `projects.create`; PostgreSQL SQLSTATE → 4xx mapping; generic 500 with reference id (no SQL leakage) |
| CC-014 | CI runtime gate (PG 16 + 17); test harness short tag for business codes |
Full Decision/Evidence/Alternatives/Reason/Impact/Rollback: `governance/DECISION_LEDGER.md`.

## R0 results (fresh database, executed)
| Suite | Result | Log |
|---|---|---|
| Backend + frontend `tsc` | clean | (CI-equivalent: `npm run lint`) |
| Migrations from zero | `MIGRATIONS_OK 37` | `takeover/evidence/C4_migrate_from_zero_after_CC009.log` |
| E2E chain Lead→…→Payment→GL (API only) | 74/74 PASS, GL balanced | `takeover/evidence/R0-4_e2e_chain.log` |
| Tenant isolation negative tests (R0) | 32/32 PASS | `takeover/evidence/R0-5_tenant_isolation.log` |
| Negative suite after CC-013 (isolation + authorization + error hygiene) | 36/36 PASS | `tests/e2e/run_from_zero.sh`; CI run 37272015775 |
| CI runtime gate | PASS on PG 16.15 and PG 17.11 | GitHub Actions run 37272015775 |
| Inherited static check scripts | 26/26 PASS | `takeover/evidence/R0-6_existing_check_scripts.log` |

## Investigation status (R01–R09, `governance/reconciliation/`)
- R01: the 4,602 STEP17 requirements are a platform-contract scaffold (67% structural, 20% fields, 13% governance; 0 for take-off/EVM/CPM/RFI/cash flow/delay analysis).
- R02: activation-pack operating model = valuable skeleton (159 positions, ~70 disciplines, DOA/control/KPI models); job descriptions/SOP bodies templated.
- R03: v5 "TRUE FINAL" evidence is 100% name-mapping; 787 vs 833 and 531 vs 1,660 resolved.
- R04: STEP_01 DNA + 38 Golden Cases adopted as acceptance backbone; Golden Cases 0 refs in 4,602; ≤12% of STEP03-16 tables cited by STEP17.
- R05: D01–D20 vs schema (manual, 329 entities): R 27 / S 47 / T 85 / A 170; 193 scenarios, 596 test IDs pending.
- R06: STEP18 = ~1.7k-line generic Python prototype (its own committee: NOT FIT FOR FREEZE); 170 agent archetypes extracted.
- R07: STEP03/04/05 adopted (12-dimension DOA, 32 handoffs, 30 value streams, architecture principles, derived stores).
- R08: original scope requires ONE application (ERP + expert/knowledge command layer), not parallel tracks.
- R09: research-board synthesis → NDC-001…009; Egypt-first jurisdiction layering; never-invent activation inputs.
- Source coverage (unique files): READ_FULL 26 · PARSED_FULL 38 · SAMPLED 9 · INVENTORIED 513 · READ_RUNTIME 180 · CONTAINER 15 · UNREAD 487; plus 3 Drive archives > 10 MB UNREAD (owner action G-012).

## Open gaps / risks / owner decisions (see `governance/registers/07,09,12`)
- Gaps: G-001 BOQ handover · G-002 vendor API · G-003 tenant provisioning · G-004 DOA API/versioning · G-005 IPC/retention posting (OPEN owner decision DEC-009) · G-006 bootstrap model · G-007 Golden Cases undecomposed · G-008 dropped frozen scope · G-009 D-pack coverage · G-010 hostile concurrency tests · G-011 STEP02 atlas · G-012 unread archives.
- Closed since POST-R0 snapshot: F-06 (projects.create) and F-07 (DB error mapping) by CC-013; PG 17 verification by CI.
- Risks: RK-001 unread archives may change scope · RK-002 templated sources mistaken for specification · RK-003 similar defect density in untested modules.

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
**VERIFIED (executed, logs in `takeover/evidence/` and CI):** build, migrations from zero on PG 16.14/16.15/17.11, project-create authorization, SQLSTATE error mapping without SQL leakage, API authentication, DOA-driven approvals with SoD and wrong-role rejection, the commercial-procurement-finance chain to a balanced GL, AP/AR creation, idempotency of GRN confirm and GL posting, cross-tenant read/write/approval isolation at API and DB level, bootstrap refusal on orgs with active users.

**UNVERIFIED:** docker-compose runtime; frontend behaviour in a browser; every module outside the chain (HR/payroll, assets/plant, QA/QC, HSE, EDMS/CDE, planning, site, subcontracts, claims, variations, inventory transfers, portals, dashboards/reports, AI platform, automation, knowledge); performance/load; backup/restore/DR; penetration testing; production readiness of any kind. All DOA thresholds, CoA codes, GL rules and amounts used in tests are **TEST FIXTURES**, not owner-approved values.

No secrets are included: credentials appear only as `<placeholders>` and as test-only fixture passwords inside `tests/e2e`.
