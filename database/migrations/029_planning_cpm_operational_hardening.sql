-- REV17 — Planning & CPM operational hardening

-- Activity IDs imported from P6/MSP must be unique inside a project when supplied.
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_activity_ext_per_project
  ON schedule_activities(project_id, activity_id_ext)
  WHERE activity_id_ext IS NOT NULL;

ALTER TABLE schedule_activities DROP CONSTRAINT IF EXISTS chk_schedule_duration_nonnegative;
ALTER TABLE schedule_activities ADD CONSTRAINT chk_schedule_duration_nonnegative
  CHECK (planned_duration_days IS NULL OR planned_duration_days >= 0);

-- A baseline attached to an activity must belong to the same project.
CREATE OR REPLACE FUNCTION guard_schedule_activity_baseline_project() RETURNS TRIGGER AS $$
DECLARE baseline_project bigint;
BEGIN
  IF NEW.baseline_id IS NULL THEN RETURN NEW; END IF;
  SELECT project_id INTO baseline_project FROM schedule_baselines WHERE id=NEW.baseline_id;
  IF baseline_project IS NULL OR baseline_project <> NEW.project_id THEN
    RAISE EXCEPTION 'Schedule activity baseline must belong to the same project';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_schedule_activity_baseline_project ON schedule_activities;
CREATE TRIGGER trg_schedule_activity_baseline_project
  BEFORE INSERT OR UPDATE OF baseline_id, project_id ON schedule_activities
  FOR EACH ROW EXECUTE FUNCTION guard_schedule_activity_baseline_project();

-- The legacy single-predecessor field is no longer authoritative. Relationships table is canonical.
COMMENT ON COLUMN schedule_activities.predecessor_activity_id IS
  'LEGACY ONLY. Canonical scheduling logic uses schedule_relationships supporting multiple FS/SS/FF/SF relationships and lag.';
