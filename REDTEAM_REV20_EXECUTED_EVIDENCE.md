# REV20 — Hostile Commission Remediation Evidence

This revision was produced from REV19 after a new zero-trust review focused on authenticated tenant context and dynamic first-run/admin operability.

## Confirmed defects found and remediated

1. **CRITICAL — Authenticated requests could fail RLS user loading**: `authenticate.ts` loaded the current user under `{ userId }` without `orgId`; FORCE RLS on `users` requires `app.org_id`. REV20 validates the signed JWT `org_id`, enters that RLS context before loading the user, and re-checks `u.org_id` in SQL.
2. **HIGH — Cross-tenant role assignment risk on user creation**: `POST /users` trusted a numeric `role_id` without proving the role belonged to the authenticated organization. REV20 validates role and optional employee ownership inside the same transaction before insertion.
3. **HIGH — Role permission enumeration was not explicitly tenant constrained**: `GET /roles/:id/permissions` queried `permissions` by role ID only; `permissions` itself has no `org_id`. REV20 joins `roles` and constrains `r.org_id` to the authenticated tenant.
4. **OPERATIONAL GAP — no no-SQL first-run company onboarding**: bootstrap required a pre-existing organization. REV20 supports secure first-run organization configuration/creation (or safe reuse of the pristine release placeholder) plus first System Admin creation using the required bootstrap token.
5. **OPERATIONAL GAP — Admin UI did not actually configure roles/permissions/DOA**: REV20 adds role creation, full permission matrix editing, and DOA edit/confirm controls.

## Verification executed

- Static import gate
- Permission consistency gate
- Schema/code-column gate
- Tenant isolation static gate
- REV20 adversarial regression gate
- TypeScript syntax parse using global `tsc` with dependency resolution disabled; only expected missing-package/type errors are accepted in this environment, no syntax diagnostics were produced by the modified files.

## Not claimed

PostgreSQL migrations, backend/frontend dependency-resolved builds, runtime E2E, concurrency, performance, and backup/restore remain unverified until a suitable runtime environment is available.
