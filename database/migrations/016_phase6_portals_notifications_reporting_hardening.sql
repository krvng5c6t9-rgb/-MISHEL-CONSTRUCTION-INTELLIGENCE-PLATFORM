-- PHASE 6 — Portals, Notifications, Reporting & Dashboard hardening

-- Tenant-safe portal access: explicit org ownership and parent consistency.
ALTER TABLE client_portal_access ADD COLUMN IF NOT EXISTS org_id BIGINT;
UPDATE client_portal_access cpa SET org_id = p.org_id
FROM projects p WHERE p.id = cpa.project_id AND cpa.org_id IS NULL;
ALTER TABLE client_portal_access ALTER COLUMN org_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_cpa_org') THEN
    ALTER TABLE client_portal_access ADD CONSTRAINT fk_cpa_org FOREIGN KEY (org_id) REFERENCES organizations(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_cpa_org ON client_portal_access(org_id);

ALTER TABLE subcontractor_portal_access ADD COLUMN IF NOT EXISTS org_id BIGINT;
UPDATE subcontractor_portal_access spa SET org_id = v.org_id
FROM vendors_subcontractors v WHERE v.id = spa.vendor_id AND spa.org_id IS NULL;
ALTER TABLE subcontractor_portal_access ALTER COLUMN org_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_spa_org') THEN
    ALTER TABLE subcontractor_portal_access ADD CONSTRAINT fk_spa_org FOREIGN KEY (org_id) REFERENCES organizations(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_spa_org ON subcontractor_portal_access(org_id);

CREATE OR REPLACE FUNCTION validate_portal_access_tenant() RETURNS TRIGGER AS $$
DECLARE p_org BIGINT; v_org BIGINT; c_org BIGINT; u_org BIGINT;
BEGIN
  SELECT org_id INTO u_org FROM users WHERE id=NEW.user_id;
  IF u_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'Portal user belongs to another organization'; END IF;
  IF TG_TABLE_NAME='client_portal_access' THEN
    SELECT org_id INTO p_org FROM projects WHERE id=NEW.project_id;
    SELECT org_id INTO c_org FROM clients WHERE id=NEW.client_id;
    IF p_org IS DISTINCT FROM NEW.org_id OR c_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'Client portal access crosses organization boundary'; END IF;
  ELSE
    SELECT org_id INTO v_org FROM vendors_subcontractors WHERE id=NEW.vendor_id;
    IF v_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'Subcontractor portal access crosses organization boundary'; END IF;
    IF NEW.subcontract_id IS NOT NULL THEN
      PERFORM 1 FROM subcontracts s WHERE s.id=NEW.subcontract_id AND s.org_id=NEW.org_id AND s.vendor_id=NEW.vendor_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Subcontractor portal package does not belong to vendor/organization'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_validate_portal_access_tenant_client ON client_portal_access;
CREATE TRIGGER trg_validate_portal_access_tenant_client BEFORE INSERT OR UPDATE ON client_portal_access FOR EACH ROW EXECUTE FUNCTION validate_portal_access_tenant();
DROP TRIGGER IF EXISTS trg_validate_portal_access_tenant_sub ON subcontractor_portal_access;
CREATE TRIGGER trg_validate_portal_access_tenant_sub BEFORE INSERT OR UPDATE ON subcontractor_portal_access FOR EACH ROW EXECUTE FUNCTION validate_portal_access_tenant();

-- RLS for portal access tables.
ALTER TABLE client_portal_access ENABLE ROW LEVEL SECURITY; ALTER TABLE client_portal_access FORCE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_portal_access ENABLE ROW LEVEL SECURITY; ALTER TABLE subcontractor_portal_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_portal_client_select ON client_portal_access;
DROP POLICY IF EXISTS tenant_portal_client_write ON client_portal_access;
CREATE POLICY tenant_portal_client_select ON client_portal_access FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint);
CREATE POLICY tenant_portal_client_write ON client_portal_access FOR ALL USING (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint);
DROP POLICY IF EXISTS tenant_portal_sub_select ON subcontractor_portal_access;
DROP POLICY IF EXISTS tenant_portal_sub_write ON subcontractor_portal_access;
CREATE POLICY tenant_portal_sub_select ON subcontractor_portal_access FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint);
CREATE POLICY tenant_portal_sub_write ON subcontractor_portal_access FOR ALL USING (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint);

-- Notification center: indexes for inbox and source drill-down.
CREATE INDEX IF NOT EXISTS idx_notifications_org_created ON notifications(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_org_user_read ON notifications(org_id, user_id, is_read, created_at DESC);

-- Report-safe views: explicitly expose organization through project joins where applicable.
CREATE OR REPLACE VIEW v_portfolio_kpis AS
SELECT p.org_id,
       count(*)::int AS project_count,
       count(*) FILTER (WHERE p.status='execution')::int AS active_projects,
       coalesce(sum(p.current_contract_value),0) AS contract_value
FROM projects p GROUP BY p.org_id;

CREATE OR REPLACE VIEW v_tender_pipeline_summary AS
SELECT org_id,
       count(*)::int AS tender_count,
       count(*) FILTER (WHERE status IN ('draft','submitted'))::int AS open_tenders,
       count(*) FILTER (WHERE status='won')::int AS won_tenders,
       coalesce(sum(estimated_value) FILTER (WHERE status IN ('draft','submitted')),0) AS open_estimated_value,
       coalesce(sum(awarded_value) FILTER (WHERE status='won'),0) AS awarded_value
FROM tenders GROUP BY org_id;

-- Notification permissions for every existing role; visibility remains row-scoped to current user.
INSERT INTO permissions(role_id,module,action,scope)
SELECT r.id,'notifications','view','own' FROM roles r ON CONFLICT (role_id,module,action) DO NOTHING;
INSERT INTO permissions(role_id,module,action,scope)
SELECT r.id,'notifications','manage','own' FROM roles r WHERE r.role_name IN ('System Admin','Project Manager','Finance Manager','General Manager') ON CONFLICT (role_id,module,action) DO NOTHING;
