-- PHASE 6 RUNTIME ACCEPTANCE — execute against a real PostgreSQL instance after migrations 001..016.
BEGIN;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname='public' AND tablename IN ('notifications','client_portal_access','subcontractor_portal_access');
  IF n <> 3 THEN RAISE EXCEPTION 'Phase 6 required tables missing'; END IF;
END $$;
SELECT tablename, rowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND tablename IN ('client_portal_access','subcontractor_portal_access');
SELECT 'Phase6: set app.org_id to Org A and prove Org B portal rows are invisible' AS required_test;
SELECT 'Phase6: create/read notification as User A; prove User B cannot read/update it' AS required_test;
SELECT 'Phase6: verify portal cross-org insert is rejected by trigger' AS required_test;
SELECT 'Phase6: verify executive/report queries return only current organization' AS required_test;
ROLLBACK;
