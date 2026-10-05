# Red-Team REV4 Evidence

This release was attacked against the actual source, not accepted from prior labels.

## Defects found and corrected
- Fixed a critical AsyncLocalStorage/Express tenant-context lifetime defect: authenticated org/user context now persists into the downstream route chain via `enterWith`, instead of ending when `next()` returns.
- Added Segregation-of-Duties guard: a transaction initiator cannot approve the same transaction.
- Added duplicate same-user approval-step protection.
- Removed stray migration `.tmp` artifact and legacy rollback scratch SQL from release packaging.
- Fixed Phase 4/5 integrity check scripts so they work independently of npm changing the working directory.
- Added fiscal-period overlap protection.
- Made inventory ledger append-only and added concurrent negative-stock protection.
- Added confirmed DOA overlap protection.

## Executed evidence
PASS: redteam-release-check
PASS: static import check
PASS: permission consistency
PASS: schema/code column check
PASS: tenant isolation static gate
PASS: Phase 2 commercial gate
PASS: Phase 3 financial integrity gate
PASS: Phase 4 execution integrity gate
PASS: Phase 5 integrity gate
PASS: Phase 6 portal/reporting gate
PASS: Phase 7 hardening gate

## Not falsely certified
Dependency installation exceeded the execution time available in this environment, so backend/frontend TypeScript build is NOT certified here. PostgreSQL migrations/runtime E2E are also NOT certified here. Static PASS is not Runtime PASS.
