# REV11 — Executed Red-Team Evidence

## Confirmed remediation
- Timesheet maker/checker segregation added.
- New timesheets capture `created_by`.
- Timesheet approval is tenant-scoped, draft-only, requires maker attribution, and blocks self-approval.
- Database trigger independently enforces the same timesheet SoD rule.
- Leave requests now capture `created_by`.
- Leave approve/reject is tenant-scoped, pending-only, requires maker attribution, and blocks the maker from deciding their own request.
- Database trigger independently enforces the same leave-request SoD rule.

## New migration
- `database/migrations/023_timesheet_sod_hardening.sql`

## Executed checks after remediation
- Static import check: PASS
- Permission consistency check: PASS
- Schema/code column check: PASS — 111 tables, 46 backend SQL files
- Tenant isolation check: PASS
- Phase 2 commercial check: PASS
- Phase 3 financial integrity check: PASS
- Phase 4 execution integrity check: PASS
- Phase 5 integrity check: PASS
- Phase 6 portal/reporting check: PASS
- Phase 7 hardening check: PASS
- REV11 SoD check: PASS

## Runtime limitation
PostgreSQL runtime, dependency-resolved TypeScript build, browser E2E, concurrency and recovery tests are not claimed as PASS in this evidence file.
