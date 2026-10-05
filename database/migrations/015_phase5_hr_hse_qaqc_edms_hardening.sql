-- ============================================================================
-- PHASE 5 — HR / PAYROLL / ASSETS / QA-QC / HSE / EDMS HARDENING
-- Explicit tenant keys, trusted-parent consistency, status transition guards,
-- posting locks, and construction-control integrity.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance','timesheets','payroll_lines','leave_requests',
    'equipment_usage','maintenance_log','inspection_checklists','ncrs',
    'incidents','toolbox_talks','permits_to_work','document_registers',
    'document_transmittals','transmittal_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id BIGINT', t);
  END LOOP;
END $$;

-- Trusted parent backfill.
UPDATE attendance a SET org_id=e.org_id FROM employees e WHERE e.id=a.employee_id AND a.org_id IS NULL;
UPDATE timesheets t SET org_id=e.org_id FROM employees e WHERE e.id=t.employee_id AND t.org_id IS NULL;
UPDATE payroll_lines l SET org_id=r.org_id FROM payroll_runs r WHERE r.id=l.payroll_run_id AND l.org_id IS NULL;
UPDATE leave_requests l SET org_id=e.org_id FROM employees e WHERE e.id=l.employee_id AND l.org_id IS NULL;
UPDATE equipment_usage u SET org_id=a.org_id FROM assets_equipment a WHERE a.id=u.asset_id AND u.org_id IS NULL;
UPDATE maintenance_log m SET org_id=a.org_id FROM assets_equipment a WHERE a.id=m.asset_id AND m.org_id IS NULL;
UPDATE inspection_checklists i SET org_id=p.org_id FROM projects p WHERE p.id=i.project_id AND i.org_id IS NULL;
UPDATE ncrs n SET org_id=p.org_id FROM projects p WHERE p.id=n.project_id AND n.org_id IS NULL;
UPDATE incidents i SET org_id=p.org_id FROM projects p WHERE p.id=i.project_id AND i.org_id IS NULL;
UPDATE toolbox_talks t SET org_id=p.org_id FROM projects p WHERE p.id=t.project_id AND t.org_id IS NULL;
UPDATE permits_to_work w SET org_id=p.org_id FROM projects p WHERE p.id=w.project_id AND w.org_id IS NULL;
UPDATE document_registers r SET org_id=p.org_id FROM projects p WHERE p.id=r.project_id AND r.org_id IS NULL;
UPDATE document_transmittals t SET org_id=p.org_id FROM projects p WHERE p.id=t.project_id AND t.org_id IS NULL;
UPDATE transmittal_lines l SET org_id=t.org_id FROM document_transmittals t WHERE t.id=l.transmittal_id AND l.org_id IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance','timesheets','payroll_lines','leave_requests',
    'equipment_usage','maintenance_log','inspection_checklists','ncrs',
    'incidents','toolbox_talks','permits_to_work','document_registers',
    'document_transmittals','transmittal_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES organizations(id)', t, 'fk_'||t||'_org');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(org_id)', 'idx_'||t||'_org', t);
  END LOOP;
END $$;

-- NCR attribution: allow the originating subcontractor/vendor to be identified.
ALTER TABLE ncrs ADD COLUMN IF NOT EXISTS vendor_id BIGINT REFERENCES vendors_subcontractors(id);
CREATE INDEX IF NOT EXISTS idx_ncrs_vendor ON ncrs(vendor_id);

-- Trusted parent tenant consistency for every Phase 5 record.
CREATE OR REPLACE FUNCTION guard_phase5_org_consistency() RETURNS TRIGGER AS $$
DECLARE parent_org bigint;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'attendance' THEN SELECT org_id INTO parent_org FROM employees WHERE id=NEW.employee_id;
    WHEN 'timesheets' THEN SELECT org_id INTO parent_org FROM employees WHERE id=NEW.employee_id;
    WHEN 'payroll_lines' THEN SELECT org_id INTO parent_org FROM payroll_runs WHERE id=NEW.payroll_run_id;
    WHEN 'leave_requests' THEN SELECT org_id INTO parent_org FROM employees WHERE id=NEW.employee_id;
    WHEN 'equipment_usage' THEN SELECT org_id INTO parent_org FROM assets_equipment WHERE id=NEW.asset_id;
    WHEN 'maintenance_log' THEN SELECT org_id INTO parent_org FROM assets_equipment WHERE id=NEW.asset_id;
    WHEN 'inspection_checklists' THEN SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
    WHEN 'ncrs' THEN SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
    WHEN 'incidents' THEN SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
    WHEN 'toolbox_talks' THEN SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
    WHEN 'permits_to_work' THEN SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
    WHEN 'document_registers' THEN SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
    WHEN 'document_transmittals' THEN SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
    WHEN 'transmittal_lines' THEN SELECT org_id INTO parent_org FROM document_transmittals WHERE id=NEW.transmittal_id;
    ELSE RAISE EXCEPTION 'Unhandled Phase 5 table %', TG_TABLE_NAME;
  END CASE;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'Trusted parent not found for %', TG_TABLE_NAME; END IF;
  IF NEW.org_id IS NULL THEN NEW.org_id := parent_org; END IF;
  IF NEW.org_id <> parent_org THEN
    RAISE EXCEPTION 'Tenant mismatch on %: org_id % does not match trusted parent org %', TG_TABLE_NAME, NEW.org_id, parent_org;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance','timesheets','payroll_lines','leave_requests','equipment_usage','maintenance_log',
    'inspection_checklists','ncrs','incidents','toolbox_talks','permits_to_work','document_registers',
    'document_transmittals','transmittal_lines'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_'||t||'_phase5_org', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_phase5_org_consistency()', 'trg_'||t||'_phase5_org', t);
  END LOOP;
END $$;

-- Additional cross-tenant controls for Phase 5 parent links.
CREATE OR REPLACE FUNCTION guard_phase5_project_links() RETURNS TRIGGER AS $$
DECLARE child_org bigint; parent_org bigint;
BEGIN
  IF TG_TABLE_NAME='timesheets' THEN
    SELECT org_id INTO child_org FROM employees WHERE id=NEW.employee_id;
    SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
  ELSIF TG_TABLE_NAME='equipment_usage' THEN
    SELECT org_id INTO child_org FROM assets_equipment WHERE id=NEW.asset_id;
    SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
  ELSIF TG_TABLE_NAME='payroll_lines' AND NEW.project_id IS NOT NULL THEN
    SELECT org_id INTO child_org FROM payroll_runs WHERE id=NEW.payroll_run_id;
    SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
  ELSIF TG_TABLE_NAME='transmittal_lines' THEN
    SELECT org_id INTO child_org FROM document_transmittals WHERE id=NEW.transmittal_id;
    SELECT org_id INTO parent_org FROM documents WHERE id=NEW.document_id;
  ELSE
    RETURN NEW;
  END IF;
  IF child_org IS NULL OR parent_org IS NULL OR child_org <> parent_org THEN
    RAISE EXCEPTION 'Cross-tenant parent reference rejected for %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timesheets_project_org ON timesheets;
CREATE TRIGGER trg_timesheets_project_org BEFORE INSERT OR UPDATE ON timesheets FOR EACH ROW EXECUTE FUNCTION guard_phase5_project_links();
DROP TRIGGER IF EXISTS trg_equipment_usage_project_org ON equipment_usage;
CREATE TRIGGER trg_equipment_usage_project_org BEFORE INSERT OR UPDATE ON equipment_usage FOR EACH ROW EXECUTE FUNCTION guard_phase5_project_links();
DROP TRIGGER IF EXISTS trg_payroll_lines_project_org ON payroll_lines;
CREATE TRIGGER trg_payroll_lines_project_org BEFORE INSERT OR UPDATE ON payroll_lines FOR EACH ROW EXECUTE FUNCTION guard_phase5_project_links();
DROP TRIGGER IF EXISTS trg_transmittal_line_document_org ON transmittal_lines;
CREATE TRIGGER trg_transmittal_line_document_org BEFORE INSERT OR UPDATE ON transmittal_lines FOR EACH ROW EXECUTE FUNCTION guard_phase5_project_links();

-- Employee / asset primary-project integrity.
CREATE OR REPLACE FUNCTION guard_employee_project_org() RETURNS TRIGGER AS $$
DECLARE po bigint;
BEGIN
  IF NEW.primary_project_id IS NOT NULL THEN
    SELECT org_id INTO po FROM projects WHERE id=NEW.primary_project_id;
    IF po IS NULL OR po <> NEW.org_id THEN RAISE EXCEPTION 'Employee primary project belongs to another organization'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_employee_primary_project_org ON employees;
CREATE TRIGGER trg_employee_primary_project_org BEFORE INSERT OR UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION guard_employee_project_org();

CREATE OR REPLACE FUNCTION guard_asset_project_org() RETURNS TRIGGER AS $$
DECLARE po bigint;
BEGIN
  IF NEW.current_project_id IS NOT NULL THEN
    SELECT org_id INTO po FROM projects WHERE id=NEW.current_project_id;
    IF po IS NULL OR po <> NEW.org_id THEN RAISE EXCEPTION 'Asset current project belongs to another organization'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_asset_current_project_org ON assets_equipment;
CREATE TRIGGER trg_asset_current_project_org BEFORE INSERT OR UPDATE ON assets_equipment FOR EACH ROW EXECUTE FUNCTION guard_asset_project_org();

-- Construction-control status machines. No stage skipping.
CREATE OR REPLACE FUNCTION guard_phase5_status_transition() RETURNS TRIGGER AS $$
DECLARE ok boolean := false;
BEGIN
  IF TG_TABLE_NAME='payroll_runs' THEN
    ok := (OLD.status, NEW.status) IN (('draft','pending_approval'),('pending_approval','approved'),('draft','approved'),('approved','posted'),('posted','paid'));
  ELSIF TG_TABLE_NAME='equipment_usage' THEN
    ok := (OLD.status, NEW.status) IN (('draft','approved'));
  ELSIF TG_TABLE_NAME='ncrs' THEN
    ok := (OLD.status, NEW.status) IN (('open','closed'));
  ELSIF TG_TABLE_NAME='incidents' THEN
    ok := (OLD.investigation_status, NEW.investigation_status) IN (('open','closed'));
  ELSIF TG_TABLE_NAME='permits_to_work' THEN
    ok := (OLD.status, NEW.status) IN (('active','expired'),('active','closed'));
  ELSE
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND TG_TABLE_NAME NOT IN ('incidents') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='incidents' AND OLD.investigation_status IS NOT DISTINCT FROM NEW.investigation_status THEN RETURN NEW; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'Invalid Phase 5 status transition on %: % -> %', TG_TABLE_NAME, OLD.status, NEW.status; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_runs_status ON payroll_runs;
CREATE TRIGGER trg_payroll_runs_status BEFORE UPDATE OF status ON payroll_runs FOR EACH ROW EXECUTE FUNCTION guard_phase5_status_transition();
DROP TRIGGER IF EXISTS trg_equipment_usage_status ON equipment_usage;
CREATE TRIGGER trg_equipment_usage_status BEFORE UPDATE OF status ON equipment_usage FOR EACH ROW EXECUTE FUNCTION guard_phase5_status_transition();
DROP TRIGGER IF EXISTS trg_ncr_status ON ncrs;
CREATE TRIGGER trg_ncr_status BEFORE UPDATE OF status ON ncrs FOR EACH ROW EXECUTE FUNCTION guard_phase5_status_transition();
DROP TRIGGER IF EXISTS trg_incident_status ON incidents;
CREATE TRIGGER trg_incident_status BEFORE UPDATE OF investigation_status ON incidents FOR EACH ROW EXECUTE FUNCTION guard_phase5_status_transition();
DROP TRIGGER IF EXISTS trg_permit_status ON permits_to_work;
CREATE TRIGGER trg_permit_status BEFORE UPDATE OF status ON permits_to_work FOR EACH ROW EXECUTE FUNCTION guard_phase5_status_transition();

-- Payroll and equipment posting freeze: source values cannot be rewritten after posting.
CREATE OR REPLACE FUNCTION guard_phase5_posting_lock() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME='payroll_lines' AND (OLD.posted_cost_transaction_id IS NOT NULL OR OLD.posted_gl_batch_id IS NOT NULL) THEN
    IF NEW.employee_id <> OLD.employee_id OR NEW.payroll_run_id <> OLD.payroll_run_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
       OR NEW.currency_id <> OLD.currency_id OR NEW.basic <> OLD.basic OR NEW.overtime <> OLD.overtime
       OR NEW.allowances <> OLD.allowances OR NEW.deductions <> OLD.deductions THEN
      RAISE EXCEPTION 'Posted payroll line % is frozen; use a controlled correction/reversal.', OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME='equipment_usage' AND OLD.posted_cost_transaction_id IS NOT NULL THEN
    IF NEW.asset_id <> OLD.asset_id OR NEW.project_id <> OLD.project_id OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
       OR NEW.currency_id <> OLD.currency_id OR NEW.hours_used <> OLD.hours_used OR NEW.hourly_rate <> OLD.hourly_rate THEN
      RAISE EXCEPTION 'Posted equipment usage % is frozen; use a controlled correction/reversal.', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payroll_line_posting_lock ON payroll_lines;
CREATE TRIGGER trg_payroll_line_posting_lock BEFORE UPDATE ON payroll_lines FOR EACH ROW EXECUTE FUNCTION guard_phase5_posting_lock();
DROP TRIGGER IF EXISTS trg_equipment_usage_posting_lock ON equipment_usage;
CREATE TRIGGER trg_equipment_usage_posting_lock BEFORE UPDATE ON equipment_usage FOR EACH ROW EXECUTE FUNCTION guard_phase5_posting_lock();

-- HSE / HR / financial sanity constraints.
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS chk_attendance_hours_nonnegative;
ALTER TABLE attendance ADD CONSTRAINT chk_attendance_hours_nonnegative CHECK (hours_worked IS NULL OR hours_worked >= 0);
ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS chk_timesheet_hours_nonnegative;
ALTER TABLE timesheets ADD CONSTRAINT chk_timesheet_hours_nonnegative CHECK (hours > 0);
ALTER TABLE equipment_usage DROP CONSTRAINT IF EXISTS chk_equipment_usage_nonnegative;
ALTER TABLE equipment_usage ADD CONSTRAINT chk_equipment_usage_nonnegative CHECK (hours_used >= 0 AND hourly_rate >= 0);
ALTER TABLE maintenance_log DROP CONSTRAINT IF EXISTS chk_maintenance_cost_nonnegative;
ALTER TABLE maintenance_log ADD CONSTRAINT chk_maintenance_cost_nonnegative CHECK (cost IS NULL OR cost >= 0);
ALTER TABLE inspection_checklists DROP CONSTRAINT IF EXISTS chk_inspection_date_if_closed;
ALTER TABLE inspection_checklists ADD CONSTRAINT chk_inspection_date_if_closed CHECK (status='pending' OR inspection_date IS NOT NULL);
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS chk_incident_severity_description;
ALTER TABLE incidents ADD CONSTRAINT chk_incident_severity_description CHECK (length(trim(description)) > 0);
ALTER TABLE permits_to_work DROP CONSTRAINT IF EXISTS chk_permit_dates;
ALTER TABLE permits_to_work ADD CONSTRAINT chk_permit_dates CHECK (expiry_date IS NULL OR expiry_date >= issue_date);
ALTER TABLE toolbox_talks DROP CONSTRAINT IF EXISTS chk_toolbox_attendees_nonnegative;
ALTER TABLE toolbox_talks ADD CONSTRAINT chk_toolbox_attendees_nonnegative CHECK (attendees_count IS NULL OR attendees_count >= 0);

-- EDMS lines must point to documents from the same tenant as the transmittal.
CREATE OR REPLACE FUNCTION guard_transmittal_document_tenant() RETURNS TRIGGER AS $$
DECLARE a bigint; b bigint;
BEGIN
  SELECT org_id INTO a FROM document_transmittals WHERE id=NEW.transmittal_id;
  SELECT org_id INTO b FROM documents WHERE id=NEW.document_id;
  IF a IS NULL OR b IS NULL OR a <> b THEN RAISE EXCEPTION 'Transmittal document tenant mismatch'; END IF;
  NEW.org_id := a;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_transmittal_document_tenant ON transmittal_lines;
CREATE TRIGGER trg_transmittal_document_tenant BEFORE INSERT OR UPDATE ON transmittal_lines FOR EACH ROW EXECUTE FUNCTION guard_transmittal_document_tenant();

-- RLS on all explicit Phase 5 tenant tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance','timesheets','payroll_lines','leave_requests','recruitment','assets_equipment',
    'equipment_usage','maintenance_log','inspection_checklists','ncrs','incidents','toolbox_talks',
    'permits_to_work','document_registers','document_transmittals','transmittal_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS phase5_tenant_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS phase5_tenant_write ON %I', t);
    EXECUTE format('CREATE POLICY phase5_tenant_select ON %I FOR SELECT USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint)', t);
    EXECUTE format('CREATE POLICY phase5_tenant_write ON %I FOR ALL USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint) WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint)', t);
  END LOOP;
END $$;

-- Employees/assets already carry org_id; reinforce RLS explicitly for Phase 5 usage.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','payroll_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS phase5_tenant_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS phase5_tenant_write ON %I', t);
    EXECUTE format('CREATE POLICY phase5_tenant_select ON %I FOR SELECT USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint)', t);
    EXECUTE format('CREATE POLICY phase5_tenant_write ON %I FOR ALL USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint) WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint)', t);
  END LOOP;
END $$;
