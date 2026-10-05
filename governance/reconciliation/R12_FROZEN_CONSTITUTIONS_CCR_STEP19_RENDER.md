# R12: Frozen truth constitutions, STEP18 controlled-change pack, STEP19/20 evidence, Render/Supabase bundle

## 1. STEP09 v1.1 commercial/financial truth constitution (READ_FULL, frozen): adopted as design invariants
These invariants become acceptance rules for the target design. Every relevant Golden Case test must assert them.
- **Distinct states (each `!=` the next):**
  - operational event ≠ commercial entitlement ≠ accounting recognition ≠ cash settlement;
  - physical progress ≠ measured quantity ≠ certified quantity ≠ revenue ≠ invoice ≠ receivable ≠ cash;
  - commitment ≠ accrual ≠ invoice ≠ payable ≠ payment;
  - variation instruction ≠ entitlement ≠ agreed valuation ≠ accounting treatment;
  - claim submission ≠ recognised consideration;
  - budget ≠ commitment ≠ actual ≠ forecast;
  - project margin ≠ statutory profit;
  - payment proposal ≠ approved ≠ bank instruction ≠ settlement.
- **Distinct dates:** service, measurement, certification, invoice, tax-point, posting, due, bank-instruction and settlement dates are separate. They are never collapsed into one "transaction date".
- **No in-place edits:** POSTED, CERTIFIED and ISSUED records are corrected only by reversal or supersession, with lineage.
- **External outcomes:** an unknown outcome from a bank or tax authority never triggers a blind retry and is never treated as acceptance.
- **Revenue:** IFRS 15 is an optional accounting-policy profile, separate from IPC certification. Accounting policy precedence is: platform invariants > law > adopted framework > entity policy > group > contract > user.
- **AI limits:** AI is never sole authority for certification, revenue recognition, posting, payment release, bank-master change, tax filing or write-off.

**Bearing on F-05 / DEC-009 (still OPEN, owner/accountant):** the v0.2 code posts an approved IPC straight to revenue (net of retention). That contradicts the frozen STEP09 separation of certification from revenue recognition. The *structural* correction does not require choosing an accounting policy, so it is a design obligation:
- IPC certification raises a receivable or contract balance;
- revenue comes from a recognition policy engine.

The *policy content* is still the owner's decision: the revenue method, retention classification and the IFRS vs local framework.

## 2. STEP08 v1.2 engineering constitution (SAMPLED)
Engineering truths are separate. A software result is not engineering validity, and verification, validation and UQ are each distinct. The latest standard is not necessarily the applicable one. Completing a workflow is not safety acceptance, and AI confidence is not professional approval. These rules are adopted for the engineering/expert layer (DFS-006).

## 3. STEP18 controlled-change pack (CCR18-001…005): the decisive finding
- **Contents:** templates for every governed area. Every value is marked `OWNER_INPUT_REQUIRED`, `DOMAIN_AUTHORITY_INPUT_REQUIRED` or `CONTROL_OWNER_REVIEW_REQUIRED`:
  - 30 DOA rule classes (5 authority levels × 6 decision classes);
  - 306 event payload schemas;
  - 276 aggregate field contracts;
  - 276 lifecycle matrices;
  - 60 SoD rules;
  - 1,277 command→SoD bindings.
- **Verdict:** the committee's own verdict is "CONTROLLED CHANGE REQUIRED — BLOCKING".
- **Conclusion:** **the frozen design never specified domain fields, transitions or guards for its 276 entities.** That domain specification is exactly the work of task #4 (Golden Case decomposition) and the target design. It must be authored from first principles and domain evidence, and the R0 code's proven schema is a better starting point than the frozen generic templates.
- **Datasets extracted** to `governance/reconciliation/`:
  - `STEP15_SOD_RULES_60.csv`: 30 activity pairs × 2 scopes (50 HARD_DENY, 10 DENY_UNLESS_PREAPPROVED_COMPENSATING_CONTROL). This is the governing SoD baseline for the build. It covers P2P, finance, payroll, IAM, release, design, inspection, NCR and material custody.
  - `STEP15_DOA_RULE_CLASSES_30.csv`: the structure for DOA configuration. Amounts are owner input, consistent with F-04 and DEC-00x.
- **Register correction:** NDC-017 is reclassified to EXTENDS_FROZEN_SCOPE. The new part is the conflict report and the waiver workflow.

## 4. STEP19 local verification and the Render/Supabase bundle (claims, E4; not re-executed by me)
- **STEP19:** 155/155 pytest passed; 169 of 276 aggregates have some runtime mapping; a 1,000-request TestClient smoke ran. The STEP19 decision itself is "CONDITIONALLY FIT — OPEN ITEMS REMAIN". It did not cover production IAM/RLS/KMS, connectors, HA/DR, pen-testing or statutory validation.
- **Supabase project (claimed live):** the bundle states that a Supabase project named `mishel_core` was activated on PostgreSQL 17 (2026-10-01). The `mishel_core` schema has 7 generic tables (tenants, memberships, scopes, aggregate_records/versions as JSON, outbox, audit), RLS and immutability triggers, plus a recovery rehearsal. The FastAPI app was **never connected** to it, because the server-side secret was unavailable.
- **Disposition:**
  - The generic JSON aggregate store is **not adopted** as the product data model. It cannot carry the relational invariants proven in R0: balanced GL, FK integrity and RLS per table.
  - Any use of that Supabase project for this product would be a **production deployment decision, so it is Owner-only.** No action was taken against it.
  - The patterns that remain useful are the restrictive deny policy on the outbox, immutable version/audit triggers and the recovery checksum rehearsal. They are adopted as design patterns.

## 5. Register hygiene
- **Error found during this step:** `mark_read.py` had overwritten statuses outside the intended scope.
  - The R11 v0.1 marking downgraded 164 READ_RUNTIME rows.
  - An R12 regex overreached into 154 INVENTORIED gate and manifest CSVs.
- **Fix:** both were restored from git history (commit 0efcc6d). The tool now never downgrades: a row changes only if the new status ranks equal or higher.

## 6. Coverage after R12 (unique files)
| Status | Files |
|---|---|
| READ_RUNTIME | 180 |
| READ_FULL | 44 |
| PARSED_FULL | 114 |
| SAMPLED | 69 |
| INVENTORIED | 513 |
| CONTAINER | 15 |
| UNREAD | 333 |

**What remains UNREAD:**
- STEP18 prototype code, tests and historical evidence (deprioritised; reasons in R11 §4);
- the STEP20 release zip;
- the STEP18 frozen payload zip (same content as v0.29, which was reviewed);
- the 3 Drive archives over 10 MB (G-012, owner action).
