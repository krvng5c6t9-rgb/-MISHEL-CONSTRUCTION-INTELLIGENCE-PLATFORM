-- (transaction managed by migrator)

-- Final pre-run tenant hardening for core relationship-owned tables that historically
-- relied on joins to tenant-owned parents. Every live operational row now owns org_id.

ALTER TABLE permissions              ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE approval_actions_log     ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE boq_rate_buildup         ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE material_requisitions    ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE mr_lines                 ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE rfqs                     ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE rfq_vendors              ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE vendor_quotations        ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE comparative_statements   ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE purchase_orders          ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE po_lines                 ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE goods_receipt_notes      ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE grn_lines                ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE vendor_invoices          ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE cost_transactions        ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE budgets                  ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);

-- Deterministic backfill from trusted tenant-owned parents.
UPDATE permissions p SET org_id=r.org_id FROM roles r WHERE r.id=p.role_id AND p.org_id IS NULL;
UPDATE approval_actions_log a SET org_id=i.org_id FROM approval_instances i WHERE i.id=a.approval_instance_id AND a.org_id IS NULL;
UPDATE boq_rate_buildup b SET org_id=m.org_id FROM boq_master m WHERE m.id=b.boq_master_id AND b.org_id IS NULL;
UPDATE material_requisitions x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;
UPDATE mr_lines x SET org_id=m.org_id FROM material_requisitions m WHERE m.id=x.mr_id AND x.org_id IS NULL;
UPDATE rfqs x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;
UPDATE rfq_vendors x SET org_id=r.org_id FROM rfqs r WHERE r.id=x.rfq_id AND x.org_id IS NULL;
UPDATE vendor_quotations x SET org_id=r.org_id FROM rfqs r WHERE r.id=x.rfq_id AND x.org_id IS NULL;
UPDATE comparative_statements x SET org_id=r.org_id FROM rfqs r WHERE r.id=x.rfq_id AND x.org_id IS NULL;
UPDATE purchase_orders x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;
UPDATE po_lines x SET org_id=p.org_id FROM purchase_orders p WHERE p.id=x.po_id AND x.org_id IS NULL;
UPDATE goods_receipt_notes x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;
UPDATE grn_lines x SET org_id=g.org_id FROM goods_receipt_notes g WHERE g.id=x.grn_id AND x.org_id IS NULL;
UPDATE vendor_invoices x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;
UPDATE cost_transactions x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;
UPDATE budgets x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permissions','approval_actions_log','boq_rate_buildup','material_requisitions','mr_lines','rfqs',
    'rfq_vendors','vendor_quotations','comparative_statements','purchase_orders','po_lines',
    'goods_receipt_notes','grn_lines','vendor_invoices','cost_transactions','budgets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET DEFAULT NULLIF(current_setting(''app.org_id'',true),'''')::bigint', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(org_id)', 'idx_'||t||'_org', t);
  END LOOP;
END $$;

-- Parent-derived tenant guard. It both supplies org_id for legacy INSERT statements and
-- rejects cross-tenant references before a row reaches business logic.
CREATE OR REPLACE FUNCTION enforce_core_parent_tenant_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_org bigint;
  other_org bigint;
  current_org bigint := NULLIF(current_setting('app.org_id', true),'')::bigint;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'permissions' THEN
      SELECT org_id INTO parent_org FROM roles WHERE id=NEW.role_id;
    WHEN 'approval_actions_log' THEN
      SELECT org_id INTO parent_org FROM approval_instances WHERE id=NEW.approval_instance_id;
    WHEN 'boq_rate_buildup' THEN
      SELECT org_id INTO parent_org FROM boq_master WHERE id=NEW.boq_master_id;
      IF NEW.resource_id IS NOT NULL THEN
        SELECT org_id INTO other_org FROM resource_library WHERE id=NEW.resource_id;
        IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant resource on BOQ rate buildup'; END IF;
      END IF;
    WHEN 'material_requisitions' THEN
      SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
      IF NEW.cost_code_id IS NOT NULL THEN SELECT org_id INTO other_org FROM cost_codes WHERE id=NEW.cost_code_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant cost code on MR'; END IF; END IF;
      IF NEW.boq_item_id IS NOT NULL THEN SELECT org_id INTO other_org FROM project_boq WHERE id=NEW.boq_item_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant BOQ item on MR'; END IF; END IF;
    WHEN 'mr_lines' THEN
      SELECT org_id INTO parent_org FROM material_requisitions WHERE id=NEW.mr_id;
    WHEN 'rfqs' THEN
      SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
      IF NEW.mr_id IS NOT NULL THEN SELECT org_id INTO other_org FROM material_requisitions WHERE id=NEW.mr_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant MR on RFQ'; END IF; END IF;
    WHEN 'rfq_vendors' THEN
      SELECT org_id INTO parent_org FROM rfqs WHERE id=NEW.rfq_id;
      SELECT org_id INTO other_org FROM vendors_subcontractors WHERE id=NEW.vendor_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant vendor on RFQ'; END IF;
    WHEN 'vendor_quotations' THEN
      SELECT org_id INTO parent_org FROM rfqs WHERE id=NEW.rfq_id;
      SELECT org_id INTO other_org FROM vendors_subcontractors WHERE id=NEW.vendor_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant vendor quotation'; END IF;
    WHEN 'comparative_statements' THEN
      SELECT org_id INTO parent_org FROM rfqs WHERE id=NEW.rfq_id;
      IF NEW.recommended_vendor_id IS NOT NULL THEN SELECT org_id INTO other_org FROM vendors_subcontractors WHERE id=NEW.recommended_vendor_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant recommended vendor'; END IF; END IF;
    WHEN 'purchase_orders' THEN
      SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
      SELECT org_id INTO other_org FROM vendors_subcontractors WHERE id=NEW.vendor_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant vendor on PO'; END IF;
      IF NEW.mr_id IS NOT NULL THEN SELECT org_id INTO other_org FROM material_requisitions WHERE id=NEW.mr_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant MR on PO'; END IF; END IF;
      IF NEW.cost_code_id IS NOT NULL THEN SELECT org_id INTO other_org FROM cost_codes WHERE id=NEW.cost_code_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant cost code on PO'; END IF; END IF;
    WHEN 'po_lines' THEN
      SELECT org_id INTO parent_org FROM purchase_orders WHERE id=NEW.po_id;
      IF NEW.boq_item_id IS NOT NULL THEN SELECT org_id INTO other_org FROM project_boq WHERE id=NEW.boq_item_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant BOQ item on PO line'; END IF; END IF;
    WHEN 'goods_receipt_notes' THEN
      SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
      SELECT org_id INTO other_org FROM purchase_orders WHERE id=NEW.po_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant PO on GRN'; END IF;
      IF NEW.warehouse_id IS NOT NULL THEN SELECT org_id INTO other_org FROM warehouses WHERE id=NEW.warehouse_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant warehouse on GRN'; END IF; END IF;
    WHEN 'grn_lines' THEN
      SELECT org_id INTO parent_org FROM goods_receipt_notes WHERE id=NEW.grn_id;
      SELECT p.org_id INTO other_org FROM po_lines l JOIN purchase_orders p ON p.id=l.po_id WHERE l.id=NEW.po_line_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant PO line on GRN line'; END IF;
      IF NEW.inventory_item_id IS NOT NULL THEN SELECT org_id INTO other_org FROM inventory_items WHERE id=NEW.inventory_item_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant inventory item on GRN line'; END IF; END IF;
    WHEN 'vendor_invoices' THEN
      SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
      SELECT org_id INTO other_org FROM vendors_subcontractors WHERE id=NEW.vendor_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant vendor on invoice'; END IF;
      IF NEW.po_id IS NOT NULL THEN SELECT org_id INTO other_org FROM purchase_orders WHERE id=NEW.po_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant PO on invoice'; END IF; END IF;
      IF NEW.matched_grn_id IS NOT NULL THEN SELECT org_id INTO other_org FROM goods_receipt_notes WHERE id=NEW.matched_grn_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant GRN on invoice'; END IF; END IF;
    WHEN 'cost_transactions' THEN
      SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
      SELECT org_id INTO other_org FROM cost_codes WHERE id=NEW.cost_code_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant cost code on cost transaction'; END IF;
      IF NEW.boq_item_id IS NOT NULL THEN SELECT org_id INTO other_org FROM project_boq WHERE id=NEW.boq_item_id; IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant BOQ item on cost transaction'; END IF; END IF;
    WHEN 'budgets' THEN
      SELECT org_id INTO parent_org FROM projects WHERE id=NEW.project_id;
      SELECT org_id INTO other_org FROM cost_codes WHERE id=NEW.cost_code_id;
      IF other_org IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'Cross-tenant cost code on budget'; END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported tenant-guard table %', TG_TABLE_NAME;
  END CASE;

  IF parent_org IS NULL THEN RAISE EXCEPTION 'Tenant parent not found for %', TG_TABLE_NAME; END IF;
  IF current_org IS NOT NULL AND parent_org IS DISTINCT FROM current_org THEN RAISE EXCEPTION 'Cross-tenant write blocked on %', TG_TABLE_NAME; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM parent_org THEN RAISE EXCEPTION 'org_id mismatch on %', TG_TABLE_NAME; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'permissions','approval_actions_log','boq_rate_buildup','material_requisitions','mr_lines','rfqs',
    'rfq_vendors','vendor_quotations','comparative_statements','purchase_orders','po_lines',
    'goods_receipt_notes','grn_lines','vendor_invoices','cost_transactions','budgets'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_core_parent_tenant_integrity ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_core_parent_tenant_integrity BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_core_parent_tenant_integrity()', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

-- (transaction managed by migrator)
