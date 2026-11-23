-- Stage 69 / CC-098 (owner instruction 2026-11-23: the program as a whole, global level; Excel among the tools to
-- integrate): Excel (.xlsx) import and export of master data and bills of quantities.
-- (transaction managed by migrator)
-- Before (E3 @CC-097): records were entered one by one on the screens (the go-live cut-over took pasted tables);
-- nothing was exported to or imported from a spreadsheet file.
-- Now: data_imports - a permanent record of every saved import (entity, scope, file name, SHA-256, rows, who). The rows
-- themselves are created by the same insert and validation code as the screens (one transaction, all or nothing).
-- Rollback: drop data_imports.
CREATE TABLE IF NOT EXISTS data_imports (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  entity VARCHAR(20) NOT NULL CHECK (entity IN ('clients', 'vendors', 'cost_codes', 'boq')),
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_name VARCHAR(255) NOT NULL,
  file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  rows_count INTEGER NOT NULL CHECK (rows_count > 0),
  imported_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON data_imports;
DROP POLICY IF EXISTS tenant_isolation_write ON data_imports;
CREATE POLICY tenant_isolation_select ON data_imports FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON data_imports FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_data_imports ON data_imports;
CREATE TRIGGER trg_audit_data_imports AFTER INSERT OR UPDATE OR DELETE ON data_imports FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();
CREATE OR REPLACE FUNCTION guard_data_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Data import records are permanent'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_data_import ON data_imports;
CREATE TRIGGER trg_guard_data_import BEFORE INSERT OR UPDATE OR DELETE ON data_imports FOR EACH ROW EXECUTE FUNCTION guard_data_import();
