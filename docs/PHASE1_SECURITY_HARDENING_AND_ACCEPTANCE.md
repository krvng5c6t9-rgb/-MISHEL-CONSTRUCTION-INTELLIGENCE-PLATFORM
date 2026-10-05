# Construction ERP — Phase 1 Security Hardening & Acceptance

## Scope
Tenant isolation and request-to-organization binding for the Phase 1 security gate.

## Implemented
- PostgreSQL RLS + FORCE RLS migration `011_phase1_security_tenant_isolation.sql` for every public table carrying `org_id` at migration time.
- Tenant context propagated through `AsyncLocalStorage` from the authenticated JWT user.
- DB connections receive `app.org_id`, `app.user_id`, and controlled authentication mode.
- DB session context is cleared before a pooled connection is returned.
- Direct `pool.connect()` calls outside the DB layer were removed from application modules.
- Authenticated routes use the JWT-derived organization rather than request `org_id` for tenant ownership.
- Login requires an explicit organization id.
- Bootstrap validates that the target organization exists and is active.
- Static gate script added: `backend/scripts/tenant-isolation-check.mjs`.

## Static gate result
**PASS** on the hardened source tree.

Checks include:
- no direct `pool.connect()` outside `backend/src/db/pool.ts`;
- tenant DB context present;
- AsyncLocalStorage present;
- FORCE RLS migration present;
- tenant read/write policies present;
- no remaining untrusted `org_id` request references outside authentication/bootstrap flows.

## Runtime gate
**NOT EXECUTED IN THIS ENVIRONMENT.**

The execution environment did not provide a running PostgreSQL server/Docker runtime, and the backend dependencies could not be installed within the available execution window. Therefore no claim is made that PostgreSQL migrations or live Org-A/Org-B isolation have passed here.

Required runtime acceptance:
1. clean PostgreSQL database;
2. migrations 001–011 from zero;
3. two organizations and users;
4. cross-tenant SELECT/INSERT/UPDATE/DELETE rejection;
5. approval/cost/GL/report isolation;
6. pooled-connection context leakage test;
7. backend and frontend builds.

## Release status
**Phase 1 Security Hardening: IMPLEMENTED + STATIC PASS.**

**Production Acceptance: BLOCKED pending live PostgreSQL/runtime execution.**
