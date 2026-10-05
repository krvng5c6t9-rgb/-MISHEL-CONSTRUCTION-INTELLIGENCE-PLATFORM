# Red-Team Remediation Evidence — REV5

## Code changes made in this revision
- Replaced read-only CRM UI with lead creation, lead stage control and opportunity creation.
- Replaced read-only Tendering UI with tender creation, status control and submission-approval action.
- Corrected the Contracts UI variation-list endpoint and added contract/variation creation plus approval submission controls.
- Added Claims/EOT create/edit/state-transition API controls and an operational workflow UI.
- Added Subcontract and certificate creation plus Site Verification → QS Certification → Approval UI controls.
- Added atomic warehouse transfer API/UI with row locking and insufficient-stock rejection.
- Hardened manual inventory issues: transfers cannot bypass transfer API; issues require negative quantity and available stock.
- Added migration 020 to remove unconfirmed placeholder DOA seeds and guessed retention/client seed data on migrated databases, plus indexes.

## Verification executed in this environment
PASS: static import check
PASS: permission consistency
PASS: schema/code column check (111 tables / 46 backend SQL files)
PASS: tenant isolation
PASS: Phase 2 commercial gate
PASS: Phase 3 financial integrity gate
PASS: Phase 4 execution integrity gate
PASS: Phase 5 integrity gate
PASS: Phase 6 portal/reporting gate
PASS: Phase 7 hardening gate
PASS: REV5 red-team closure check
PASS: no zero-byte or temp/bak artifacts

## Not falsely certified
Dependency installation timed out in this environment, therefore backend/frontend dependency-resolved builds were not certified here. PostgreSQL runtime migrations and full E2E/load/penetration/backup-recovery execution also require a runnable PostgreSQL/application environment and are not marked PASS by this document.
