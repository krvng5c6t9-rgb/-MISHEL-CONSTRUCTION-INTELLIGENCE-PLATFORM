# Construction ERP — Expert Consultant Review — Phase 1A to Phase 5

Date: 2026-09-17
Reviewer role: Expert Consultant / Technical QA / Project Controls

## Final Consultant Decision

**Decision: REV-A issued after review.**

The submitted Phase 1A→5 package had strong functional coverage, but the review found compile/runtime blockers that had to be corrected before continuing to Phase 6. These blockers have been patched in this REV-A package.

## Critical Findings Fixed in REV-A

1. **Backend compile blocker — missing `getClient()` export**
   - Files importing it: `assets.routes.ts`, `hr.routes.ts`.
   - Cause: `pool.ts` exported `pool` and `query()` only.
   - Correction: added `export async function getClient() { return pool.connect(); }`.

2. **Backend compile/type blocker — missing permission action types**
   - Code uses `finance.manage`, `finance.post`, `site.manage`, `planning.manage`, etc.
   - Original `PermissionAction` union omitted `manage` and `post`.
   - Correction: added `manage` and `post` to `PermissionAction`.

3. **First Admin usability blocker — bootstrap permissions incomplete**
   - Bootstrap admin did not receive all modules/actions used by the routes.
   - Result before correction: first admin could login but hit 403 on Finance post/manage, Planning manage, Site manage, HR, Assets, QA/QC, HSE, EDMS.
   - Correction: bootstrap now seeds all active modules and all action types used by routes.

## Scope Verified

- Phase 1A: Auth / Users / Roles / RBAC.
- Phase 2: Procurement / PO / Vendor Invoice / Cost Posting.
- Phase 3: Finance / GL / IPC / Payments.
- Phase 4: Technical Office / Planning / Site Execution.
- Phase 5: QA/QC / HSE / HR-Payroll / Assets / EDMS.

## Remaining Non-Production Conditions

This package is suitable to continue to Phase 6 after runtime validation. It is not yet production-release because the following must still be executed in a real environment:

1. `npm install` for root, backend, and frontend.
2. `npm run build`.
3. Fresh PostgreSQL migration run from `001` to `009`.
4. Bootstrap first admin.
5. End-to-end API cycle test:
   - Login
   - Project
   - PO
   - Approval
   - Vendor Invoice
   - Actual Cost Transaction
   - GL Posting
   - IPC
   - Payment
6. Security hardening: rate limiting, refresh tokens, audit logs, production CORS policy, secrets handling, RLS if Supabase Data API is exposed.

## Consultant Recommendation

Proceed to Phase 6 only using this REV-A package, not the previous Phase 5 ZIP.
