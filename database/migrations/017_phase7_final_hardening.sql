-- PHASE 7 — Final integration, audit trail and release hardening

-- Generic append-only audit capture for business tables carrying org_id.
CREATE OR REPLACE FUNCTION write_audit_log_row() RETURNS TRIGGER AS $$
DECLARE rid BIGINT; oid BIGINT; uid BIGINT;
BEGIN
  BEGIN rid := COALESCE((to_jsonb(NEW)->>'id')::bigint,(to_jsonb(OLD)->>'id')::bigint); EXCEPTION WHEN OTHERS THEN rid := NULL; END;
  BEGIN oid := COALESCE((to_jsonb(NEW)->>'org_id')::bigint,(to_jsonb(OLD)->>'org_id')::bigint); EXCEPTION WHEN OTHERS THEN oid := NULL; END;
  BEGIN uid := NULLIF(current_setting('app.user_id', true),'')::bigint; EXCEPTION WHEN OTHERS THEN uid := NULL; END;
  IF oid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  INSERT INTO audit_log(org_id,user_id,table_name,record_id,action,old_value,new_value)
  VALUES(oid,uid,TG_TABLE_NAME,rid,lower(TG_OP),CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT c.table_schema,c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
           WHERE c.table_schema='public' AND c.column_name='org_id'
             AND c.table_name NOT IN ('audit_log','organizations','notifications','system_settings')
           GROUP BY c.table_schema,c.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I',r.table_name,r.table_schema,r.table_name);
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION write_audit_log_row()',r.table_name,r.table_schema,r.table_name);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org_table_record ON audit_log(org_id, table_name, record_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_audit_select ON audit_log;
DROP POLICY IF EXISTS tenant_audit_insert ON audit_log;
CREATE POLICY tenant_audit_select ON audit_log FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint);
CREATE POLICY tenant_audit_insert ON audit_log FOR INSERT WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true),'')::bigint);

-- Audit log is immutable: application users cannot update/delete historical evidence.
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
