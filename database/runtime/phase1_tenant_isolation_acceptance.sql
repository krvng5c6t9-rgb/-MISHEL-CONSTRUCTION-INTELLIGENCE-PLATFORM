-- Runtime acceptance helper for Phase 1 tenant isolation.
-- Execute against a CLEAN database after migrations 001..011.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.column_name='org_id'
    GROUP BY c.table_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class pc
      WHERE pc.relname=r.table_name AND pc.relnamespace='public'::regnamespace AND pc.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'FORCE RLS missing on %', r.table_name;
    END IF;
  END LOOP;
END $$;

SELECT set_config('app.org_id','1',false);
SELECT set_config('app.user_id','1',false);

DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='org_id'
    GROUP BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE org_id <> 1', r.table_name) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Tenant leakage detected in table %: % rows visible outside Org 1', r.table_name, n;
    END IF;
  END LOOP;
END $$;

ROLLBACK;

-- Repeat in a second authenticated session with app.org_id = 2.
-- Application-level runtime tests must additionally cover:
-- cross-tenant INSERT / UPDATE / DELETE, approvals, cost posting,
-- GL posting, dashboards/reports, and connection-pool context leakage.
