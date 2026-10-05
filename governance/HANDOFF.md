# HANDOFF — v0.4.0-wave2 — DATE: 2026-10-05

## Where we are (3 lines)
- The source investigation (R01–R12), the decomposition of the 38 Golden Cases into 167 steps (R13) and the cited market pass (R14) are done.
- Wave 1 (making the commercial core work for a second tenant) is built and runtime-tested: CC-015…CC-020.
- Wave 2 has started. NDC-001, the notice/time-bar engine, is live (CC-021). Every change is gated in CI on PG 16/17 with the API running in Africa/Cairo.

## Done (numbers)
- **Change controls:** CC-001…CC-021 (`DECISION_LEDGER.md`, `registers/10`). Migrations 001–044.
- **Runtime suites, all from zero (E1):** 8 suites, 307 checks in total.

  | Suite | Checks |
  |---|---|
  | chain | 85 |
  | isolation | 36 |
  | BOQ handover | 41 |
  | vendor master | 41 |
  | DOA governance | 26 |
  | tenant onboarding | 20 |
  | subcontract IPC | 22 |
  | notice engine | 36 |

- **Gaps:**
  - Closed: G-001 (BOQ handover), G-002 (vendor API), G-014 (cost codes).
  - Partially closed: G-003, G-004, G-006.
  - New: G-013 (no token revocation).
- **Defects found and fixed by the new runtime tests (before the fix → after):**
  - **Vendors:** no vendor eligibility at all.
  - **DOA:** confirmed rules editable in place, with the editor confirming their own edit.
  - **Bootstrap takeover:** an organization whose users were deactivated could be re-claimed with the bootstrap token.
  - **Subcontract certificates (5 defects, D1–D4):** raised against draft subcontracts; gross not reconciled to lines; retention above the subcontract %; lines added after verification.
  - **F-13:** every DATE value was one day early on a Cairo-timezone server.
- **Golden Case coverage** (`governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv`, 167 steps):

  | Status | Steps |
  |---|---|
  | RUNTIME | 29 |
  | API only | 23 |
  | PARTIAL | 48 |
  | SCHEMA | 3 |
  | ABSENT | 64 |

- **Discovery:** NDC-001…028 (20 extend frozen scope; 7 are new) and DFS-001…006.

## Proven (E1) / UNVERIFIED
- **E1:** everything listed in the suites above, on PG 16.14 locally and in CI on 16/17. Evidence is in `takeover/evidence/W1-*`, `W2-*` and the CI artefacts.
- **UNVERIFIED:**
  - docker-compose runtime;
  - browser UI (the frontend builds, but its behaviour is untested);
  - modules outside the suites (HR/payroll, assets, HSE, QA/QC, EDMS, planning/CPM, site, claims, variations, portals, AI, automation, knowledge);
  - performance, DR, penetration testing;
  - hostile concurrency tests (G-010).

## Open Issues/Gaps (Critical/Major first)
- **G-010:** hostile concurrency, replay and period-lock tests.
- **NDC-002/010/014:** separate notice / change / claim paths; accepted programme; structured daily record.
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
Continue Wave 2:
1. **NDC-002:** separate Notice / RFI / Change / Claim paths, with NEC Early Warning and Compensation Event registers as a contract-form pack.
2. **NDC-010:** accepted-programme governance.
3. **NDC-014:** structured daily record with impact flag and sign-off.

Then Wave 3 (cost truth: NDC-011, G-010 hostile tests).

## Warnings for next session
- Postgres in this container stops between sessions. Restart with `pg_ctl` (see CURRENT_STATE).
- **Run every static check after any frontend edit.** CC-017's CI went red because a red-team script greps the Admin UI.
- New suites must test SoD with a user who holds *all* permissions. A permission-denied 403 is not SoD evidence.
- Never treat static checks or name-mapping as implementation evidence.
