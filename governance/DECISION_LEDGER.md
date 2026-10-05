# Decision & Evidence Ledger

Governing input: Owner Supreme Product Directive 2026-10-05 (§23 R0 gate, §28 autonomy, §29 no premature final plan).
Rules applied: no evidence → no claim; no invented values; frozen baseline changes only via Controlled Change (CC); AI is never sole authority on financial/contractual/engineering/safety decisions.
Evidence grades: E1 = executed at runtime with captured log; E2 = executed static check; E3 = code reading; E4 = document claim; E5 = unverified.

## 1. Controlled Changes (CC)

| CC | Change | Evidence (before → after) | Alternatives | Reason | Impact | Rollback |
|---|---|---|---|---|---|---|
| CC-001 | Generate `backend/` and `frontend/package-lock.json` | `C1_*` logs: no lockfile, Dockerfiles call `npm ci` → builds reproducible (E1) | Pin versions by hand | Dockerfiles and `immutable-release-check` require lockfiles | Deterministic installs | Delete lockfiles |
| CC-002 | Type-only fixes (vite-env.d.ts, zod `AnyZodObject`, `masterBase.partial()`, `query<any>`) | `tsc` 25+1 errors → 0 (E1) | Loosen `strict` | Build was impossible; no runtime semantics changed | Build passes | Revert commit 550fb7d |
| CC-003 | Migrations apply from zero: base-table filter (011, 017), `min(id)` (019), deactivate placeholder DOA instead of DELETE (020), `a.user_id` (028), migrator-managed transactions (11 files), migrator role guard + `APP_DB_ROLE` grants, server refuses superuser/BYPASSRLS in production | `C2_*` FAIL at 011 → `C3`/`C4` `MIGRATIONS_OK` (E1) | New "fix-forward" migrations (impossible: 011 never completes, so later files never run) | Shipped chain could not create a database | Fresh installs work; RLS actually enforced | Revert commit 59b9ad8 |
| CC-004 | `pg` int8 parser → JS number (`pool.ts`), throws above 2^53 | Every authenticated call 401 (`'1' !== 1` in authenticate.ts) → 200 (E1) | Cast at each comparison site (many strict `!==` id comparisons) | One root cause, global fix | All authenticated APIs usable | Remove `setTypeParser` |
| CC-005 | DOA confirm: `$12::bigint` in `PATCH /approvals/configuration/doa/:id` | HTTP 500 → 200 (E1) | — | Without it no DOA row can ever be confirmed → every approval workflow blocked | Approvals possible | Revert line |
| CC-006 | Migration 035: `guard_phase2_status()` dispatch per table | Any UPDATE on tenders/contracts/variations → `record "new" has no field "stage"` → passes (E1) | Edit 012 in place (frozen baseline) | Tender submit, contract signing, variation approval were impossible | State machines work with identical rules | `CREATE OR REPLACE` with 012 body |
| CC-007a | `convert-to-tender`: `coalesce($10::numeric,$11::numeric)` | HTTP 500 → 201 (E1) | — | Untyped params inferred as text | CRM→Tender works | Revert line |
| CC-007b | `postActualCostForVendorInvoice`: `FOR UPDATE OF vi` | Invoice approval HTTP 500 → 200 (E1) | Split query | `FOR UPDATE` on outer join is illegal | Invoice→actual cost→AP works | Revert line |
| CC-007c | Migration 036: append-only cost ledger allows only `is_posted_to_gl` false→true, all other columns identical | Cost→GL rolled back every time → posts (E1) | Derive posted state from GL rows | Migration 002 itself documents this swap "when Phase 3 ships"; it never happened | Cost reaches GL; ledger still immutable otherwise | `CREATE OR REPLACE` with 002 body |
| CC-008 | GL posting accepts only `transaction_type='actual'` cost rows | Committed PO cost posted Dr Expense/Cr AP and would double-count with invoice (E1) | Encumbrance accounting with separate rule subtype | Prevents wrong books; reversible | Commitments stay in cost control only | Remove guard |
| CC-009 | Migration 037: RLS on `organizations` (own row; bootstrap mode keeps access) | App role under org 2 saw other orgs' legal name/tax id → 0 rows (E1) | Column-level grants | Only tenant-bearing table without RLS | Tenant data isolation complete at DB level | Drop policy, disable RLS |
| CC-010 | Compose: `erp_app` role via `database/docker-init/01_app_role.sh`, backend uses it, migrator grants via `APP_DB_ROLE`; new required `APP_DB_PASSWORD` | Shipped compose ran the API as superuser (RLS bypassed). `docker compose config` OK; init SQL executed on PG 16 (E2). Full compose run **UNVERIFIED** (no Docker daemon) | Separate migrator user | CC-003 guard would otherwise (correctly) stop the production backend | Production deployment enforces RLS | Revert compose + script |
| CC-011 | Check-script/tooling alignment: `redteam-rev5-check` expects the CC-003 form of 020; frontend `lint` = `tsc -p tsconfig.json` | rev5 FAIL → PASS; `tsc -b --noEmit` was invalid (TS5094) → OK (E1) | — | Checks must reflect corrected code | — | Revert lines |

## 2. Autonomous decisions (§28)

| D | Decision | Evidence | Alternatives | Reason | Impact | Rollback |
|---|---|---|---|---|---|---|
| D-001 | Execute R0 myself in this container (PG 16.14 vs compose 17) | Logs in `takeover/evidence` | Wait for owner infra | §23 requires runtime truth now | PG-17-specific behaviour UNVERIFIED | Re-run on PG 17 |
| D-002 | Fix migrations in place (CC-003) rather than append | 011 aborts → later migrations unreachable | Fix-forward | Only option that yields a working chain from zero | Checksums of 011–034 change vs v0.2; no production DB exists to conflict | Revert commit |
| D-003 | Separate migrator (BYPASSRLS/superuser) and app (no bypass) roles | `C2b`, `C2c` | Single role | FORCE RLS made 032 backfill a silent no-op; superuser app bypassed all RLS | Two credentials to manage | Single-role config |
| D-004 | Deactivate, never delete, placeholder DOA | FK from approval history | DELETE | Keeps audit lineage | None | — |
| D-005 | Use TEST FIXTURE DOA confirmations, permission grants, CoA, GL rules, amounts in E2E | `tests/e2e/chain.mjs` header | Wait for owner values | Needed to exercise code; all labelled fixture, nothing owner-facing | None outside test DB | — |
| D-006 | Forward migrations 035–037 for new fixes (not in-place) | Chain from zero passes | In-place edits | Frozen-baseline discipline where possible | — | `CREATE OR REPLACE` back |

## 3. Findings not fixed (need design or owner decision)

| F | Finding | Evidence | Who decides |
|---|---|---|---|
| F-01 | No API creates `project_boq` rows; PO/IPC/progress/variation lines reference it → estimating BOQ (`boq_master`) never hands over to execution | grep: no `insert into project_boq` anywhere (E3); PO with `boq_master` id rejected (E1) | Design (next step) |
| F-02 | No create API for vendors/subcontractors (E2E seeds one via SQL) | E1 | Design |
| F-03 | New tenant gets no roles beyond admin, no DOA, cost codes, CoA, GL rules, fiscal periods (org 2: 1 role, 0 everything) → SaaS onboarding gap | DB counts (E1) | Design + owner (default templates) |
| F-04 | No API to create DOA rows (only PATCH of seeded org-1 rows); seeded approvers Procurement/Finance Manager lack `approvals.approve` | E1 | Owner: real DOA matrix and thresholds |
| F-05 | IPC posts **net** (gross − retention) to revenue: Dr AR 95,000 / Cr Revenue 95,000 for gross 100,000 | `R0-4_e2e_chain.log` (E1) | Owner/accountant (revenue & retention treatment) |
| F-06 | `/projects` routes have no `authorize()` — any authenticated user (incl. portal user types) can create projects | code (E3) | Fix next (small) |
| F-07 | DB exceptions (tenant guards, overlaps) surface as HTTP 500 instead of 4xx | isolation log (E1) | Fix next (error mapping) |
| F-08 | Global `BOOTSTRAP_ADMIN_TOKEN` can create unlimited tenants and claim any org with no active users | E1 (org 3 created) | Owner: tenant provisioning model |
| F-09 | All 25 shipped static "check" scripts passed on v0.2 while ≥7 runtime-blocking defects existed → static checks are not evidence of function | `R0-6` log vs CC-004..009 (E1) | — (process rule) |
| F-10 | Document drift: 00_START_HERE cites MARKET_DOMINANCE_… (file is MARKET_ADVANTAGE_…); STEP_02 "frozen" file says "candidate"; "Schema/code consistency PASS" claim falsified | E3/E1 | Owner (doc control) |
| F-11 | 3 Drive archives > 10 MB unreadable through current connector | E1 | Owner: split files or allow `drive.usercontent.google.com` |
