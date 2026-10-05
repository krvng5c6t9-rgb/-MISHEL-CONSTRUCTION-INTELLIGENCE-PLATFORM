-- (transaction managed by migrator)

-- Direct tenant ownership for commercial master/live BOQ tables that previously relied on parent joins.
ALTER TABLE resource_library ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
UPDATE resource_library r SET org_id=COALESCE((SELECT min(id) FROM organizations),1) WHERE org_id IS NULL;
ALTER TABLE resource_library ALTER COLUMN org_id SET DEFAULT NULLIF(current_setting('app.org_id',true),'')::bigint;
ALTER TABLE resource_library ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE project_boq ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
UPDATE project_boq b SET org_id=p.org_id FROM projects p WHERE p.id=b.project_id AND b.org_id IS NULL;
ALTER TABLE project_boq ALTER COLUMN org_id SET DEFAULT NULLIF(current_setting('app.org_id',true),'')::bigint;
ALTER TABLE project_boq ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resource_library_org ON resource_library(org_id);
CREATE INDEX IF NOT EXISTS idx_project_boq_org ON project_boq(org_id);

-- DOA must be explicitly confirmed by the company before it is eligible for new approvals.
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS confirmed_by BIGINT REFERENCES users(id);
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Closed accounting periods are a hard posting boundary.
CREATE OR REPLACE FUNCTION enforce_open_fiscal_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM fiscal_periods
   WHERE org_id=NEW.org_id AND NEW.transaction_date BETWEEN start_date AND end_date
   ORDER BY period_no LIMIT 1;
  IF st='closed' THEN RAISE EXCEPTION 'Accounting period is closed for transaction date %',NEW.transaction_date; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_gl_open_period ON general_ledger;
CREATE TRIGGER trg_gl_open_period BEFORE INSERT OR UPDATE OF transaction_date ON general_ledger FOR EACH ROW EXECUTE FUNCTION enforce_open_fiscal_period();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['resource_library','project_boq'] LOOP
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I',t);
   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I',t);
   EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)',t);
   EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)',t);
 END LOOP;
END $$;
INSERT INTO permissions(role_id,module,action,scope) SELECT r.id,'cost_control','manage','all' FROM roles r WHERE r.is_system_role=true AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='cost_control' AND p.action='manage');
-- (transaction managed by migrator)
