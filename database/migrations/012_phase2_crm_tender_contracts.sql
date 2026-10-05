-- ============================================================================
-- CONSTRUCTION ERP — PHASE 2
-- CRM + TENDERING + CONTRACTS / VARIATIONS HARDENING
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 2.1 Tenant keys for previously parent-linked records
-- ---------------------------------------------------------------------------
ALTER TABLE lead_activities ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE tender_documents ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE tender_clarifications ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE contract_clauses ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE variations ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE variation_boq_lines ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE boq_master ADD COLUMN IF NOT EXISTS org_id BIGINT;

UPDATE lead_activities la
SET org_id = l.org_id
FROM leads l
WHERE l.id = la.lead_id AND la.org_id IS NULL;

UPDATE opportunities o
SET org_id = l.org_id
FROM leads l
WHERE l.id = o.lead_id AND o.org_id IS NULL;

UPDATE tender_documents td
SET org_id = t.org_id
FROM tenders t
WHERE t.id = td.tender_id AND td.org_id IS NULL;

UPDATE tender_clarifications tc
SET org_id = t.org_id
FROM tenders t
WHERE t.id = tc.tender_id AND tc.org_id IS NULL;

UPDATE contracts c
SET org_id = p.org_id
FROM projects p
WHERE p.id = c.project_id AND c.org_id IS NULL;

UPDATE contract_clauses cc
SET org_id = c.org_id
FROM contracts c
WHERE c.id = cc.contract_id AND cc.org_id IS NULL;

UPDATE variations v
SET org_id = p.org_id
FROM projects p
WHERE p.id = v.project_id AND v.org_id IS NULL;

UPDATE variation_boq_lines vbl
SET org_id = v.org_id
FROM variations v
WHERE v.id = vbl.variation_id AND vbl.org_id IS NULL;

-- Normalize explicitly from the tender first and project second.
UPDATE boq_master bm
SET org_id = t.org_id
FROM tenders t
WHERE bm.org_id IS NULL AND bm.tender_id = t.id;
UPDATE boq_master bm
SET org_id = p.org_id
FROM projects p
WHERE bm.org_id IS NULL AND bm.project_id = p.id;

ALTER TABLE lead_activities ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE opportunities ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE tender_documents ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE tender_clarifications ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE contracts ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE contract_clauses ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE variations ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE variation_boq_lines ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE boq_master ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE lead_activities ADD CONSTRAINT fk_lead_activities_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE opportunities ADD CONSTRAINT fk_opportunities_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE tender_documents ADD CONSTRAINT fk_tender_documents_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE tender_clarifications ADD CONSTRAINT fk_tender_clarifications_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE contracts ADD CONSTRAINT fk_contracts_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE contract_clauses ADD CONSTRAINT fk_contract_clauses_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE variations ADD CONSTRAINT fk_variations_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE variation_boq_lines ADD CONSTRAINT fk_variation_boq_lines_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE boq_master ADD CONSTRAINT fk_boq_master_org FOREIGN KEY (org_id) REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_lead_activities_org ON lead_activities(org_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_org ON opportunities(org_id);
CREATE INDEX IF NOT EXISTS idx_tender_documents_org ON tender_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_tender_clarifications_org ON tender_clarifications(org_id);
CREATE INDEX IF NOT EXISTS idx_contracts_org ON contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_contract_clauses_org ON contract_clauses(org_id);
CREATE INDEX IF NOT EXISTS idx_variations_org ON variations(org_id);
CREATE INDEX IF NOT EXISTS idx_variation_boq_lines_org ON variation_boq_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_boq_master_org ON boq_master(org_id);

-- ---------------------------------------------------------------------------
-- 2.2 Parent/child tenant consistency guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_crm_tenant_consistency()
RETURNS TRIGGER AS $$
DECLARE parent_org BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'lead_activities' THEN
    SELECT org_id INTO parent_org FROM leads WHERE id = NEW.lead_id;
  ELSIF TG_TABLE_NAME = 'opportunities' THEN
    SELECT org_id INTO parent_org FROM leads WHERE id = NEW.lead_id;
  ELSIF TG_TABLE_NAME = 'tender_documents' THEN
    SELECT org_id INTO parent_org FROM tenders WHERE id = NEW.tender_id;
  ELSIF TG_TABLE_NAME = 'tender_clarifications' THEN
    SELECT org_id INTO parent_org FROM tenders WHERE id = NEW.tender_id;
  ELSIF TG_TABLE_NAME = 'contracts' THEN
    SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
    IF NEW.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.org_id = parent_org
    ) THEN
      RAISE EXCEPTION 'Contract client belongs to a different organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'contract_clauses' THEN
    SELECT org_id INTO parent_org FROM contracts WHERE id = NEW.contract_id;
  ELSIF TG_TABLE_NAME = 'variations' THEN
    SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
    IF NOT EXISTS (
      SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.org_id = parent_org
    ) THEN
      RAISE EXCEPTION 'Variation contract belongs to a different organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'variation_boq_lines' THEN
    SELECT org_id INTO parent_org FROM variations WHERE id = NEW.variation_id;
  ELSIF TG_TABLE_NAME = 'boq_master' THEN
    IF NEW.tender_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM tenders WHERE id = NEW.tender_id;
    ELSE
      SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
    END IF;
  END IF;

  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'Parent record not found for %', TG_TABLE_NAME;
  END IF;
  IF NEW.org_id <> parent_org THEN
    RAISE EXCEPTION 'Organization mismatch on %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_activities_org ON lead_activities;
CREATE TRIGGER trg_lead_activities_org BEFORE INSERT OR UPDATE ON lead_activities FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_opportunities_org ON opportunities;
CREATE TRIGGER trg_opportunities_org BEFORE INSERT OR UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_tender_documents_org ON tender_documents;
CREATE TRIGGER trg_tender_documents_org BEFORE INSERT OR UPDATE ON tender_documents FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_tender_clarifications_org ON tender_clarifications;
CREATE TRIGGER trg_tender_clarifications_org BEFORE INSERT OR UPDATE ON tender_clarifications FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_contracts_org ON contracts;
CREATE TRIGGER trg_contracts_org BEFORE INSERT OR UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_contract_clauses_org ON contract_clauses;
CREATE TRIGGER trg_contract_clauses_org BEFORE INSERT OR UPDATE ON contract_clauses FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_variations_org ON variations;
CREATE TRIGGER trg_variations_org BEFORE INSERT OR UPDATE ON variations FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_variation_boq_lines_org ON variation_boq_lines;
CREATE TRIGGER trg_variation_boq_lines_org BEFORE INSERT OR UPDATE ON variation_boq_lines FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();
DROP TRIGGER IF EXISTS trg_boq_master_org ON boq_master;
CREATE TRIGGER trg_boq_master_org BEFORE INSERT OR UPDATE ON boq_master FOR EACH ROW EXECUTE FUNCTION guard_crm_tenant_consistency();

-- ---------------------------------------------------------------------------
-- 2.3 State-machine guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_phase2_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'leads' AND NEW.stage <> OLD.stage THEN
    IF NOT ((OLD.stage='new' AND NEW.stage IN ('qualified','lost'))
         OR (OLD.stage='qualified' AND NEW.stage IN ('proposal','lost'))
         OR (OLD.stage='proposal' AND NEW.stage IN ('won','lost'))
         OR (OLD.stage='lost' AND NEW.stage='new')) THEN
      RAISE EXCEPTION 'Illegal lead stage transition: % -> %', OLD.stage, NEW.stage;
    END IF;
  ELSIF TG_TABLE_NAME = 'tenders' AND NEW.status <> OLD.status THEN
    IF NOT ((OLD.status='invited' AND NEW.status IN ('in_progress','withdrawn'))
         OR (OLD.status='in_progress' AND NEW.status IN ('submitted','withdrawn'))
         OR (OLD.status='submitted' AND NEW.status IN ('won','lost','withdrawn'))
         OR (OLD.status='lost' AND NEW.status='in_progress')) THEN
      RAISE EXCEPTION 'Illegal tender status transition: % -> %', OLD.status, NEW.status;
    END IF;
    IF NEW.status='won' AND (NEW.awarded_value IS NULL OR NEW.awarded_value < 0) THEN
      RAISE EXCEPTION 'Won tender requires awarded_value';
    END IF;
    IF NEW.status='lost' AND (NEW.loss_reason IS NULL OR btrim(NEW.loss_reason)='') THEN
      RAISE EXCEPTION 'Lost tender requires loss_reason';
    END IF;
  ELSIF TG_TABLE_NAME = 'contracts' AND NEW.contract_status <> OLD.contract_status THEN
    IF NOT ((OLD.contract_status='draft' AND NEW.contract_status='under_review')
         OR (OLD.contract_status='under_review' AND NEW.contract_status IN ('signed','draft'))
         OR (OLD.contract_status='signed' AND NEW.contract_status='active')
         OR (OLD.contract_status='active' AND NEW.contract_status IN ('closed','terminated'))) THEN
      RAISE EXCEPTION 'Illegal contract status transition: % -> %', OLD.contract_status, NEW.contract_status;
    END IF;
  ELSIF TG_TABLE_NAME = 'variations' AND NEW.status <> OLD.status THEN
    IF NOT ((OLD.status='proposed' AND NEW.status='under_review')
         OR (OLD.status='under_review' AND NEW.status IN ('approved','rejected'))
         OR (OLD.status='rejected' AND NEW.status='proposed')) THEN
      RAISE EXCEPTION 'Illegal variation status transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_status ON leads;
CREATE TRIGGER trg_leads_status BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION guard_phase2_status();
DROP TRIGGER IF EXISTS trg_tenders_status ON tenders;
CREATE TRIGGER trg_tenders_status BEFORE UPDATE ON tenders FOR EACH ROW EXECUTE FUNCTION guard_phase2_status();
DROP TRIGGER IF EXISTS trg_contracts_status ON contracts;
CREATE TRIGGER trg_contracts_status BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION guard_phase2_status();
DROP TRIGGER IF EXISTS trg_variations_status ON variations;
CREATE TRIGGER trg_variations_status BEFORE UPDATE ON variations FOR EACH ROW EXECUTE FUNCTION guard_phase2_status();

-- ---------------------------------------------------------------------------
-- 2.4 RLS for Phase 2 tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','lead_activities','opportunities','tenders','tender_documents','tender_clarifications','boq_master','contracts','contract_clauses','variations','variation_boq_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS phase2_tenant_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS phase2_tenant_write ON %I', t);
    EXECUTE format($f$CREATE POLICY phase2_tenant_select ON %I FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$f$, t);
    EXECUTE format($f$CREATE POLICY phase2_tenant_write ON %I FOR ALL USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$f$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2.5 Permissions for Phase 2 modules
-- ---------------------------------------------------------------------------
INSERT INTO permissions (role_id, module, action, scope)
SELECT r.id, x.module, x.action, 'all'
FROM roles r
CROSS JOIN (VALUES
  ('crm','view'),('crm','create'),('crm','edit'),('crm','delete'),('crm','export'),
  ('tendering','view'),('tendering','create'),('tendering','edit'),('tendering','approve'),('tendering','delete'),('tendering','export'),
  ('contracts','view'),('contracts','create'),('contracts','edit'),('contracts','approve'),('contracts','delete'),('contracts','export')
) x(module, action)
WHERE r.role_name IN ('System Admin','BD Manager','Tendering Manager','Chief Estimator','QS','Contracts Manager','Project Manager')
ON CONFLICT (role_id, module, action) DO NOTHING;

-- Approval permissions for the existing workflow endpoint.
INSERT INTO permissions (role_id, module, action, scope)
SELECT r.id, 'approvals', 'approve', 'all'
FROM roles r
WHERE r.role_name IN ('System Admin','BD Manager','Tendering Manager','Contracts Manager','Project Manager','General Manager')
ON CONFLICT (role_id, module, action) DO NOTHING;

-- Phase 2 DOA/workflow seed is deliberately not duplicated here; existing
-- contract_signing / tender_submission rows remain configurable company policy.
