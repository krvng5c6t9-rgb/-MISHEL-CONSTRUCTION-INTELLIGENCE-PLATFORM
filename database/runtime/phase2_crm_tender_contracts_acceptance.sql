-- PHASE 2 RUNTIME ACCEPTANCE — CRM / TENDERING / CONTRACTS
-- Execute against a clean DB after migrations 001..012.
-- Requires two organizations and authenticated application sessions.

-- 1) Tenant keys and FORCE RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','lead_activities','opportunities','tenders','tender_documents','tender_clarifications','boq_master','contracts','contract_clauses','variations','variation_boq_lines'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relname=t AND n.nspname='public' AND c.relforcerowsecurity
    ) THEN RAISE EXCEPTION 'FORCE RLS missing on %',t; END IF;
  END LOOP;
END $$;

-- 2) Application-context isolation smoke test.
SELECT set_config('app.org_id','1',false);
SELECT table_name, count(*) AS foreign_org_rows
FROM (
  SELECT 'leads' table_name, count(*) FROM leads WHERE org_id <> 1
  UNION ALL SELECT 'opportunities', count(*) FROM opportunities WHERE org_id <> 1
  UNION ALL SELECT 'tenders', count(*) FROM tenders WHERE org_id <> 1
  UNION ALL SELECT 'contracts', count(*) FROM contracts WHERE org_id <> 1
  UNION ALL SELECT 'variations', count(*) FROM variations WHERE org_id <> 1
) x(table_name,count)
GROUP BY table_name;

-- 3) Org A must not be able to create a contract against an Org B project/client.
-- Expected: application returns 403/422 or PostgreSQL rejects the transaction.
-- Do this through the API, not as a superuser SQL session.

-- 4) Workflow acceptance through API:
-- Lead -> Opportunity -> Tender -> Tender Submission Approval -> Submitted
-- Contract Draft -> Contract Signing Approval -> Signed
-- Variation Proposed -> Variation Approval -> Approved

-- 5) Status machine negative tests through API:
-- * lead new -> won directly: reject
-- * tender invited -> won directly: reject
-- * contract draft -> active directly: reject
-- * variation proposed -> approved directly: reject

-- 6) Approval negative tests:
-- * wrong-role approver: 403
-- * second action on completed approval: 409
-- * missing DOA: 422

-- 7) Cross-tenant acceptance must be executed with two authenticated users
-- and separate organizations, including list/get/create/update for all Phase 2 modules.
