-- PHASE 7 RUNTIME ACCEPTANCE — execute after migrations 001..017.
BEGIN;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_proc WHERE proname='write_audit_log_row';
  IF n < 1 THEN RAISE EXCEPTION 'Audit trigger function missing'; END IF;
END $$;
SELECT tablename, rowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND tablename='audit_log';
SELECT 'Phase7: INSERT/UPDATE/DELETE a representative business record and verify audit rows contain actor/org/old/new values' AS required_test;
SELECT 'Phase7: attempt UPDATE/DELETE audit_log and verify append-only exception' AS required_test;
SELECT 'Phase7: execute complete E2E Project→BOQ→PO→Invoice→Cost→GL→IPC→Payment cycle under one organization' AS required_test;
SELECT 'Phase7: repeat same E2E cycle with a second organization and prove zero cross-tenant visibility' AS required_test;
ROLLBACK;
