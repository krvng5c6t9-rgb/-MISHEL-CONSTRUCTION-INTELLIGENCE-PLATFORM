# R04 — Frozen baseline STEP01–STEP17 (owner-approved 2026-10-01)

## Sources
| Source | How it was read |
|---|---|
| STEP_01 v1.3 Product DNA (1,486 lines) | Read in full |
| STEP_02 v2.1 | Read in full |
| `00_MASTER_STATUS_FROZEN.md`, `01_BASELINE_INDEX.csv` | Read in full |
| STEP07 `33_GOLDEN_CASE_STAGE07_TRACEABILITY_38.csv`, `04_ENGINE_CATALOG_43.csv` (first 19 rows) | Read |
| STEP09 `03_ENGINE_CATALOG_202.csv` | Read in full |
| All 529 tables of STEP03–17 | Inventoried by script (rows, columns, distinct-ratio) → `FROZEN_STEP03_17_TABLE_INVENTORY.csv`. Content not yet reviewed table by table (register status `INVENTORIED`). |

## F-R04-1: STEP_01 is the strongest product definition in the corpus and matches the Owner Constitution
Adopted as the acceptance backbone:
- 38 Golden Cases (GC-01…GC-38): tender-to-award, award-to-project, drawing review, design-revision impact, BOQ/QTO, procurement package, site daily control, QA/QC, HSE, monthly report, delay and recovery, sub/client IPC, cost forecast, variation, claim/EOT, material lifecycle, executive review, resources, commissioning/handover, ask-the-business, process builder, agent builder, migration, month-end, risk, offline, asset trace, Mishel DNA, jurisdiction, tenant onboarding, security incident, release/rollback, DR, privacy, connector lifecycle, recruit-to-exit, EA transformation.
- Autonomy classes L0–L5, assigned **per action**.
- Five configuration layers: Core / Industry-Jurisdiction / Company OS / Mishel DNA / Project overrides, with explicit precedence.
- Success criteria SC-01…SC-19; Product Assurance PA-01…PA-08.
- Mandatory conceptual layers (§34): 19 layers.

## F-R04-2: The Golden Cases never reached requirements
- GC references in the 4,602 requirements: **0**.
- Only STEP07 traces them, and it maps 28 of the 38 Golden Cases to the **same 12 generic engines**, with result "STEP07 DESIGN COVERAGE" for all 38.
- No Golden Case is decomposed into steps, data, rules, roles or tests anywhere in the corpus.

## F-R04-3: STEP17 carried only a small part of the frozen design into requirements
- STEP03–16 contain 398 content tables (29,721 rows). Only 43 tables are cited as `source_artifact` by the 4,602. 355 tables (≈26,039 rows) are not cited (`STEP03_16_TO_STEP17_CARRY_THROUGH.csv`).
- **Caveat:** some uncited tables are companions or earlier versions of cited ones (e.g. STEP15 `10_SEGREGATION_OF_DUTIES_CONFLICTS_60` vs cited `10A_SOD_ENFORCEMENT_CLASSIFICATION_60`; STEP06 `…_UNCHANGED_276` vs the cited aggregate catalog). The 88% is therefore an **upper bound** until table-by-table review.
- Substantive tables that are clearly uncited include:

| STEP | Uncited tables |
|---|---|
| STEP09 | 202-engine commercial/finance catalog (retention, advance recovery, LDs, escalation, re-measurement, final account, IFRS-15 revenue structure, treasury, tax, guarantees, fraud/integrity, consolidation, real-estate development, plant/payroll costing); revenue-recognition (48), treasury (39), tax (36) contracts; 70 business-financial principles; commercial/accounting/cash truth ladder |
| STEP08 | Engineering principles (65); design basis & criteria (33); existing-asset durability (40); reliability/process safety (40) |
| STEP10 | AI constitution (92); orchestrator components (111); model routing (50); memory (48); autonomy matrix (16); evaluation framework (101); agentic threats (133) |
| STEP11 | Knowledge constitution (107); source-class catalog (105); applicability/precedence (52); RAG evaluation (113) |
| STEP12 | Output/CDE principles (110); signature/seal (42); Arabic RTL/BiDi fidelity (36); evidentiary export (44); copy control; redaction gate |
| STEP13 | All UX contracts: role workspaces (18), screen archetypes (40), design tokens, mobile field mode, offline UX, approval UX, AI-assistant UX boundary |
| STEP14 | Integration constitution (60); connector registry; idempotency/replay (36); webhook; CDC; external-authority integration; reconciliation control totals |
| STEP15 | Role catalog (36); DOA policy binding (30); PAM/JIT; secrets; break-glass; threat model (80); incident response |
| STEP16 | **Tenant lifecycle (9), tenant object (42 fields), tenant provisioning contract (30), subscription, seat/licence, usage metering, price book, billing, SSO/SCIM, data residency, tenant migration/export/delete (36)** |
| STEP06 | 843 aggregate lifecycle transitions and 843 business transition guards |

## F-R04-4: STEP09 engine catalog is professional-grade content (adopt as input)
202 engines in 13 packs: Commercial & Contract, QS/Certification/Revenue, Cost Control, Procurement Commercial, Accounting Core, Treasury/FX, Tax, Corporate/Group/EPM, Insurance/Securities, Fraud/Integrity, BD/Tender, Real Estate, Payroll/Plant/Inventory cost. It directly covers several owner open decisions:
- **IPC / retention.** BF09-010 Retention, BF09-023/024 IPC application/certification, BF09-026 certified revenue basis, BF09-027/028 contract asset/liability, BF09-033/034 measure of progress / revenue recognition, BF09-037 retention receivable.
  - The design therefore separates certification (commercial) from revenue recognition (accounting).
  - This confirms that the v0.2 posting "Dr AR / Cr Revenue = net IPC" collapses three distinct engines. It remains an open accounting decision; the structure needed is now known (F-05).
- **Tenant provisioning.** STEP16 contracts provide the target data model for the owner's SaaS-provisioning decision (F-08).

## Consequence
- The product scope for build is **not** the 4,602.
- The authoritative inputs are, in order:
  1. Owner Constitution (2026-10-05).
  2. STEP_01 DNA + 38 Golden Cases.
  3. The STEP03–16 content tables, including the uncited ones, to be reviewed table by table during design.
  4. The 4,602 as the platform contract layer.
  5. The operating model (R02) and the v1 domain inventory (R03).
  6. First-principles discovery.
- Next discovery step: decompose each Golden Case to process → activity → decision → I/O → rule/calc → role → control → agent → test, and bind every step to the relevant STEP03–16 tables.
