-- PHASE 3 RUNTIME ACCEPTANCE — execute on a CLEAN PostgreSQL database after 001..013.
-- Requires two active organizations with test users/projects/accounts.
-- This script is intentionally executable only against a real DB; no claim of
-- runtime PASS is made until these checks are actually run.

BEGIN;

-- 1) Tenant-scoped tables must all be FORCE RLS protected.
DO $$
DECLARE t TEXT; bad BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chart_of_accounts','gl_posting_rules','general_ledger','manual_journal_entries',
    'manual_journal_entry_lines','ipcs','ipc_boq_lines','ipc_supporting_docs',
    'retention_ledger','accounts_payable','accounts_receivable','bank_accounts',
    'payments','bank_reconciliation','cash_flow_forecast','cash_flow_actual','company_cash_position'
  ] LOOP
    SELECT count(*) INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity AND c.relforcerowsecurity;
    IF bad <> 1 THEN RAISE EXCEPTION 'RLS/force RLS missing for %', t; END IF;
  END LOOP;
END $$;

-- 2) Org A must not see Org B financial rows.
SELECT set_config('app.org_id','1',true);
SELECT set_config('app.auth_mode','',true);
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad FROM chart_of_accounts WHERE org_id <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION 'Org 1 can see foreign COA rows'; END IF;
  SELECT count(*) INTO bad FROM general_ledger WHERE org_id <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION 'Org 1 can see foreign GL rows'; END IF;
  SELECT count(*) INTO bad FROM ipcs WHERE org_id <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION 'Org 1 can see foreign IPC rows'; END IF;
END $$;

-- 3) Cross-tenant insert/update attempts must fail. Replace the IDs with valid
-- test fixtures from the target database before execution.
-- Example expected failures:
--   INSERT INTO chart_of_accounts(org_id,account_code,account_name,account_type)
--   VALUES (2,'X-TEST','Should Fail','asset');
--   UPDATE bank_accounts SET org_id=2 WHERE id=<org1_bank_id>;
--   INSERT INTO payments(org_id,... foreign bank/AP/AR/party ids ...);

-- 4) GL posting acceptance:
--    a) approved source posts exactly once;
--    b) debit total = credit total per journal_batch_id;
--    c) second posting attempt fails;
--    d) posted source cannot be mutated in ways forbidden by its lock.

-- 5) Approval acceptance:
--    IPC submission, payment approval and manual journal approval must create
--    approval_instances and only the configured DOA actor may finalize them.

-- 6) Cash-flow acceptance: values must equal independent source aggregates.
-- The API query uses correlated aggregates to avoid AP x AR x cost row multiplication.

ROLLBACK;
