# REV14 Executed Evidence — HSE / QAQC / Executive Dashboard Integrity

## Confirmed defects found in REV13
1. Executive financial dashboard used simultaneous joins to `cost_transactions`, `accounts_receivable`, and `accounts_payable`, which can multiply rows and inflate sums.
2. QA/QC and HSE metric queries used simultaneous one-to-many joins and non-distinct counts, which can multiply KPI counts.
3. Executive HSE dashboard checked severity `fatal`, while the database enum is `fatality`.
4. PTW database allowed creation directly as `active`, while dashboard logic already expected `requested/approved/active`; no controlled request→approve→activate workflow existed.
5. Incident reporter could close their own investigation through the API.
6. NCR raiser could close their own NCR; closure did not require both root cause and corrective action.
7. HSE and QA/QC frontend pages were mainly monitoring views and did not expose the hardened operational workflows.

## Remediation applied
- Added migration `026_hse_qaqc_dashboard_integrity.sql`.
- Added PTW lifecycle: `requested → approved → active → closed/expired` with DB-enforced transition guards.
- Added PTW maker/checker controls and reviewer/activation/closure evidence columns.
- Added independent incident closure with `closed_by`, `closed_at`, and corrective-action requirement.
- Added independent NCR closure with `closed_by`, mandatory root cause, corrective action, and closed date.
- Reworked HSE/QAQC metrics to use distinct entity counts.
- Reworked executive financial dashboard to aggregate Cost/AP/AR separately using lateral aggregates, preventing Cartesian multiplication.
- Corrected HSE fatal severity from `fatal` to `fatality`.
- Rebuilt HSE and QA/QC frontend pages with create/workflow actions.
- Added `scripts/redteam-rev14-check.mjs`.

## Executed checks after remediation
- Static import check: PASS
- Permission consistency: PASS
- Schema/code column check: PASS — 111 tables / 46 backend SQL files
- Tenant isolation: PASS — 46 TS files / 26 SQL files
- Phase 2 commercial: PASS
- Phase 3 financial integrity: PASS
- Phase 4 execution integrity: PASS
- Phase 5 integrity: PASS
- Phase 6 portal/reporting: PASS
- Phase 7 hardening: PASS
- Red-team release check: PASS
- REV11 SoD check: PASS
- REV12 SoD check: PASS
- REV13 Technical Office hostile check: PASS 13/13
- REV14 HSE/QAQC/dashboard hostile check: PASS 6/6

## Not claimed
PostgreSQL runtime migrations, dependency-resolved TypeScript build, browser runtime, E2E, concurrency, load, backup/restore and live tenant attack remain UNVERIFIED in this environment. Static gates are not treated as runtime evidence.
