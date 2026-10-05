# REV10 — Executed Adversarial Evidence

Date: 2026-10-01

## Confirmed defects fixed in this revision
1. Payroll run approval bypassed the central DOA/approval engine and could be directly marked approved from the HR route.
2. Equipment usage approval bypassed the central DOA/approval engine and could be directly marked approved from the Assets route.
3. Payroll run approval did not enforce a deterministic single currency for DOA evaluation.
4. Payroll overhead GL posting converted NUMERIC money through JavaScript Float64.
5. Several approval submission paths converted database NUMERIC monetary values through JavaScript `Number(...)` before DOA evaluation.

## Remediation
- Added `payroll_run` and `equipment_usage` to the central approval service.
- Payroll and equipment approval endpoints now create approval instances instead of directly changing records to approved.
- Payroll approval derives the amount in PostgreSQL and rejects mixed-currency runs.
- Payroll overhead GL uses the PostgreSQL NUMERIC string value instead of Float64 conversion.
- Approval submission monetary values for PO, subcontract, certificate, contract, variation, tender, IPC, and payment are passed as decimal strings.
- Added `scripts/redteam-rev10-check.mjs` to prevent regression of these findings.

## Executed checks after remediation
- REV10 red-team regression check: PASS.
- Static import check: PASS.
- Permission consistency check: PASS.
- Schema/code-column check: PASS (111 tables / 46 backend SQL files reported by checker).
- REV5 gate: PASS.
- REV8 gate: PASS.
- REV9 monetary precision gate: PASS.
- Global TypeScript compiler syntax scan: no TS1xxx syntax/parser errors observed; full build remains UNVERIFIED because project dependencies are unavailable in the current runtime.

## Not claimed
No PostgreSQL runtime, migration execution, browser E2E, concurrency runtime test, load test, or production-readiness PASS is claimed by this evidence file.
