# R13: Golden Case decomposition (GC-01 … GC-38)

## Inputs
- **Source:** STEP_01 v1.3 §52 and §57, which define the 38 Golden Cases as the parent acceptance journeys.
- **Generator:** `governance/tools/gc_decomposition.py` produces `GOLDEN_CASE_DECOMPOSITION.csv`.
- **Size:** 167 steps across the 38 cases.
- **What each step records:**
  - activity, actor role, inputs and outputs;
  - rule, decision or calculation;
  - control, citing a frozen STEP15 SoD rule id or DOA class;
  - AI autonomy level (L0–L5);
  - code status with evidence;
  - linked NDC, DFS, G or DEC ids;
  - a test id `T-GC-xx-nn`.
- **Code status method:**
  - RUNTIME means the step is exercised by the R0 chain or the isolation suite.
  - The other statuses are taken from the actual route and table inventory: 36 modules, about 267 route handlers and 131 tables.

## Result (v0.2 + CC-001…014)
| Status | Steps | Meaning |
|---|---|---|
| RUNTIME | 21 | proven end-to-end (E1) |
| API | 29 | route and table exist, never executed: assume R0-level defect density (RK-003) |
| PARTIAL | 45 | some of the step exists; the rules or links are missing |
| SCHEMA | 3 | table only |
| ABSENT | 69 | nothing exists |

- **Most complete:** GC-06 Procurement (8 of 11 RUNTIME) and GC-13 Client IPC (4 of 8 RUNTIME). These are the R0 chain.
- **Entirely absent:** GC-22 process builder, GC-24 legacy import, GC-26 risk, GC-27 offline, GC-30 jurisdiction pack, GC-32 to GC-35 (security incident, release, DR, privacy) and GC-38.

## Cross-cutting blockers (by how many Golden Cases they block)
1. **Execution BOQ handover (G-001).** Blocks GC-02, GC-12/13 (BOQ-linked valuation), GC-14 (EV per item), GC-15 (variation lines) and GC-17.
2. **Rights preservation: Contract Data Pack, notice/time-bar engine and accepted programme (NDC-001/002/010).** Blocks GC-02, GC-15, GC-16 and GC-11.
3. **Tenant provisioning and vendor master (G-003/G-006, G-002).** Without them no second customer can run GC-06 without SQL seeding, and GC-31 cannot run at all.
4. **Cost data dictionary: accruals, ETC/EAC reproducibility and reconciliation (NDC-011).** Blocks GC-14, GC-25 and GC-10.
5. **Revenue structure (STEP09 invariant, DEC-009).** IPC certification must create a receivable or contract balance, never revenue directly. The policy content stays an owner decision.
6. **Immutable snapshots and sign-off** for daily reports and period reports (GC-07, GC-10, GC-18).
7. **Risk register entity** (frozen F32, never built). Needed for GC-01, GC-26 and GC-02.

## New findings from decomposition
- **G-013:** there is no per-session token revocation and no signing-key rotation. Deactivating a user does take effect on the next request, because `authenticate.ts` reloads the user on every call.
- **Accruals:** `cost_transactions` has only committed and actual types, so there are no accruals and GRNI is not posted. This is linked to NDC-011.
- **Plant vs installed assets:** `assets_equipment` models contractor plant, not installed or handed-over assets. GC-28 and GC-20 need an installed-asset entity (frozen F65/F81).

## Build order derived from the decomposition (feeds the implementation program, task #6)
- **Wave 1: make the commercial core sellable to a second tenant**
  - G-001: project_boq handover API and reconciliation;
  - G-002: vendor/subcontractor master API with integrity fields;
  - G-003/G-006: tenant provisioning service with templates (no invented values, structure only), retiring the global bootstrap for SaaS;
  - G-004: DOA management API (create, version, confirm), keeping the SoD invariants;
  - runtime tests for GC-12 (subcontract IPC), which is all API-level today.
- **Wave 2: rights preservation**
  - NDC-001 Contract Data Pack and notice/time-bar engine;
  - NDC-002 notice / change / claim separation;
  - NDC-010 accepted programme;
  - NDC-014 structured daily record with impact flag and sign-off.
- **Wave 3: cost truth**
  - NDC-011 accruals, ETC/EAC reproducibility and period reconciliation;
  - budget routes;
  - period lock tests (G-010);
  - the revenue structural fix (DEC-009, structure only).
- **Wave 4: quality, HSE and handover gates** (NDC-004/005/015/016), commissioning and installed assets.
- **Wave 5: platform journeys:** GC-22, GC-24, GC-27 and GC-31 to GC-36.

Each step is accepted only when its test `T-GC-xx-nn` executes in CI (F-09 rule).
