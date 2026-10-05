# Construction ERP — Phase 6 + Phase 7 Consultant Review

## Role
Senior multidisciplinary review / final hardening pass.

## Phase 6 implemented
- Tenant-safe client/subcontractor portal access with explicit `org_id`.
- Database parent/child organization consistency triggers for portal access.
- FORCE RLS on portal access tables.
- Notification center API: list, unread filter, mark-one-read, mark-all-read.
- Notification permissions and user-level filtering.
- Portfolio KPI and tender pipeline reporting views.
- Existing executive dashboards/reports retained and hardened through organization-scoped joins.
- Runtime acceptance script for portal isolation, notifications, and reporting.

## Phase 7 implemented
- Generic audit capture trigger for public tables carrying `org_id`.
- Audit records include organization, acting user, table, record, operation, old/new JSON.
- Audit log is FORCE-RLS protected.
- Audit log is append-only at database level.
- Final runtime acceptance script covers audit immutability and the complete ERP transaction chain.

## Static gates
The Phase 6 and Phase 7 static checks are designed to run without a database connection and are included in `backend/scripts/`.

## Acceptance status
- Static source gate: PASS when `security:phase6` and `security:phase7` both exit 0.
- TypeScript build: PENDING if dependencies are not installed in the current environment.
- PostgreSQL runtime: PENDING until a real PostgreSQL instance is available.
- Cross-tenant runtime proof: PENDING until two-organization test data is executed.
- Full E2E accounting proof: PENDING until Project → BOQ → PO → Invoice → Cost → GL → IPC → Payment is executed against PostgreSQL.

## Release decision
The package is a **cumulative engineering handover candidate**, not a falsely certified production release. Production certification requires the runtime gates above plus replacement of all placeholder business configuration (DOA thresholds, real COA/posting mappings, contract/legal policies, retention policy and other confirmed company decisions).
