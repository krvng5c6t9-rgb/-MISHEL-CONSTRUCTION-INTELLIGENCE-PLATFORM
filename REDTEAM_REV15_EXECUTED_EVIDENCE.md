# REV15 Executed Evidence

## Scope executed
Hostile review focused on CRM, Tendering, and Claims/EOT workflow integrity after REV14.

## Findings remediated
1. Tender status could be moved through generic PATCH without a strict state machine.
2. Tender UI exposed arbitrary status selection, including paths not matching backend approval behavior.
3. Won/Lost tender outcomes did not force award value/loss reason evidence.
4. CRM lead stages could jump directly to terminal states without controlled progression.
5. Opportunity status could be patched to `converted` instead of conversion occurring only through the convert-to-tender transaction.
6. Claim creator could participate in final claim decision if the same account also held approval permission.
7. Claim determination fields were not attributed to a decision maker/time.
8. Claims remained too editable after progression beyond draft/notified.
9. Claims UI auto-derived determination values from claimed values instead of requiring an explicit determination input.

## Remediation
- Added strict tender transition map; submission remains approval-engine controlled.
- Added mandatory `awarded_value` for Won and `loss_reason` for Lost.
- Rebuilt Tendering UI actions around allowed transitions instead of arbitrary status dropdown.
- Added strict CRM lead transition map and terminal immutability.
- Removed generic opportunity conversion; only `/convert-to-tender` may create the converted state.
- Added migration `027_claims_crm_tender_workflow_hardening.sql`.
- Added claim `determined_by/determined_at/final_decided_by/final_decided_at` fields.
- Added DB trigger enforcing claim maker/final-decision segregation and mandatory determination data.
- Restricted claim editing by workflow state.
- Reworked Claims UI to require explicit approved days/amount during review.

## Executed checks after remediation
- static import check: PASS
- permission consistency: PASS
- schema/code column consistency: PASS (111 tables, 46 backend SQL files)
- tenant isolation: PASS
- Phase 2 commercial gate: PASS
- Phase 3 financial integrity gate: PASS
- Phase 4 execution integrity gate: PASS
- Phase 5 integrity gate: PASS
- Phase 6 portal/reporting gate: PASS
- Phase 7 hardening gate: PASS
- REV12 gate: PASS
- REV13 gate: PASS
- REV14 gate: PASS
- REV15 hostile gate: PASS (13/13)

## Migration chain
`001` through `027`, unique and continuous.

## Runtime limitation
This evidence does NOT claim PostgreSQL runtime/E2E PASS. A real PostgreSQL runtime, dependency-resolved build, browser execution, concurrency testing, and full E2E remain unverified in this environment.
