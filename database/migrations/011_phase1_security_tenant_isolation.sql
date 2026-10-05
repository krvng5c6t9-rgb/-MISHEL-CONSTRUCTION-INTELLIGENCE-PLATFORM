-- PHASE 1 SECURITY HARDENING
-- Runtime tenant isolation for every table that owns an org_id column.
-- Application DB connections set app.org_id from the authenticated JWT context.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'org_id'
      AND table_schema = 'public'
      AND table_name <> 'organizations'
    GROUP BY table_schema, table_name
    ORDER BY table_name
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation_select ON %I.%I
      FOR SELECT
      USING (
        org_id = NULLIF(current_setting('app.org_id', true), '')::bigint
        OR (current_setting('app.auth_mode', true) = 'login' AND %L IN ('users','roles'))
        OR (current_setting('app.auth_mode', true) = 'bootstrap' AND org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
      )
    $p$, r.table_schema, r.table_name, r.table_name);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation_write ON %I.%I
      FOR ALL
      USING (
        org_id = NULLIF(current_setting('app.org_id', true), '')::bigint
        OR (current_setting('app.auth_mode', true) = 'bootstrap' AND org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
      )
      WITH CHECK (
        org_id = NULLIF(current_setting('app.org_id', true), '')::bigint
        OR (current_setting('app.auth_mode', true) = 'bootstrap' AND org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
      )
    $p$, r.table_schema, r.table_name);
  END LOOP;

  -- Authentication needs a narrow pre-auth read of users; it is only enabled by
  -- the server-side login context and is never supplied by HTTP input.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='org_id') THEN
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_select ON public.users';
    EXECUTE $p$
      CREATE POLICY tenant_isolation_select ON public.users
      FOR SELECT
      USING (
        org_id = NULLIF(current_setting('app.org_id', true), '')::bigint
        OR current_setting('app.auth_mode', true) = 'login'
      )
    $p$;
  END IF;
END $$;

COMMENT ON SCHEMA public IS 'Construction ERP tenant isolation: app.org_id is set by the authenticated server context; RLS is forced on org-scoped tables.';
