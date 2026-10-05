-- (transaction managed by migrator)

-- Inventory / warehouse control
CREATE TABLE IF NOT EXISTS warehouses (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), project_id BIGINT REFERENCES projects(id),
  code VARCHAR(30) NOT NULL, name VARCHAR(150) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(org_id, code)
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), item_code VARCHAR(50) NOT NULL,
  description TEXT NOT NULL, unit_of_measure VARCHAR(20) NOT NULL, cost_code_id BIGINT REFERENCES cost_codes(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(org_id,item_code)
);
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  project_id BIGINT REFERENCES projects(id), inventory_item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  transaction_type VARCHAR(20) NOT NULL CHECK(transaction_type IN ('receipt','issue','transfer_in','transfer_out','adjustment')),
  quantity NUMERIC(18,3) NOT NULL CHECK(quantity <> 0), unit_cost NUMERIC(18,4), transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_table VARCHAR(80), source_record_id BIGINT, created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_wh_item ON inventory_transactions(warehouse_id,inventory_item_id,transaction_date);

-- GRN to inventory mapping and auditable 3-way match results
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS org_id BIGINT REFERENCES organizations(id);
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS warehouse_id BIGINT REFERENCES warehouses(id);
ALTER TABLE grn_lines ADD COLUMN IF NOT EXISTS inventory_item_id BIGINT REFERENCES inventory_items(id);
CREATE TABLE IF NOT EXISTS invoice_match_results (
 id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), vendor_invoice_id BIGINT NOT NULL REFERENCES vendor_invoices(id),
 po_id BIGINT NOT NULL REFERENCES purchase_orders(id), grn_id BIGINT NOT NULL REFERENCES goods_receipt_notes(id),
 po_amount NUMERIC(18,2) NOT NULL, accepted_grn_amount NUMERIC(18,2) NOT NULL, invoice_amount NUMERIC(18,2) NOT NULL,
 variance_amount NUMERIC(18,2) NOT NULL, tolerance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 result VARCHAR(20) NOT NULL CHECK(result IN ('matched','variance','failed')), details JSONB NOT NULL DEFAULT '{}'::jsonb,
 matched_by BIGINT REFERENCES users(id), matched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accounting periods and historical FX rates
CREATE TABLE IF NOT EXISTS fiscal_periods (
 id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), fiscal_year INT NOT NULL,
 period_no INT NOT NULL CHECK(period_no BETWEEN 1 AND 13), start_date DATE NOT NULL, end_date DATE NOT NULL,
 status VARCHAR(15) NOT NULL DEFAULT 'open' CHECK(status IN ('open','soft_closed','closed')),
 closed_by BIGINT REFERENCES users(id), closed_at TIMESTAMPTZ, UNIQUE(org_id,fiscal_year,period_no), CHECK(end_date>=start_date)
);
CREATE TABLE IF NOT EXISTS exchange_rates (
 id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), currency_id BIGINT NOT NULL REFERENCES currencies(id),
 rate_date DATE NOT NULL, rate_to_base NUMERIC(20,8) NOT NULL CHECK(rate_to_base>0), source VARCHAR(100),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(org_id,currency_id,rate_date)
);

-- Claims / EOT register: contractual record, not a scheduling calculation engine.
CREATE TABLE IF NOT EXISTS contract_claims (
 id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), project_id BIGINT NOT NULL REFERENCES projects(id),
 contract_id BIGINT REFERENCES contracts(id), claim_no VARCHAR(40) NOT NULL, claim_type VARCHAR(20) NOT NULL CHECK(claim_type IN ('eot','cost','combined','other')),
 title VARCHAR(200) NOT NULL, event_date DATE, notice_date DATE, claimed_days INT NOT NULL DEFAULT 0, claimed_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
 approved_days INT, approved_amount NUMERIC(18,2), status VARCHAR(25) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','notified','submitted','under_review','approved','partially_approved','rejected','withdrawn')),
 basis TEXT, created_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(project_id,claim_no)
);

-- Tenant policies for newly introduced org-scoped tables.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['warehouses','inventory_items','inventory_transactions','invoice_match_results','fiscal_periods','exchange_rates','contract_claims'] LOOP
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I',t);
   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I',t);
   EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id = NULLIF(current_setting(''app.org_id'',true),'''')::bigint)',t);
   EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id = NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'',true),'''')::bigint)',t);
 END LOOP;
END $$;
-- (transaction managed by migrator)
