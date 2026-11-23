-- Stage 70 / CC-099 (owner instruction 2026-11-23: the program as a whole; Power BI among the tools to integrate):
-- analytics dashboards built by the company's users.
-- (transaction managed by migrator)
-- Before (E3 @CC-098): fixed dashboards (executive, cost control, portfolio) only.
-- Now: analytics_dashboards - a named set of widgets (stored queries over the semantic layer in the API, chart type),
-- private to its owner or shared with the company; only the owner changes or deletes it. Data is never stored here:
-- each widget runs when viewed, with the viewer's permissions.
-- Rollback: drop analytics_dashboards.
CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  owner_id BIGINT NOT NULL REFERENCES users(id),
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) >= 2),
  visibility VARCHAR(10) NOT NULL CHECK (visibility IN ('private', 'company')),
  widgets JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(widgets) = 'array' AND jsonb_array_length(widgets) <= 24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, owner_id, name)
);
ALTER TABLE analytics_dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_dashboards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON analytics_dashboards;
DROP POLICY IF EXISTS tenant_isolation_write ON analytics_dashboards;
CREATE POLICY tenant_isolation_select ON analytics_dashboards FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON analytics_dashboards FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_analytics_dashboards ON analytics_dashboards;
CREATE TRIGGER trg_audit_analytics_dashboards AFTER INSERT OR UPDATE OR DELETE ON analytics_dashboards FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();
CREATE OR REPLACE FUNCTION guard_analytics_dashboard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.owner_id AND u.org_id = NEW.org_id) THEN RAISE EXCEPTION 'The dashboard owner must belong to the company'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN RAISE EXCEPTION 'A dashboard keeps its owner'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_analytics_dashboard ON analytics_dashboards;
CREATE TRIGGER trg_guard_analytics_dashboard BEFORE INSERT OR UPDATE ON analytics_dashboards FOR EACH ROW EXECUTE FUNCTION guard_analytics_dashboard();
