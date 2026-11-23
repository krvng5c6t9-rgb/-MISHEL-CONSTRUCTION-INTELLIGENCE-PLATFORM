-- Stage 68 / CC-097 (owner instructions 2026-11-18 / 2026-11-23: integrate what Primavera and MS Project do; global
-- level): work calendars, dated CPM and schedule exchange with Primavera P6 (XER) and Microsoft Project (MSPDI XML).
-- (transaction managed by migrator)
-- Before (E3 @CC-096): activities and FS/SS/FF/SF relationships with lags existed and /planning/cpm computed early /
-- late offsets in plain days; there was no work calendar, no dates from the CPM and no file exchange.
-- Now:
--  * work_calendars: the company's calendars (working week days 0 = Sunday ... 6 = Saturday, hours per working day);
--    calendar_holidays: non-working dates of a calendar. Nothing is assumed: a dated schedule needs a calendar.
--  * project_schedule_settings: per project the calendar and the data date (start of the calculation).
--  * schedule_activities.activity_type (task, start / finish milestone) and wbs_code.
--  * schedule_imports: a permanent record of every imported file (format, name, SHA-256, counts, warnings, who).
-- Rollback: drop schedule_imports, project_schedule_settings, calendar_holidays, work_calendars and the two columns.

CREATE TABLE IF NOT EXISTS work_calendars (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) >= 2),
  work_days SMALLINT[] NOT NULL CHECK (cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  hours_per_day NUMERIC(4,2) NOT NULL CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE TABLE IF NOT EXISTS calendar_holidays (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  calendar_id BIGINT NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  description VARCHAR(200) NOT NULL CHECK (length(trim(description)) >= 2),
  UNIQUE (calendar_id, holiday_date)
);
CREATE TABLE IF NOT EXISTS project_schedule_settings (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL UNIQUE REFERENCES projects(id),
  calendar_id BIGINT NOT NULL REFERENCES work_calendars(id),
  data_date DATE NOT NULL,
  updated_by BIGINT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE schedule_activities ADD COLUMN IF NOT EXISTS activity_type VARCHAR(16) NOT NULL DEFAULT 'task'
  CHECK (activity_type IN ('task', 'start_milestone', 'finish_milestone'));
ALTER TABLE schedule_activities ADD COLUMN IF NOT EXISTS wbs_code VARCHAR(100);

CREATE TABLE IF NOT EXISTS schedule_imports (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  format VARCHAR(8) NOT NULL CHECK (format IN ('xer', 'mspdi')),
  file_name VARCHAR(255) NOT NULL,
  file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  activities_count INTEGER NOT NULL CHECK (activities_count >= 0),
  relationships_count INTEGER NOT NULL CHECK (relationships_count >= 0),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['work_calendars', 'calendar_holidays', 'project_schedule_settings', 'schedule_imports'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint)$p$, t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint)$p$, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION write_audit_log_row()', t, t);
  END LOOP;
END $$;

-- Same company for the calendar, the holiday and the project; an import record never changes.
CREATE OR REPLACE FUNCTION guard_schedule_calendar_refs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'calendar_holidays' THEN
    IF NOT EXISTS (SELECT 1 FROM work_calendars c WHERE c.id = NEW.calendar_id AND c.org_id = NEW.org_id) THEN RAISE EXCEPTION 'Calendar not found in this company'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM work_calendars c WHERE c.id = NEW.calendar_id AND c.org_id = NEW.org_id) THEN RAISE EXCEPTION 'Calendar not found in this company'; END IF;
    IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.org_id = NEW.org_id) THEN RAISE EXCEPTION 'Project not found in this company'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_calendar_holidays ON calendar_holidays;
CREATE TRIGGER trg_guard_calendar_holidays BEFORE INSERT OR UPDATE ON calendar_holidays FOR EACH ROW EXECUTE FUNCTION guard_schedule_calendar_refs();
DROP TRIGGER IF EXISTS trg_guard_project_schedule_settings ON project_schedule_settings;
CREATE TRIGGER trg_guard_project_schedule_settings BEFORE INSERT OR UPDATE ON project_schedule_settings FOR EACH ROW EXECUTE FUNCTION guard_schedule_calendar_refs();

CREATE OR REPLACE FUNCTION guard_schedule_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Schedule import records are permanent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.org_id = NEW.org_id) THEN RAISE EXCEPTION 'Project not found in this company'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_schedule_import ON schedule_imports;
CREATE TRIGGER trg_guard_schedule_import BEFORE INSERT OR UPDATE OR DELETE ON schedule_imports FOR EACH ROW EXECUTE FUNCTION guard_schedule_import();

-- A milestone has no duration.
CREATE OR REPLACE FUNCTION guard_schedule_activity_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.activity_type <> 'task' AND coalesce(NEW.planned_duration_days, 0) <> 0 THEN RAISE EXCEPTION 'A milestone has no duration'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_schedule_activity_type ON schedule_activities;
CREATE TRIGGER trg_guard_schedule_activity_type BEFORE INSERT OR UPDATE ON schedule_activities FOR EACH ROW EXECUTE FUNCTION guard_schedule_activity_type();
