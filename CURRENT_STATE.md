# CURRENT STATE — MISHEL Construction Intelligence Platform (Investigation R01–R14 + Build Waves 1–2 + RK-003 sweep + stages 1–7: CC-015…CC-036)

| Item | Value |
|---|---|
| Git repository | `krvng5c6t9-rgb/-MISHEL-CONSTRUCTION-INTELLIGENCE-PLATFORM` |
| Git branch | `claude/read-file-dsz1qx` |
| Git commit | Exact snapshot commit SHA is in `SNAPSHOT_COMMIT.txt` inside the archive (this file cannot contain the SHA of the commit that adds it). R0 suites were last executed on that exact code (see archive verification below) |
| Snapshot date | 2026-10-05 (UTC) |
| Node / npm tested | v22.22.0 / 10.9.4 |
| PostgreSQL tested | 16.14 locally; 16.15 and 17.11 in CI on every push (runtime-gate). First PG17 verification: CI run 37272015775, commit 60db79c. CI green through the v0.5.0-sweep handoff commit 8feec80 (run 37285108612; earlier: CC-018 run 37278655900 fixed the red CC-017 run 37278199131) |
| Migrations | 74 (`database/migrations/001…074`), all applied from an empty DB |
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

## Controlled Changes CC-001 → CC-055
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
| CC-015 | G-001 estimating→execution BOQ handover (migration 038) with reconciliation, SoD acceptance, freeze triggers |
| CC-016 | G-002 governed vendor master (039); DB-enforced vendor eligibility on RFQ/quotation/PO/subcontract; bank-change SoD |
| CC-017 | G-004 DOA lifecycle (040): drafts, independent confirmation, immutability, supersession, retirement; Admin UI |
| CC-018 | F-08/G-006 bootstrap takeover closed; first-run-only bootstrap by default (041); tenant readiness checklist |
| CC-019 | G-014 cost-code management API (042) |
| CC-020 | GC-12 subcontract certificate integrity (043): 5 runtime defects fixed |
| CC-021 | NDC-001 notice/time-bar engine (044); F-13 DATE timezone fix; gate runs API in Africa/Cairo |
| CC-022 | G-010 hostile concurrency suite; F-14 fiscal-period API fixed; posting needs a defined open period; reopen SoD (045) |
| CC-023 | NDC-014 signed immutable daily records + amendments; NDC-002 event-link hub and early-warning register (046) |
| CC-024 | NDC-010 programme submissions with sealed snapshots; CPM verified by hand; F-15 logic loops refused (047) |
| CC-025 | GC-15 variation lifecycle and client agreement path applied to execution BOQ (048) |
| CC-026 | GC-08/09 QA/HSE integrity (049) |
| CC-027 | Approval rejection/return releases business records; reason mandatory; PO/MR resubmission guarded (050) |
| CC-028 | GC-37 HR/payroll: payroll submission crash fixed; payroll/timesheet/leave integrity (051) |
| CC-029 | GC-03 EDMS: revision-level review, immutable versions, for-construction issue gated on approval (052) |
| CC-030 | GC-16 claims: lifecycle crash (42P08) fixed; event/notice linkage, determination ≤ claim with SoD and reasons, decided claims immutable; time-bar position shown (053) |
| CC-031 | Technical office: RFI creation and drawing review crashes fixed; review comments/history, one current approved revision, RFI impact → contract-event linkage (054) |
| CC-032 | Plant & equipment: usage submission crash fixed; mobilisation, machine-hour, operator and maintenance rules (055) |
| CC-033 | Inventory: transfer crash fixed; paired legs, controlled adjustments, carried cost (provisional, DEC-014) (056) |
| CC-034 | NDC-002: compensation-event register, FIDIC dispute ladder, claim gating on notices (057) |
| CC-035 | NDC-011: budgets, derived accrual, reproducible EAC snapshots, reconciliation, per-project cost summary (058) |
| CC-036 | G-015 shared-guard audit + runtime probe in gate; G-016 security_invoker on all views (059) |
| CC-037 | G-013 session revocation: token epoch + revoked jti (060), logout / logout-all / change-password / admin revoke, key-rotation verify |
| CC-038 | NDC-029 signed terms frozen; Time for Completion revisions from decided claims/CEs/variations; confirmed LD terms; time/LD position (061) |
| CC-039 | NDC-030 two-step transfers / in-transit / shortage acceptance, stock counts with SoD approval, issue cost codes (062) |
| CC-040 | G-017 login lockout / address limit / constant-time unknown accounts / admin unlock / login events (063) |
| CC-041 | GC-26 risk & opportunity register: history, responses, escalation, SoD closing, EV summary (064) |
| CC-042 | Golden Case status reconciliation; gc_status_check.py in the gate (at CC-042: RUNTIME 56 / PARTIAL 54 / ABSENT 51; after CC-043: RUNTIME 59 / ABSENT 48) |
| CC-043 | GC-10 frozen/reconciled/approved report packs; weekly-executive per-project approvals + null SPI/CPI (065) |
| CC-044 | GC-20 commissioning: staged verified test packs, punch categories, dossier, evidence-gated taking-over + DLP (066) |
| CC-045 | GC-04 design-revision impact: links, auto-opened impacts, dispositions, entitlement closing (067) |
| CC-046 | IPC requires signed contract (defect); GC-02 mobilisation gate; chain signs + hands over BOQ (068) |
| CC-047 | Project Controls UI screen + browser check (Playwright, 11/11, manual); layout overflow fix |
| CC-048 | Bundled font (F-28); unloaded sections named (F-30); browser decision flows by two people with SoD, in CI (F-29) |
| CC-049 | GC-12 subcontract advances/recovery, back-charges, less-previous cap; negative-net check defect fixed (069) |
| CC-050 | GC-13 client advances/recovery, retention cap, less-previous cap on IPCs; CC-049 cap correction (070) |
| CC-051 | GC-13 client certification evidence with SoD, dispute/resubmission, AR at certified amount (071) |
| CC-052 | Payments & Certification screen + browser check in CI (F-38) |
| CC-053 | Contract payment terms → receivable due date; client certified breakdown (072) |
| CC-054 | Receipts/payments settle within outstanding, partial/paid status, aging; payment terms & breakdown UI (073) |
| CC-055 | Tax engine (DEC-016/017): confirmed versioned tax codes, profiles, output tax into AR/GL, e-invoice ref, client withholding (074) |
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


## Runtime suites (from zero: `tests/e2e/run_from_zero.sh`; API under TZ=Africa/Cairo)
| Suite | Checks | Scope |
|---|---|---|
| chain.mjs | 92 | Lead→Tender→Project→BOQ→MR→RFQ→PO→GRN→Invoice→Cost→GL→Contract→IPC→AR/GL→Payment→GL; vendor via API; DOA confirmed by 2nd user |
| isolation.mjs | 36 | cross-tenant reads/lists/writes, authorization, error hygiene, DB-level probes |
| wave1_boq_handover.mjs | 41 | G-001 |
| wave1_vendor_master.mjs | 41 | G-002 |
| wave1_doa_governance.mjs | 26 | G-004 |
| wave1_tenant_onboarding.mjs | 20 | F-08/G-003/G-006/G-014 |
| wave1_subcontract_ipc.mjs | 24 | GC-12 |
| wave2_notice_engine.mjs | 36 | NDC-001, F-13 |
| hostile_concurrency.mjs | 17 | G-010 races, period lock/reopen, token after deactivation |
| wave2_daily_record_changes.mjs | 29 | NDC-014, NDC-002 |
| wave2_programme.mjs | 25 | NDC-010, CPM |
| sweep_variations.mjs | 21 | GC-15 |
| sweep_quality_hse.mjs | 20 | GC-08/09 |
| sweep_approval_rejection.mjs | 29 | approval reject/return across modules |
| sweep_hr_payroll.mjs | 43 | GC-37 |
| sweep_edms.mjs | 24 | GC-03 |
| sweep_claims.mjs | 26 | GC-16 |
| sweep_technical_office.mjs | 30 | GC-03..05 |
| sweep_assets.mjs | 27 | plant & equipment |
| sweep_inventory.mjs | 23 | inventory movements |
| sweep_ndc002.mjs | 29 | NDC-002 CE / dispute / gating |
| sweep_cost_eac.mjs | 19 | NDC-011 budgets / accrual / EAC |
| sweep_view_isolation.mjs | 10 | G-016 DB-level view isolation |
| sweep_sessions.mjs | 20 | G-013 logout / logout-all / password change / admin revoke / reactivation |
| sweep_time_for_completion.mjs | 30 | NDC-029 revisions, frozen terms, LD terms, exposure |
| sweep_inventory_controls.mjs | 37 | NDC-030 transfers in transit, receipts, shortages, stock counts |
| sweep_login_throttling.mjs | 20 | G-017 lockout, address limit, unlock, login events |
| sweep_risks.mjs | 37 | GC-26 / GC-01 s8 risk & opportunity register |
| sweep_report_packs.mjs | 29 | GC-10 report packs, reconciliation, approval |
| sweep_commissioning.mjs | 37 | GC-20 commissioning-to-handover |
| sweep_design_impact.mjs | 28 | GC-04 design-revision impact |
| sweep_mobilisation.mjs | 28 | GC-02 s9 mobilisation readiness gate |
| sweep_subcontract_deductions.mjs | 36 | GC-12 s4-5 advances, back-charges, less previous, negative net, race |
| sweep_client_ipc_deductions.mjs | 23 | GC-13 s3 client advances, retention cap, less previous, race |
| sweep_ipc_client_certification.mjs | 22 | GC-13 s5-6 client certification, dispute, AR = certified |
| sweep_ipc_terms_breakdown.mjs | 21 | GC-13 s5-8 payment terms due date, client breakdown |
| sweep_collections.mjs | 17 | GC-13 s8 receipts, partial/paid, race, aging, AP mirror |
| sweep_tax.mjs | 33 | DEC-016/017 tax codes, profiles, output tax, e-invoice, withholding, position |
| probe_shared_guards.py | 119 tables | G-015 shared-trigger runtime probe (gate step) |
| gc_status_check.py | 167 steps | F-25 Golden Case statuses agree with gate suites (gate step) |
| project_controls.ui.mjs | 23 | Browser: Project Controls browsing + decision flows by two people (UI_CHECK=1, in CI) |
| payments.ui.mjs | 16 | Browser: Payments & Certification (certification SoD, advance positions, back-charge SoD) |
| **Total** | **1,147** | 38 API suites + 2 browser checks, all PASS locally (RUN tx3; earlier "700" was a records error, F-19) |

## Investigation status (R01–R14: `governance/reconciliation/`, `governance/decomposition/`, `governance/market/`)
- R01: the 4,602 STEP17 requirements are a platform-contract scaffold (67% structural, 20% fields, 13% governance; 0 for take-off/EVM/CPM/RFI/cash flow/delay analysis).
- R02: activation-pack operating model = valuable skeleton (159 positions, ~70 disciplines, DOA/control/KPI models); job descriptions/SOP bodies templated.
- R03: v5 "TRUE FINAL" evidence is 100% name-mapping; 787 vs 833 and 531 vs 1,660 resolved.
- R04: STEP_01 DNA + 38 Golden Cases adopted as acceptance backbone; Golden Cases 0 refs in 4,602; ≤12% of STEP03-16 tables cited by STEP17.
- R05: D01–D20 vs schema (manual, 329 entities): R 27 / S 47 / T 85 / A 170; 193 scenarios, 596 test IDs pending.
- R06: STEP18 = ~1.7k-line generic Python prototype (its own committee: NOT FIT FOR FREEZE); 170 agent archetypes extracted.
- R07: STEP03/04/05 adopted (12-dimension DOA, 32 handoffs, 30 value streams, architecture principles, derived stores).
- R08: original scope requires ONE application (ERP + expert/knowledge command layer), not parallel tracks.
- R09: research-board synthesis → NDC-001…009; Egypt-first jurisdiction layering; never-invent activation inputs.
- R10–R12: research board reviews 02–08 (NDC-010…027); lineage prerun ⊂ v0.1 ⊂ v0.2 (no dropped scope); STEP18 non-claims; 276-aggregate catalog; STEP09/08 truth constitutions adopted; CCR18 shows frozen domain specs were never authored; SoD-60 / DOA-30 datasets.
- R13: Golden Case decomposition 38 cases / 167 steps (`governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv`).
- R14: cited competitor/market evidence; NDC-028 Egypt ETA e-invoicing.
- Source coverage (unique files): READ_FULL 26 · PARSED_FULL 38 · SAMPLED 9 · INVENTORIED 513 · READ_RUNTIME 180 · CONTAINER 15 · UNREAD 487; plus 3 Drive archives > 10 MB UNREAD (owner action G-012).

## Open gaps / risks / owner decisions (see `governance/registers/07,09,12`)
- Open gaps: G-003 commercial provisioning (DEC-010 decided; owner plan/pricing inputs) · G-004 owner DOA matrix (API done) · G-005 IPC/retention posting (DEC-009 OPEN) · G-006 (partially closed) · G-008 dropped frozen scope · G-009 D-pack coverage · G-010 hostile concurrency tests · G-011 STEP02 atlas · G-012 unread archives (owner action) · G-013 token revocation.
- Closed: G-001 (CC-015), G-002 (CC-016), G-007 Golden Cases decomposed (R13), G-014 (CC-019); F-06/F-07 (CC-013), F-08 takeover (CC-018), F-13 (CC-021), F-14 (CC-022), F-15 (CC-024); G-010 hostile concurrency executed (CC-022).
- Owner decisions DECIDED 2026-10-09: DEC-009 (gross + retention receivable, IPC = billing, revenue over time cost-to-cost), DEC-012 (cumulative valuation, cost at gross, retention payable, advances as prepayment), DEC-013 (labour cost at gross pay), DEC-014 (weighted average per store), DEC-015 (5/15/15 lockout, address limit per deployment, MFA for admin/finance/DOA approvers) — implementation pending (Stages 26-31); provisional behaviour remains until each stage lands. DEC-016..019 decided professionally (tax engine implemented CC-055; cut-over methodology for GC-24). Remaining owner inputs are company data only: OI-1 tax codes/rates entered by the company's tax advisor, OI-2 e-invoice credentials, OI-3 optional IFRS need, OI-4 go-live date.
- Risks: RK-001 unread archives may change scope · RK-002 templated sources mistaken for specification · RK-003 similar defect density in untested modules — **confirmed** by GC-12 (5 defects at first execution).

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
APP_DB_ROLE=erp_app MIGRATIONS_DIR=../database/migrations node dist/db/migrate.js   # expect MIGRATIONS_OK 44

# 4. Run API as the app role
DATABASE_URL=postgresql://erp_app:<APP_PW>@localhost:5432/construction_erp \
JWT_SECRET=<32+ chars> BOOTSTRAP_ADMIN_TOKEN=<32+ chars> PORT=4000 node dist/server.js
# Bootstrap creates only the first tenant unless ALLOW_MULTI_TENANT_BOOTSTRAP=true (test/dev only)

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

**UNVERIFIED:** docker-compose runtime; frontend behaviour in a browser; every module outside the 20 runtime suites (portals, dashboards/reports, AI platform, automation, knowledge, CRM beyond the chain); HR/payroll, QA/QC, HSE, EDMS, planning/CPM, site diary, variations, claims, technical office, plant and inventory movements are now runtime-tested for their core paths only; performance/load; backup/restore/DR; penetration testing; production readiness of any kind. All DOA thresholds, CoA codes, GL rules and amounts used in tests are **TEST FIXTURES**, not owner-approved values.

No secrets are included: credentials appear only as `<placeholders>` and as test-only fixture passwords inside `tests/e2e`.
