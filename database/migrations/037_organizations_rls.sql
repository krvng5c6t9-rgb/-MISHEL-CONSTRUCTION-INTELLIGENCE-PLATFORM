-- CC-009: organizations was the only tenant-bearing table without RLS. Under the
-- application role any tenant session could read every organization's name, legal
-- name, tax id and address. Tenant sessions now see only their own row; the bootstrap
-- flow (app.auth_mode='bootstrap') keeps the cross-org access it needs to find or create
-- a tenant. Migrations run as a BYPASSRLS role (enforced by migrate.ts) and are unaffected.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
CREATE POLICY organizations_tenant_isolation ON organizations
  USING (
    id = NULLIF(current_setting('app.org_id', true), '')::bigint
    OR current_setting('app.auth_mode', true) = 'bootstrap'
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.org_id', true), '')::bigint
    OR current_setting('app.auth_mode', true) = 'bootstrap'
  );
