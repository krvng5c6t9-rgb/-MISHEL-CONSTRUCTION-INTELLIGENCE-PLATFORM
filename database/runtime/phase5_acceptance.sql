-- PHASE 5 RUNTIME ACCEPTANCE
-- Execute after migrations 001..015 on a clean PostgreSQL database.

-- 1) Structural tenant coverage
SELECT table_name
FROM information_schema.columns
WHERE table_schema='public' AND column_name='org_id'
  AND table_name IN ('attendance','timesheets','payroll_lines','leave_requests','recruitment',
                     'assets_equipment','equipment_usage','maintenance_log','inspection_checklists',
                     'ncrs','incidents','toolbox_talks','permits_to_work','document_registers',
                     'document_transmittals','transmittal_lines','employees','payroll_runs')
ORDER BY table_name;

-- 2) FORCE RLS acceptance
SELECT c.relname AS table_name, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('attendance','timesheets','payroll_lines','leave_requests','recruitment',
                    'assets_equipment','equipment_usage','maintenance_log','inspection_checklists',
                    'ncrs','incidents','toolbox_talks','permits_to_work','document_registers',
                    'document_transmittals','transmittal_lines','employees','payroll_runs')
ORDER BY c.relname;

-- 3) Org A context must not see Org B rows.
SELECT set_config('app.org_id','1',false);
SELECT count(*) AS cross_tenant_rows_visible
FROM attendance WHERE org_id <> 1;
SELECT count(*) AS cross_tenant_rows_visible
FROM ncrs WHERE org_id <> 1;
SELECT count(*) AS cross_tenant_rows_visible
FROM equipment_usage WHERE org_id <> 1;
SELECT count(*) AS cross_tenant_rows_visible
FROM document_transmittals WHERE org_id <> 1;

-- 4) Application/runtime tests to execute with real fixtures:
--    a) create attendance/timesheet/payroll line using Org A employee + Org B project => FAIL
--    b) create equipment usage using Org A asset + Org B project => FAIL
--    c) attach Org B document to Org A transmittal => FAIL
--    d) move payroll draft directly to paid => FAIL
--    e) move NCR open directly to an unknown state => FAIL
--    f) edit posted payroll/equipment financial fields => FAIL
--    g) approve/post valid records inside same organization => PASS
--    h) verify HR, HSE, QA/QC and EDMS reads return only current org rows
--    i) verify two-org concurrent requests do not leak pool context
