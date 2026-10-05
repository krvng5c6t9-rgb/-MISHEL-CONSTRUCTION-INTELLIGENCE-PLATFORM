# R11: Product code lineage, STEP18 v0.29 evidence, and correction of R10 absence checks

## 1. Code lineage (full-tree diff, E2)
The three packages form a strict additive chain:

`construction_erp_CLAUDE_READY_HOSTILE_REVIEW_PRERUN` ⊂ `MISHEL_COMMERCIAL_PRODUCT_V0_1` ⊂ `MISHEL_COMMERCIAL_PRODUCT_V0_2`

- **Prerun → v0.1** adds the AI platform: migration 033, the `aiPlatform` module and its page, the route, 3 auth module names and CSS.
- **v0.1 → v0.2** adds migration 034, the `commercialPlatform`, `automation` and `knowledge` modules, their pages, and the manifest.
- **Nothing was removed** at either step. No scope was dropped between versions, so v0.2 (the imported baseline) contains everything.
- **Root evidence documents** are byte-identical across the versions. They remain untrusted (F-09).
- **Register status:** these files are marked PARSED_FULL (lineage diff).

## 2. STEP18 v0.29: what the frozen "implementation" actually is (E3 from its own evidence)
- **Coverage:** the runtime covers 81 of the 276 STEP06 aggregates (v0.20). Only `create_draft / edit_draft / approve` are enabled; submit, review, certify, pay, post and reconcile are fail-closed.
- **Explicit non-claims in its own hostile reviews:**
  - CPM, float and critical path;
  - data-date update and earned value;
  - schedule quality checks, delay analysis and forensic scheduling;
  - QTO geometry, BOQ roll-up, rate analysis and productivity norms;
  - tender scoring and adjudication;
  - contract obligation automation, **notice deadlines**, EOT entitlement and causation, and claim quantum;
  - subcontract payment logic.
- **The construction domain engines were never built anywhere.** These non-claims are exactly the engines that NDC-001/006/010/011/012 and DFS-002 require. This confirms R01 and R06.
- **Defect in the frozen accounting design (V10-BLK-001):** the frozen field schemas for JournalEntry, ChartOfAccounts and BankAccount have no debit/credit lines or balancing invariant. The v0.2 code is ahead of the frozen schema here: it has balanced GL batches, enforced by a deferred trigger and verified in the R0 chain. **Design rule:** when the frozen schema is weaker than a proven accounting invariant, the invariant wins. This is recorded as a Controlled Change candidate for the target design.
- **Governance adopted** (consistent with the constitution and DEC-00x), from DDR-001/002 and the DOA policy:
  - no invented thresholds;
  - absent clearance means DENY;
  - absence of a numeric limit never means unlimited.
- **The 276-aggregate catalog** (86 families F01–F86) is exported to `STEP06_AGGREGATE_CATALOG_276.csv`. It is the **entity universe** for the target design and must be read together with the 398-table inventory (R04).

## 3. Correction to R10 / R09 absence evidence
- **The error:** the R09/R10 absence checks used keyword grep. They missed frozen **entity-level** coverage in the STEP06 aggregate catalog. Examples: F17 Notice and ContractObligation, F60 LaboratoryTest, F70 ConflictOfInterestCase, F71 ReconciliationRun, F46 StandardApplicabilityProfile.
- **The correction:** 20 NDC rows are reclassified to `EXTENDS_FROZEN_SCOPE`. Each row's evidence field names the overlapping aggregate.
- **What is new in those rows:** the frozen design has the entity but only a generic field schema and no behaviour, as STEP18's non-claims show. The new part is the behaviour and rules.
- **Capabilities that remain NEWLY_DISCOVERED** (no frozen entity):
  - NDC-007 grievance mechanism;
  - NDC-013 subcontract flow-down;
  - NDC-017 SoD conflict report;
  - NDC-021 fair recruitment;
  - NDC-022 performance and appeal;
  - NDC-025 maturity assessment;
  - NDC-026 lessons-learned loop.
- **Process rule from now on:** every absence check covers four corpora:
  - keyword grep over frozen STEP03–17;
  - the D-pack;
  - the 276-aggregate catalog;
  - migrations.

## 4. What was not read
The rest of STEP18 v0.29 (Python app, tests, historical evidence, superseded v0.9–v0.28) stays UNREAD and is deprioritised. The reasons:
- it is a superseded generic prototype that its own committee judged NOT FIT (R06);
- its contracts and non-claims are now extracted;
- the remaining files are code and test evidence for that prototype.

It will be read only if the target design reuses a specific contract, such as the offline reconnect semantics, tenant lifecycle 9 or the quota/usage meter contracts.
