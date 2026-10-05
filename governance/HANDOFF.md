# HANDOFF — v0.5.0-sweep — DATE: 2026-10-05

## Where we are (3 lines)
- Investigation R01–R14 is done; the 38 Golden Cases are decomposed into 167 steps (R13).
- Waves 1–2 are built and runtime-tested (CC-015…CC-024). The RK-003 module sweep has executed variations, QA/HSE, approval rejection paths, HR/payroll and EDMS for the first time (CC-025…CC-029).
- Every change is gated in CI on PG 16/17 with the API running in Africa/Cairo. CI green through CC-028; CC-029 queued at handoff.

## Done (numbers)
- **Change controls:** CC-001…CC-029 (`DECISION_LEDGER.md`, `registers/10`). Migrations 001–052.
- **Runtime suites, all from zero (E1):** 16 suites, 538 checks, all PASS.

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
- **Golden Case coverage** (`governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv`, 167 steps): RUNTIME 45 · PARTIAL 49 · API 10 · SCHEMA 2 · ABSENT 61.
- **Discovery:** NDC-001…028 and DFS-001…006.

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
- **DEC-009, IPC revenue/retention accounting.** Still OPEN, pending expert review.
  - The frozen STEP09 rule that certification is not revenue requires, at minimum, the structure "IPC → receivable/contract balance; revenue from a policy engine".
- **DEC-012 (new), subcontract certificate valuation model and cost/AP posting basis.**
  - Today the system posts the net amount as cost: 18,000 posted for 20,000 gross (F-12).
  - Recommendation: gross-basis cost with a separate retention-payable liability. Decide together with DEC-009.
- **DEC-013 (new), payroll cost basis.** Payroll lines post *net* pay as project labour cost (gross 11,500 − deductions 1,500 → 10,000 posted; F-16). Recommendation: gross pay as cost, deductions to payables; add employer contributions when modelled. Decide with DEC-009/012.
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

## Next authorized step
1. Finish RK-003: runtime suites + fixes for claims (GC-16), technical office RFIs/submittals (GC-04/05), assets/plant (GC-30s), inventory transfers.
2. NDC-002 remainder (NEC CE register, FIDIC determination, claim gating) and NDC-011 (accruals, reproducible EAC).
3. G-013 token revocation; then waves 4–5 per the atomic programme.

## Warnings for next session
- Postgres in this container stops between sessions. Restart with `pg_ctl` (see CURRENT_STATE).
- **Run every static check after any frontend edit.** CC-017's CI went red because a red-team script greps the Admin UI.
- New suites must test SoD with a user who holds *all* permissions. A permission-denied 403 is not SoD evidence.
- Never treat static checks or name-mapping as implementation evidence.
- Shared trigger functions dispatching on TG_TABLE_NAME must not reference another table's columns in one condition (CC-006, CC-028): PL/pgSQL resolves fields at run time.
- A suite that fails stops `run_from_zero.sh` (set -e); to capture pre-fix evidence for a later suite, temporarily remove earlier new checks.
