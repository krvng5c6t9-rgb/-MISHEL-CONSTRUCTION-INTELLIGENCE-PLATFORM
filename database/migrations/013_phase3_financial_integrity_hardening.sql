-- ============================================================================
-- PHASE 3.1 HARDENING — FINANCIAL TENANT + CROSS-ENTITY INTEGRITY
-- Applied after Phase 2 (012). No financial source row may cross organization
-- boundaries, and tenant-linked child tables are explicitly RLS protected.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add explicit tenant keys to Phase 3 tables that previously inherited org
-- only through a parent. Existing data is backfilled before NOT NULL.
-- ---------------------------------------------------------------------------
-- Migration-time backfill must see all existing tenants. Temporarily remove FORCE
-- from referenced tables while this transaction performs the deterministic
-- backfill; FORCE is restored before the migration ends. No application query
-- runs inside this migration transaction.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','contracts','documents','clients','vendors_subcontractors','users','bank_accounts','manual_journal_entries','ipcs'] LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

ALTER TABLE manual_journal_entry_lines ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE ipc_boq_lines ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE ipc_supporting_docs ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE retention_ledger ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE bank_reconciliation ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE cash_flow_forecast ADD COLUMN IF NOT EXISTS org_id BIGINT;
ALTER TABLE cash_flow_actual ADD COLUMN IF NOT EXISTS org_id BIGINT;

UPDATE manual_journal_entry_lines l
SET org_id = e.org_id
FROM manual_journal_entries e
WHERE e.id = l.journal_entry_id AND l.org_id IS NULL;

UPDATE ipcs i
SET org_id = p.org_id
FROM projects p
WHERE p.id = i.project_id AND i.org_id IS NULL;

UPDATE ipc_boq_lines l
SET org_id = i.org_id
FROM ipcs i
WHERE i.id = l.ipc_id AND l.org_id IS NULL;

UPDATE ipc_supporting_docs d
SET org_id = i.org_id
FROM ipcs i
WHERE i.id = d.ipc_id AND d.org_id IS NULL;

UPDATE retention_ledger r
SET org_id = p.org_id
FROM projects p
WHERE p.id = r.project_id AND r.org_id IS NULL;

UPDATE bank_reconciliation r
SET org_id = b.org_id
FROM bank_accounts b
WHERE b.id = r.bank_account_id AND r.org_id IS NULL;

UPDATE cash_flow_forecast f
SET org_id = p.org_id
FROM projects p
WHERE p.id = f.project_id AND f.org_id IS NULL;

UPDATE cash_flow_actual f
SET org_id = p.org_id
FROM projects p
WHERE p.id = f.project_id AND f.org_id IS NULL;

DO $$
DECLARE t TEXT; missing_count BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['manual_journal_entry_lines','ipcs','ipc_boq_lines','ipc_supporting_docs','retention_ledger','bank_reconciliation','cash_flow_forecast','cash_flow_actual'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE org_id IS NULL', t) INTO missing_count;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'Phase 3 tenant backfill incomplete for %, % rows have NULL org_id', t, missing_count;
    END IF;
  END LOOP;
END $$;

ALTER TABLE manual_journal_entry_lines ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE ipcs ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE ipc_boq_lines ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE ipc_supporting_docs ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE retention_ledger ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE bank_reconciliation ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE cash_flow_forecast ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE cash_flow_actual ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE manual_journal_entry_lines ADD CONSTRAINT fk_mje_lines_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ipcs ADD CONSTRAINT fk_ipcs_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ipc_boq_lines ADD CONSTRAINT fk_ipc_boq_lines_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ipc_supporting_docs ADD CONSTRAINT fk_ipc_supporting_docs_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE retention_ledger ADD CONSTRAINT fk_retention_ledger_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE bank_reconciliation ADD CONSTRAINT fk_bank_reconciliation_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE cash_flow_forecast ADD CONSTRAINT fk_cash_flow_forecast_org FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE cash_flow_actual ADD CONSTRAINT fk_cash_flow_actual_org FOREIGN KEY (org_id) REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_mje_lines_org ON manual_journal_entry_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_ipcs_org ON ipcs(org_id);
CREATE INDEX IF NOT EXISTS idx_ipc_boq_lines_org ON ipc_boq_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_ipc_supporting_docs_org ON ipc_supporting_docs(org_id);
CREATE INDEX IF NOT EXISTS idx_retention_ledger_org ON retention_ledger(org_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_org ON bank_reconciliation(org_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_forecast_org ON cash_flow_forecast(org_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actual_org ON cash_flow_actual(org_id);

-- ---------------------------------------------------------------------------
-- 2. Tenant derivation/consistency trigger. This makes the explicit org_id
-- authoritative while preventing callers from supplying a mismatched tenant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_phase3_tenant_consistency()
RETURNS TRIGGER AS $$
DECLARE parent_org BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'manual_journal_entry_lines' THEN
    SELECT org_id INTO parent_org FROM manual_journal_entries WHERE id = NEW.journal_entry_id;
  ELSIF TG_TABLE_NAME = 'ipcs' THEN
    SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
    IF parent_org IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.org_id = parent_org
    ) THEN
      RAISE EXCEPTION 'IPC contract/project organization mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'ipc_boq_lines' THEN
    SELECT org_id INTO parent_org FROM ipcs WHERE id = NEW.ipc_id;
    IF parent_org IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM project_boq pb JOIN projects p ON p.id = pb.project_id
      WHERE pb.id = NEW.project_boq_item_id AND p.org_id = parent_org
    ) THEN
      RAISE EXCEPTION 'IPC BOQ line belongs to a different organization/project';
    END IF;
  ELSIF TG_TABLE_NAME = 'ipc_supporting_docs' THEN
    SELECT org_id INTO parent_org FROM ipcs WHERE id = NEW.ipc_id;
    IF parent_org IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.org_id = parent_org
    ) THEN
      RAISE EXCEPTION 'IPC supporting document belongs to a different organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'retention_ledger' THEN
    SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
    IF parent_org IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ipcs i WHERE i.id = NEW.ipc_id AND i.org_id = parent_org AND i.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'Retention ledger IPC/project mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'bank_reconciliation' THEN
    SELECT org_id INTO parent_org FROM bank_accounts WHERE id = NEW.bank_account_id;
  ELSIF TG_TABLE_NAME IN ('cash_flow_forecast','cash_flow_actual') THEN
    SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
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

DROP TRIGGER IF EXISTS trg_mje_lines_org ON manual_journal_entry_lines;
CREATE TRIGGER trg_mje_lines_org BEFORE INSERT OR UPDATE ON manual_journal_entry_lines FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();
DROP TRIGGER IF EXISTS trg_ipcs_org ON ipcs;
CREATE TRIGGER trg_ipcs_org BEFORE INSERT OR UPDATE ON ipcs FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();
DROP TRIGGER IF EXISTS trg_ipc_boq_lines_org ON ipc_boq_lines;
CREATE TRIGGER trg_ipc_boq_lines_org BEFORE INSERT OR UPDATE ON ipc_boq_lines FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();
DROP TRIGGER IF EXISTS trg_ipc_supporting_docs_org ON ipc_supporting_docs;
CREATE TRIGGER trg_ipc_supporting_docs_org BEFORE INSERT OR UPDATE ON ipc_supporting_docs FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();
DROP TRIGGER IF EXISTS trg_retention_ledger_org ON retention_ledger;
CREATE TRIGGER trg_retention_ledger_org BEFORE INSERT OR UPDATE ON retention_ledger FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();
DROP TRIGGER IF EXISTS trg_bank_reconciliation_org ON bank_reconciliation;
CREATE TRIGGER trg_bank_reconciliation_org BEFORE INSERT OR UPDATE ON bank_reconciliation FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();
DROP TRIGGER IF EXISTS trg_cash_flow_forecast_org ON cash_flow_forecast;
CREATE TRIGGER trg_cash_flow_forecast_org BEFORE INSERT OR UPDATE ON cash_flow_forecast FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();
DROP TRIGGER IF EXISTS trg_cash_flow_actual_org ON cash_flow_actual;
CREATE TRIGGER trg_cash_flow_actual_org BEFORE INSERT OR UPDATE ON cash_flow_actual FOR EACH ROW EXECUTE FUNCTION guard_phase3_tenant_consistency();

-- ---------------------------------------------------------------------------
-- 3. Financial master-data consistency: COA hierarchy and posting rules must
-- never reference another organization's accounts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_finance_master_tenant()
RETURNS TRIGGER AS $$
DECLARE org_a BIGINT; org_b BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'chart_of_accounts' THEN
    IF NEW.parent_account_id IS NOT NULL THEN
      SELECT org_id INTO org_a FROM chart_of_accounts WHERE id = NEW.parent_account_id;
      IF org_a IS NULL OR org_a <> NEW.org_id THEN
        RAISE EXCEPTION 'Parent chart-of-account belongs to another organization';
      END IF;
      IF NEW.parent_account_id = NEW.id THEN
        RAISE EXCEPTION 'Chart-of-account cannot be its own parent';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'gl_posting_rules' THEN
    SELECT org_id INTO org_a FROM chart_of_accounts WHERE id = NEW.debit_account_id;
    SELECT org_id INTO org_b FROM chart_of_accounts WHERE id = NEW.credit_account_id;
    IF org_a IS NULL OR org_b IS NULL OR org_a <> NEW.org_id OR org_b <> NEW.org_id THEN
      RAISE EXCEPTION 'GL posting rule accounts must belong to the same organization';
    END IF;
    IF NEW.effective_to IS NOT NULL AND NEW.effective_to < NEW.effective_from THEN
      RAISE EXCEPTION 'GL posting rule effective_to cannot precede effective_from';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coa_tenant_integrity ON chart_of_accounts;
CREATE TRIGGER trg_coa_tenant_integrity BEFORE INSERT OR UPDATE ON chart_of_accounts FOR EACH ROW EXECUTE FUNCTION guard_finance_master_tenant();
DROP TRIGGER IF EXISTS trg_gl_rule_tenant_integrity ON gl_posting_rules;
CREATE TRIGGER trg_gl_rule_tenant_integrity BEFORE INSERT OR UPDATE ON gl_posting_rules FOR EACH ROW EXECUTE FUNCTION guard_finance_master_tenant();

-- ---------------------------------------------------------------------------
-- 4. Financial transaction consistency: source, project, account, party and
-- bank references must all resolve to the same organization.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_financial_transaction_tenant()
RETURNS TRIGGER AS $$
DECLARE parent_org BIGINT; ref_org BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'accounts_payable' THEN
    SELECT org_id INTO ref_org FROM vendors_subcontractors WHERE id = NEW.vendor_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'AP vendor organization mismatch'; END IF;
    IF NEW.project_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'AP project organization mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'accounts_receivable' THEN
    SELECT org_id INTO ref_org FROM clients WHERE id = NEW.client_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'AR client organization mismatch'; END IF;
    SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'AR project organization mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ipcs i WHERE i.id = NEW.ipc_id AND i.org_id = NEW.org_id AND i.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'AR IPC/project organization mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    SELECT org_id INTO ref_org FROM bank_accounts WHERE id = NEW.bank_account_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'Payment bank account organization mismatch'; END IF;
    IF NEW.related_ap_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts_payable ap WHERE ap.id = NEW.related_ap_id AND ap.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment AP organization mismatch';
    END IF;
    IF NEW.related_ar_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts_receivable ar WHERE ar.id = NEW.related_ar_id AND ar.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment AR organization mismatch';
    END IF;
    IF NEW.party_type = 'client' AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.party_id AND c.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment client organization mismatch';
    END IF;
    IF NEW.party_type = 'vendor' AND NOT EXISTS (SELECT 1 FROM vendors_subcontractors v WHERE v.id = NEW.party_id AND v.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment vendor organization mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'general_ledger' THEN
    SELECT org_id INTO ref_org FROM chart_of_accounts WHERE id = NEW.account_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'GL account organization mismatch'; END IF;
    IF NEW.project_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'GL project organization mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'manual_journal_entries' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'Manual journal project organization mismatch'; END IF;
    END IF;
    SELECT org_id INTO ref_org FROM users WHERE id = NEW.requested_by;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'Manual journal requester organization mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ap_finance_integrity ON accounts_payable;
CREATE TRIGGER trg_ap_finance_integrity BEFORE INSERT OR UPDATE ON accounts_payable FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_tenant();
DROP TRIGGER IF EXISTS trg_ar_finance_integrity ON accounts_receivable;
CREATE TRIGGER trg_ar_finance_integrity BEFORE INSERT OR UPDATE ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_tenant();
DROP TRIGGER IF EXISTS trg_payments_finance_integrity ON payments;
CREATE TRIGGER trg_payments_finance_integrity BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_tenant();
DROP TRIGGER IF EXISTS trg_gl_finance_integrity ON general_ledger;
CREATE TRIGGER trg_gl_finance_integrity BEFORE INSERT OR UPDATE ON general_ledger FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_tenant();
DROP TRIGGER IF EXISTS trg_mje_finance_integrity ON manual_journal_entries;
CREATE TRIGGER trg_mje_finance_integrity BEFORE INSERT OR UPDATE ON manual_journal_entries FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction_tenant();

-- ---------------------------------------------------------------------------
-- 5. RLS for every Phase 3 tenant-bearing table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chart_of_accounts','gl_posting_rules','general_ledger','manual_journal_entries',
    'manual_journal_entry_lines','ipcs','ipc_boq_lines','ipc_supporting_docs',
    'retention_ledger','accounts_payable','accounts_receivable','bank_accounts',
    'payments','bank_reconciliation','cash_flow_forecast','cash_flow_actual','company_cash_position'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS phase3_tenant_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS phase3_tenant_write ON %I', t);
    EXECUTE format($f$CREATE POLICY phase3_tenant_select ON %I FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$f$, t);
    EXECUTE format($f$CREATE POLICY phase3_tenant_write ON %I FOR ALL USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)$f$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Basic financial arithmetic invariants.
-- ---------------------------------------------------------------------------
ALTER TABLE ipcs DROP CONSTRAINT IF EXISTS ipcs_period_order_check;
ALTER TABLE ipcs ADD CONSTRAINT ipcs_period_order_check CHECK (period_to >= period_from);
ALTER TABLE ipcs DROP CONSTRAINT IF EXISTS ipcs_net_nonnegative_check;
ALTER TABLE ipcs ADD CONSTRAINT ipcs_net_nonnegative_check CHECK (net_amount_due >= 0);
ALTER TABLE ipc_boq_lines DROP CONSTRAINT IF EXISTS ipc_boq_qty_nonnegative_check;
ALTER TABLE ipc_boq_lines ADD CONSTRAINT ipc_boq_qty_nonnegative_check CHECK (quantity_this_period >= 0 AND cumulative_quantity >= quantity_this_period);
ALTER TABLE retention_ledger DROP CONSTRAINT IF EXISTS retention_amount_positive_check;
ALTER TABLE retention_ledger ADD CONSTRAINT retention_amount_positive_check CHECK (retained_amount >= 0);
ALTER TABLE accounts_payable DROP CONSTRAINT IF EXISTS ap_amount_positive_check;
ALTER TABLE accounts_payable ADD CONSTRAINT ap_amount_positive_check CHECK (amount > 0);
ALTER TABLE accounts_receivable DROP CONSTRAINT IF EXISTS ar_amount_positive_check;
ALTER TABLE accounts_receivable ADD CONSTRAINT ar_amount_positive_check CHECK (amount > 0);
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_positive_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive_check CHECK (amount > 0);

-- ---------------------------------------------------------------------------
-- 7. Cash-flow rollups are not source-of-truth: prevent contradictory negative
-- values and keep month convention explicit.
-- ---------------------------------------------------------------------------
ALTER TABLE cash_flow_forecast DROP CONSTRAINT IF EXISTS cash_flow_forecast_nonnegative_check;
ALTER TABLE cash_flow_forecast ADD CONSTRAINT cash_flow_forecast_nonnegative_check CHECK (forecast_inflow >= 0 AND forecast_outflow >= 0);
ALTER TABLE cash_flow_actual DROP CONSTRAINT IF EXISTS cash_flow_actual_nonnegative_check;
ALTER TABLE cash_flow_actual ADD CONSTRAINT cash_flow_actual_nonnegative_check CHECK (actual_inflow >= 0 AND actual_outflow >= 0);

-- Restore forced tenant enforcement on referenced existing tables after the
-- migration-time backfill. The Phase 3 loop below also FORCE-enables new tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','contracts','documents','clients','vendors_subcontractors','users','bank_accounts','manual_journal_entries','ipcs'] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. GL batch integrity: every line in a batch must share org/currency/source.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_gl_batch_integrity()
RETURNS TRIGGER AS $$
DECLARE bad_count BIGINT;
BEGIN
  SELECT count(*) INTO bad_count
  FROM general_ledger
  WHERE journal_batch_id = NEW.journal_batch_id
    AND (org_id <> NEW.org_id OR currency_id <> NEW.currency_id OR source_module <> NEW.source_module
         OR source_table <> NEW.source_table OR source_record_id <> NEW.source_record_id);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'GL journal batch % contains inconsistent tenant/currency/source metadata', NEW.journal_batch_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_gl_batch_integrity ON general_ledger;
CREATE CONSTRAINT TRIGGER trg_check_gl_batch_integrity
AFTER INSERT ON general_ledger DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_gl_batch_integrity();
