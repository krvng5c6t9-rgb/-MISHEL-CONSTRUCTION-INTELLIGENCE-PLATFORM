# HANDOFF — v0.3.0-post-R0 — DATE: 2026-10-05

## Where we are (3 lines)
- R0 is passed and the foundation is runtime-proven on PG 16/17 with a CI gate.
- The post-R0 snapshot was delivered and verified from zero.
- Source investigation is under way: R01–R05 done; task 4 (first-principles discovery) is next.

## Done (numbers)
- Source coverage of 1,268 unique files: READ_FULL/PARSED 57 · INVENTORIED 513 · READ_RUNTIME 180 · UNREAD 517 (+3 archives unavailable).
- Change controls: CC-001…CC-014 (`registers/10`). Issues: I-001…I-012 closed (`registers/08`). Gaps: G-001…G-012 (`registers/07`).
- Reconciliations: R01 (4,602 = platform contract) · R02 (operating model: skeleton is valuable, content is templated) · R03 (v1–v5 plans; 787/833 and 531/1,660 resolved) · R04 (STEP01 DNA + 38 Golden Cases; STEP17 carried at most about 12% of tables) · R05 (D-pack: 52% absent, 26% thin).

## Proven (E1) / COVERED only / UNVERIFIED
- **E1:**
  - Build.
  - Migrations 001–037 on PG 16/17.
  - Procurement-to-GL chain, 74/74.
  - Negative and isolation suite, 36/36.
- **UNVERIFIED:**
  - docker-compose runtime.
  - Browser UI.
  - All modules outside the chain.
  - Performance, DR, pentest.
  - W00-09 hostile concurrency tests.

## Open Issues/Gaps (Critical/Major first)
G-001 BOQ handover · G-003 tenant provisioning · G-004 DOA API · G-007 Golden Cases undecomposed · G-009 D-pack coverage · G-010 hostile runtime tests · G-012 unread archives.

## Owner decisions required (decision | options | recommendation | reason)
- **DEC-009 IPC/retention accounting.** Options: net / gross + retention receivable / configurable. Recommendation: configurable posting models per STEP09 BF09-023…037. Status: kept OPEN per owner until expert review.
- **G-012.** Make the three archives readable: split them into parts under 10 MB, or allow `drive.usercontent.google.com`.

## What I objected to and why
- v5 "TRUE FINAL / no v6 / the register is the plan": set aside (R03, Constitution §29).
- v5 code-evidence statuses: rejected as name-mapping only (R03).

## Next authorized step
Task 4: decompose GC-01…GC-38 together with the D scenarios into process → activity → decision → I/O → rule/calculation → role → control → agent → test. In parallel, run the market benchmark (M06) and the W00-09 hostile runtime tests.

## Warnings for next session
- Postgres in this container stops between sessions. Restart with `pg_ctl` (see CURRENT_STATE).
- Never treat static checks or name-mapping as implementation evidence.
