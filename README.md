# MISHEL Commercial Product Merge v0.2

> Active development branch. Not a production-readiness claim.

# Construction ERP — Phase 1A → Phase 7 — FINAL CUMULATIVE HANDOVER

## Current status

**Final Cumulative Engineering Handover — Runtime Certification Pending.**

This is the single cumulative source package to review. It supersedes earlier REV-A…REV-G handover descriptions.

### Completed static/structural review

The following checks pass against this package:

```bash
npm run check:all
node backend/scripts/tenant-isolation-check.mjs
node backend/scripts/phase2-commercial-check.mjs
node backend/scripts/phase3-financial-integrity-check.mjs
node backend/scripts/phase4-execution-integrity-check.mjs
node backend/scripts/phase5-integrity-check.mjs
node backend/scripts/phase6-portal-reporting-check.mjs
node backend/scripts/phase7-final-hardening-check.mjs
```

### Runtime gates intentionally not claimed as PASS

This environment does not contain a running PostgreSQL/Docker service or installed npm dependencies. Therefore the following remain **PENDING** and must be executed in the target environment:

1. Clean PostgreSQL migration execution: `database/migrations/001…017`.
2. Backend dependency installation and TypeScript build.
3. Frontend dependency installation and Vite build.
4. Runtime tenant-isolation tests for at least two organizations.
5. Full E2E business/financial cycle:
   `Project → BOQ → PO → Approval → Vendor Invoice → Cost Transaction → GL → IPC → Payment`.
6. Approval/DOA runtime acceptance.
7. Audit-trail runtime acceptance.
8. Backup/recovery and performance/load testing.

## Important business configuration hold points

The package deliberately does **not** invent company policy. Before production use, the owner/accountant/legal team must confirm:

- Real DOA thresholds and approver matrix.
- Production Chart of Accounts and GL posting mappings.
- Contract form and legal-review workflow.
- Retention release policy.
- Egyptian VAT/e-invoicing requirements, if applicable.
- Multi-entity/branch policy.
- Portal operating policy.

## Functional UI note

The backend contains the broad ERP module surface. The frontend contains the principal operational screens, but it is **not represented as a complete bespoke CRUD screen for every backend module**; several areas still use generic/simple pages or backend-first coverage. This is a known engineering handover limitation and must be assessed during the final UI/functional acceptance gate.

## Local verification

```bash
cp .env.example .env
npm run check:all
npm run install:all
npm run build
```

Do not interpret a static PASS as production certification.
