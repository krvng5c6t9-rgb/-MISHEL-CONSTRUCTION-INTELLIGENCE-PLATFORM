# REDTEAM REV19 — Executed Evidence

## Scope
Adversarial review of Client/Subcontractor Portal access control and operational frontend parity.

## Confirmed defects found in REV18
1. `client_portal_access.org_id` and `subcontractor_portal_access.org_id` had been made NOT NULL in migration 016, but both POST access-grant endpoints omitted `org_id` from INSERTs. On the hardened schema, those endpoints were therefore structurally incapable of succeeding.
2. Portal grant endpoints did not perform complete explicit API-level tenant/type/relationship validation before insert; DB triggers mitigated part of this but produced poorer failure semantics and left application-layer traceability incomplete.
3. Client portal access did not explicitly validate that a project already assigned to a client was being granted to that same client.
4. PostgreSQL `UNIQUE(user_id,vendor_id,subcontract_id)` allowed multiple vendor-wide grants because NULL values are distinct.
5. Portals frontend was read-only JSON output rather than an operational access-management UI.
6. Subcontractor dashboard used multi-join aggregation where certificate values could be multiplied by unrelated joined rows; financial aggregation was rewritten using lateral pre-aggregation.

## Remediation
- Portal grant INSERTs now persist authenticated `org_id`.
- Explicit tenant + user-type + entity relationship validations added.
- Project/client ownership enforced in API and DB trigger.
- Grantor tenant enforced in DB trigger.
- Partial unique index added for vendor-wide NULL-subcontract grants.
- Tenant-scoped reference-data endpoint added for access management.
- Tenant-scoped activate/deactivate endpoints added.
- Operational Client/Subcontractor portal management UI added.
- Subcontractor dashboard certificate value aggregation isolated from join multiplication.
- Migration `031_portal_access_operational_hardening.sql` added.

## Executed checks
- Static import check: PASS
- Permission consistency: PASS
- Schema/code column check: PASS (112 tables / 46 backend SQL files)
- Tenant isolation static check: PASS (46 TS / 31 SQL)
- REV12–REV18 regression gates: PASS
- REV19 hostile portal gate: PASS (15/15)
- Migration numbering: 001–031 continuous and unique

## Runtime limitation
No claim of PostgreSQL runtime/E2E PASS is made by this evidence file. Static/structural checks are not a substitute for running the migrations and application against PostgreSQL.
