-- Stage 71 / CC-107 (OVD-003 §2 "built-in search ... approved suppliers - this is the beginning"; MP-08 W2):
-- the MARC supplier directory for construction, finishing, building materials, MEP, electrical, lifts, low current and
-- infrastructure, shared by all companies, plus each company's adoption of a directory supplier into its own vendors.
-- (transaction managed by migrator)
-- Before (E3 @CC-106): each company kept only its own vendors (vendors_subcontractors); no market directory.
-- Now:
--  * directory_trades: the trade taxonomy (code, parent, English and Arabic names) - platform data, read-only to companies.
--  * directory_suppliers: platform-level supplier records (country EG / SA / AE, name, city, address, phones, e-mail,
--    website, description) with their provenance: source, source id, source URL, collection time, licence status and
--    verification status. Loaded by the platform tool (tools/directory), never written through the company API.
--  * directory_supplier_trades: supplier <-> trade.
--  * directory_imports: one record per loaded file (SHA-256, rows) - permanent.
--  * vendor_directory_links: a company's vendor created from a directory supplier (tenant table, RLS).
-- Directory tables carry no org_id: every company may read them; FORCE RLS with a read-only policy blocks any write by
-- the application role (writes only by the owner role used by the loader).
-- Rollback: drop the five tables.

CREATE TABLE IF NOT EXISTS directory_trades (
  code VARCHAR(40) PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  parent_code VARCHAR(40) REFERENCES directory_trades(code),
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS directory_imports (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR(60) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  rows_loaded INTEGER NOT NULL CHECK (rows_loaded >= 0),
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS directory_suppliers (
  id BIGSERIAL PRIMARY KEY,
  country CHAR(2) NOT NULL CHECK (country IN ('EG', 'SA', 'AE')),
  name VARCHAR(300) NOT NULL CHECK (length(trim(name)) >= 2),
  city VARCHAR(120),
  address TEXT,
  phones TEXT[] NOT NULL DEFAULT '{}',
  email VARCHAR(200),
  website VARCHAR(400),
  description TEXT,
  source VARCHAR(60) NOT NULL,
  source_id VARCHAR(120) NOT NULL,
  source_url VARCHAR(600) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  licence_status VARCHAR(200) NOT NULL,
  verification_status VARCHAR(12) NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  import_id BIGINT REFERENCES directory_imports(id),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS ix_directory_suppliers_country_city ON directory_suppliers (country, lower(city));
CREATE INDEX IF NOT EXISTS ix_directory_suppliers_name ON directory_suppliers (lower(name));
CREATE TABLE IF NOT EXISTS directory_supplier_trades (
  supplier_id BIGINT NOT NULL REFERENCES directory_suppliers(id) ON DELETE CASCADE,
  trade_code VARCHAR(40) NOT NULL REFERENCES directory_trades(code),
  PRIMARY KEY (supplier_id, trade_code)
);
CREATE INDEX IF NOT EXISTS ix_directory_supplier_trades_trade ON directory_supplier_trades (trade_code, supplier_id);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['directory_trades', 'directory_imports', 'directory_suppliers', 'directory_supplier_trades'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS directory_read_only ON %I', t);
    EXECUTE format('CREATE POLICY directory_read_only ON %I FOR SELECT USING (true)', t);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS vendor_directory_links (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  vendor_id BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
  directory_supplier_id BIGINT NOT NULL REFERENCES directory_suppliers(id),
  adopted_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, directory_supplier_id),
  UNIQUE (vendor_id)
);
ALTER TABLE vendor_directory_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_directory_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON vendor_directory_links;
DROP POLICY IF EXISTS tenant_isolation_write ON vendor_directory_links;
CREATE POLICY tenant_isolation_select ON vendor_directory_links FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON vendor_directory_links FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_vendor_directory_links ON vendor_directory_links;
CREATE TRIGGER trg_audit_vendor_directory_links AFTER INSERT OR UPDATE OR DELETE ON vendor_directory_links FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();
CREATE OR REPLACE FUNCTION guard_vendor_directory_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'A directory link is permanent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vendors_subcontractors v WHERE v.id = NEW.vendor_id AND v.org_id = NEW.org_id) THEN RAISE EXCEPTION 'Vendor not found in this company'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_vendor_directory_link ON vendor_directory_links;
CREATE TRIGGER trg_guard_vendor_directory_link BEFORE INSERT OR UPDATE OR DELETE ON vendor_directory_links FOR EACH ROW EXECUTE FUNCTION guard_vendor_directory_link();
