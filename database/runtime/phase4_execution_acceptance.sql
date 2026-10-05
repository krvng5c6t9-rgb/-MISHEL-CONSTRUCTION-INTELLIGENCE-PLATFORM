-- PHASE 4 RUNTIME ACCEPTANCE — requires PostgreSQL and a seeded two-organization test fixture.
-- Run after migrations 001..014 on a clean database.

-- 1) Confirm explicit tenant columns + FORCE RLS.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('drawings','submittals','rfis','method_statements','schedule_baselines','schedule_activities',
    'progress_updates','milestones','site_diary','diary_manpower','diary_equipment','site_instructions',
    'quantity_sheets','punch_lists','cost_forecasts','evm_snapshots','subcontracts','subcontract_certificates',
    'subcontract_certificate_lines','schedule_relationships')
ORDER BY c.relname;

-- 2) Tenant A must not see Tenant B execution records.
SELECT set_config('app.org_id','1',false);
SELECT COUNT(*) AS cross_tenant_rows_visible
FROM drawings WHERE org_id <> 1;

-- 3) Verify child/parent tenant consistency.
SELECT COUNT(*) AS bad_drawing_tenants FROM drawings d JOIN projects p ON p.id=d.project_id WHERE d.org_id<>p.org_id;
SELECT COUNT(*) AS bad_activity_tenants FROM schedule_activities a JOIN projects p ON p.id=a.project_id WHERE a.org_id<>p.org_id;
SELECT COUNT(*) AS bad_subcontract_tenants FROM subcontracts s JOIN projects p ON p.id=s.project_id WHERE s.org_id<>p.org_id;
SELECT COUNT(*) AS bad_certificate_tenants FROM subcontract_certificates c JOIN projects p ON p.id=c.project_id WHERE c.org_id<>p.org_id;

-- 4) Status/control acceptance (requires fixture records).
-- drawings: for_review -> approved/approved_with_comments/rejected only.
-- RFIs: open -> answered -> closed, and answer requires response.
-- quantity sheets: draft -> verified only, verified requires checked_by.
-- subcontract certificates: draft -> site_verified -> qs_certified -> approved -> posted -> paid.

-- 5) Financial E2E acceptance:
-- approved subcontract certificate must create exactly one actual cost transaction;
-- duplicate posting must fail;
-- cost transaction must match certificate amount/project/currency/cost code.

-- 6) Schedule acceptance:
-- relationships across different projects must fail;
-- predecessor/successor self-links must fail;
-- multiple relationship types may coexist only when the exact unique key differs.
