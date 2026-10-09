# HANDOFF — v0.5.25-stage25 — DATE: 2026-10-09

## Where we are (3 lines)
- Investigation R01–R14 is done; the 38 Golden Cases are decomposed into 167 steps (R13).
- Waves 1–2 are built and runtime-tested (CC-015…CC-024). The RK-003 module sweep has executed variations, QA/HSE, approval rejection paths, HR/payroll and EDMS for the first time (CC-025…CC-029).
- Every change is gated in CI on PG 16/17 with the API running in Africa/Cairo. CI green through CC-036 (run 37816911306); CC-037…045 green; CC-046…049 and CC-051/F-39 green; CC-050 red on PG16 (F-39, test timing, fixed); CC-052…054 runs to verify.

## Done (numbers)
- **Change controls:** CC-001…CC-054 (`DECISION_LEDGER.md`, `registers/10`). Migrations 001–073.
- **Runtime suites, all from zero (E1):** 37 API suites + 2 browser checks (tests/ui, UI_CHECK=1, in CI), 1,114 checks + shared-guard probe + Golden Case status check, all PASS, RUN co3 ("700" earlier was a records error, F-19; Stage 1 claims 26, Stage 2 technical office 30, Stage 3 assets 27, Stage 4 inventory 21, Stage 5 NDC-002 29, Stage 6 cost/EAC 19, Stage 7 view isolation 10, Stage 8 sessions 20, Stage 9 time for completion 30, Stage 10 inventory controls 37, Stage 11 login throttling 20, Stage 12 risk register 37, Stage 14 report packs 29, Stage 15 commissioning 37, Stage 16 design impact 28, Stage 17 mobilisation 28; chain 92).

  | Suite | Checks | Suite | Checks |
  |---|---|---|---|
  | chain | 85 | hostile concurrency | 17 |
  | isolation | 36 | daily record + change paths | 29 |
  | BOQ handover | 41 | programme + CPM | 25 |
  | vendor master | 41 | variations | 20 |
  | DOA governance | 26 | quality / HSE | 20 |
  | tenant onboarding | 20 | approval rejection | 29 |
  | subcontract IPC | 24 | HR / payroll | 43 |
  | notice engine | 36 | EDMS | 24 |

- **Defects found by first runtime execution in the sweep and fixed (before → after evidence in `takeover/evidence/SW-*`):**
  - **Approvals (CC-027):** a rejected/returned approval left the record stuck under review forever; rejection needed no reason; an issued PO could be resubmitted and reset to approved.
  - **Payroll (CC-028):** every payroll submission crashed (HTTP 500) — payroll could never be approved; lines editable after approval; double pay, negative net, paying terminated staff and another tenant's employee all accepted.
  - **EDMS (CC-029):** every refusal returned HTTP 500; unapproved or superseded drawings could be issued for construction; approved files could be swapped in the DB; no record of who approved which revision.
  - Earlier waves: vendor eligibility, DOA self-confirmation, bootstrap takeover, subcontract certificates, F-13 dates, F-14 period lock, F-15 CPM loops, variations VA1–VA5, QA/HSE QH1–QH4.
- **Golden Case coverage** (`governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv`, 167 steps): RUNTIME 46 · PARTIAL 49 · API 9 · SCHEMA 2 · ABSENT 61.
- **Discovery:** NDC-001…029 (NDC-029 approved-EOT propagation, found in Stage 1) and DFS-001…006.
- **Snapshot delivered:** `MISHEL_SNAPSHOT_v0.5.0-sweep_8feec80.zip` (commit 8feec80, zip SHA-256 5549622f…1439).

## Proven (E1) / UNVERIFIED
- **E1:** everything listed in the suites above, on PG 16.14 locally and in CI on 16/17. Evidence is in `takeover/evidence/W1-*`, `W2-*` and the CI artefacts.
- **UNVERIFIED:**
  - docker-compose runtime;
  - browser UI (the frontend builds, but its behaviour is untested);
  - modules outside the suites (assets/plant, claims, technical office RFIs/submittals/method statements, inventory transfers, portals, dashboards/reports, AI, automation, knowledge);
  - performance, DR, penetration testing.

## Open Issues/Gaps (Critical/Major first)
- **RK-003 remainder:** assets/plant, claims, technical office, inventory transfers — never executed.
- **NDC-002 remainder:** NEC compensation-event register, FIDIC determination/DAAB, claim gating on notices.
- **NDC-011:** accruals and reproducible EAC.
- **G-013:** token revocation.
- **G-009:** D-pack coverage.
- **G-012:** unread archives (owner action).
- **Commercial provisioning (DEC-010):** decided by the owner; needs the owner's plan catalogue and pricing.

## Owner decisions required (decision | options | recommendation | reason)
- **DEC-009, IPC revenue/retention accounting.** DECIDED 2026-10-09 by owner (gross + retention receivable; IPC = billing; revenue over time, cost-to-cost); implementation Stages 28-29.
  - The frozen STEP09 rule that certification is not revenue requires, at minimum, the structure "IPC → receivable/contract balance; revenue from a policy engine".
- **DEC-012 (new), subcontract certificate valuation model and cost/AP posting basis.**
  - Today the system posts the net amount as cost: 18,000 posted for 20,000 gross (F-12).
  - Recommendation: gross-basis cost with a separate retention-payable liability. Decide together with DEC-009.
- **DEC-013 (new), payroll cost basis.** Payroll lines post *net* pay as project labour cost (gross 11,500 − deductions 1,500 → 10,000 posted; F-16). Recommendation: gross pay as cost, deductions to payables; add employer contributions when modelled. Decide with DEC-009/012.
- **DEC-014 (new), inventory valuation method** (F-17): transfers currently carry the source store's average inbound cost as a provisional default only.
- **DEC-010 follow-up:** plan catalogue and pricing for commercial tenant provisioning. These are owner-only values.
- **G-012:** make the three Drive archives readable, either by splitting them into parts under 10 MB or by allowing `drive.usercontent.google.com`.
- **Real values (the platform enforces structure but never invents values):**
  - DOA amount bands for the 30 STEP15 classes (`STEP15_DOA_RULE_CLASSES_30.csv`);
  - chart of accounts and posting rules;
  - contract clause periods per contract form.

## What I objected to and why
- v5 "TRUE FINAL" plan and its name-mapping evidence: rejected (R03).
- Frozen STEP06/18 generic aggregate schemas as a build spec: rejected. CCR18 shows that domain fields and transitions were never authored (R12). We build from Golden Case decomposition plus the proven R0 schema.
- Generic JSON aggregate store from the Render/Supabase bundle as the data model: rejected (R12). It cannot carry the relational invariants proven in R0.

## Next authorized step (owner-controlled staged execution; STOP after each stage and wait for "كمل")
- Stage 1 — GC-16 Claims: **DONE** (CC-030).
- Stage 2 — Technical Office: **DONE** (CC-031).
- Stage 3 — Assets & Equipment: **DONE** (CC-032).
- Stage 4 — Inventory transfers: **DONE** (CC-033; DEC-014 + NDC-030 opened).
- Stage 5 — NDC-002 remainder: **DONE** (CC-034).
- Stage 6 — NDC-011 remainder: **DONE** (CC-035).
- **Next stages (derived from directive, gaps and discovery; owner confirms by "كمل"):**
  - Stage 7 — G-015/G-016 hardening: **DONE** (CC-036; 4 views were leaking at DB level).
  - Stage 8 — G-013 session revocation: **DONE** (CC-037; G-017 login throttling opened).
  - Stage 9 — NDC-029: **DONE** (CC-038; signed-terms defect fixed; F-20/F-21). Was: NDC-029 approved-EOT/CE propagation to time-for-completion, LD exposure and budget (time-for-completion revisions).
  - Stage 10 — NDC-030: **DONE** (CC-039; F-22 direct adjustments, F-23 open items). Was: NDC-030 inventory control workflows (in-transit, stock count, approved adjustments).
  - Stage 11 — G-017: **DONE** (CC-040; DEC-015, G-018 MFA, F-24). Was: G-017 login throttling/lockout mechanism (configurable; values are owner/security policy).
  - Stage 12 — GC-26 + GC-01 s8 risk & opportunity register: **DONE** (CC-041; GC RUNTIME 49 / PARTIAL 52 / ABSENT 56; F-25 stale statuses, F-26 open risk items).
  - Stage 13 — Golden Case status reconciliation: **DONE** (CC-042; RUNTIME 56 / PARTIAL 54 / ABSENT 51 / API 5 / SCHEMA 1; checker in gate).
  - Stage 14 — GC-10 report packs: **DONE** (CC-043; weekly-executive defects fixed; RUNTIME 59 / PARTIAL 54 / ABSENT 48).
  - Stage 15 — GC-20 commissioning-to-handover: **DONE** (CC-044; punch-list defects fixed; RUNTIME 63 / PARTIAL 55 / ABSENT 44).
  - Stage 16 — GC-04 design-revision impact: **DONE** (CC-045; RUNTIME 66 / PARTIAL 54 / ABSENT 42; F-27 fixture gap).
  - Stage 17 — GC-02 mobilisation gate + IPC/unsigned-contract defect + F-27: **DONE** (CC-046; RUNTIME 67 / PARTIAL 54 / ABSENT 41).
  - Stage 18 — Project Controls UI + browser verification: **DONE** (CC-047; F-28 Google Fonts dependency, F-29 partial browser coverage).
  - Stage 19 — UI hardening: **DONE** (CC-048; F-28, F-29 closed; F-30 found and fixed).
  - Stage 20 — GC-12 subcontract advances/back-charges/less-previous + negative-net defect: **DONE** (CC-049; F-31 closed; F-32, F-33 open; RUNTIME 68 / PARTIAL 54 / ABSENT 41 / API 3).
  - Stage 21 — GC-13 client advances/IPC deductions (F-32) + CC-049 cap correction + F-30 page review: **DONE** (CC-050; F-34, F-35 opened).
  - Stage 22 — GC-13 client certification evidence, dispute/resubmission, AR = certified (F-35): **DONE** (CC-051; F-36/F-37/F-38 opened).
  - Stage 23 — Payments & Certification screen + browser check in CI: **DONE** (CC-052; F-38 closed).
  - Stage 24 — contract payment terms → due dates; client certified breakdown (F-36, F-37): **DONE** (CC-053; F-40 opened).
  - Stage 25 — collection/settlement (GC-13 s8 + AP mirror) and F-40 UI: **DONE** (CC-054; F-41 opened).
  - Owner DECIDED DEC-009/012/013/014/015 on 2026-10-09 (register 09). Implementation plan:
  - **Stage 26 (NEXT) — DEC-013 + DEC-014: payroll cost at gross with deductions to payables; inventory weighted average per store formalised (specific identification for tagged items).**
  - Stage 27 — DEC-012: subcontract cumulative valuation, cost at gross, retention payable, advances as prepayment (F-33).
  - Stages 28-29 — DEC-009: IPC as billing + retention receivable; revenue recognition run (cost-to-cost, second-person approval); contract asset/liability.
  - Stages 30-31 — DEC-015: per-address limit enabled per deployment; TOTP MFA mandatory for admin, finance and DOA approvers.
  - Later candidates: GC-24 legacy import; GC-12 advance recovery/back-charges; snapshot ZIP when the owner asks.
  - Gate order note: wave1_boq_handover now runs BEFORE chain.mjs (it configures contract-signing DOA and signers the chain uses).
  - Then: remaining ABSENT Golden Case steps by business priority; frontend browser verification; performance/DR/pentest preparation.
- Afterwards: derive next stages from the Owner Execution Directive, constitution, reconciliation/discovery state (incl. NDC-029, G-013).
- DEC-015 DECIDED (2026-10-09): lockout 5/15/15 adopted; address limit to be enabled per deployment with TRUST_PROXY; MFA mandatory for admin/finance/DOA approvers (Stages 30-31).
- DEC-009 / DEC-012 / DEC-013 / DEC-014 stay OPEN for the Finance/Accounting expert review — do not hard-code a policy.

## Warnings for next session
- Postgres in this container stops between sessions. Restart with `pg_ctl` (see CURRENT_STATE).
- **Run every static check after any frontend edit.** CC-017's CI went red because a red-team script greps the Admin UI.
- New suites must test SoD with a user who holds *all* permissions. A permission-denied 403 is not SoD evidence.
- Never treat static checks or name-mapping as implementation evidence.
- Shared trigger functions dispatching on TG_TABLE_NAME must not reference another table's columns in one condition (CC-006, CC-028, CC-031, CC-032 — audit the remaining shared guards): PL/pgSQL resolves fields at run time.
- A suite that fails stops `run_from_zero.sh` (set -e); to capture pre-fix evidence for a later suite, temporarily remove earlier new checks.
