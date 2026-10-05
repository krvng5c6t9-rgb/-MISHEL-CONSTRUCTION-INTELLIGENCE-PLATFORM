# Phase 2 — CRM / Tendering / Contracts

## Implemented

### CRM
- Client register with list/detail/create/update/soft-delete.
- Leads with owner, source, client, value, stage and activity tracking.
- Lead activities.
- Opportunities with conversion to tender.
- Lead stage state machine at database level.

### Tendering
- Tender register with list/detail/create/update.
- Opportunity → Tender conversion.
- Tender clarifications.
- Tender document links to EDMS documents.
- Tender submission approval integration.
- Tender status state machine.

### Contracts
- Contract register with list/detail/create/update.
- Contract clauses.
- Contract-signing approval integration.
- Variations with cost/time impact.
- Variation BOQ lines.
- Variation approval integration.
- Contract and variation state machines.

## Tenant isolation

Phase 2 adds explicit `org_id` tenant keys to records that were previously tenant-linked only through parent tables. These records are backfilled from their parents, protected by parent/child consistency triggers, and placed under `FORCE ROW LEVEL SECURITY`.

## Acceptance status

- Static Phase 2 commercial gate: **PASS**.
- SQL structural balance check: **PASS**.
- Runtime PostgreSQL migration/transaction acceptance: **NOT EXECUTED** in the current environment because a live PostgreSQL runtime and installed Node dependencies are unavailable.
- TypeScript build: **BLOCKED BY ENVIRONMENT** because `node_modules` is not installed; `tsc` reports missing package/type modules rather than a validated application build.

## Required live acceptance before production

1. Run migrations `001` through `012` against a clean PostgreSQL database.
2. Create two organizations and authenticated users.
3. Verify CRUD isolation for clients, leads, opportunities, tenders, contracts and variations.
4. Verify workflow approvals and wrong-role rejection.
5. Verify invalid status transitions are rejected at DB level.
6. Verify tender → contract → variation traceability.
7. Run the supplied SQL/API acceptance script: `database/runtime/phase2_crm_tender_contracts_acceptance.sql`.
