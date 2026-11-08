-- Stage 64 / CC-093 (A-006, COMPETITOR_SCAN_002 §3): site attendance with integrity, approval and a labour summary.
-- (transaction managed by migrator)
-- Before (E3 @CC-092): attendance (migration 007) accepted any employee and project of the company with no rule:
-- a terminated employee, more than 24 hours, hours on an absence, "leave" without a leave, and a re-entry silently
-- overwrote the record; nothing recorded who entered or confirmed it; no suite exercised it.
-- Now:
--  * who records (recorded_by) and who approves (approved_by / approved_at) are kept; approval by someone other than
--    the recorder; an approved record never changes and is never deleted;
--  * the employee must be employed on the date (hired on or before, not terminated before it); the project must be
--    of the same company;
--  * hours_worked 0..24, overtime_hours 0..24, together at most 24; absent / leave carry no hours; present needs
--    hours > 0;
--  * status leave only when an approved leave request of the employee covers the date, and an employee on approved
--    leave cannot be marked present;
--  * 'overtime' remains readable for old rows but new rows use present + overtime_hours.
-- Rollback: drop the trigger / function and the added columns.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recorded_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_hours_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_hours_check
  CHECK ((hours_worked IS NULL OR hours_worked BETWEEN 0 AND 24) AND overtime_hours BETWEEN 0 AND 24 AND coalesce(hours_worked, 0) + overtime_hours <= 24);
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_approval_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_approval_check
  CHECK (approved_by IS NULL OR (approved_at IS NOT NULL AND recorded_by IS NOT NULL AND approved_by <> recorded_by));
CREATE INDEX IF NOT EXISTS idx_attendance_project_date ON attendance(org_id, project_id, attendance_date);

CREATE OR REPLACE FUNCTION guard_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; on_leave boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_by IS NOT NULL THEN RAISE EXCEPTION 'Approved attendance is never deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approved_by IS NOT NULL THEN RAISE EXCEPTION 'Approved attendance is never changed'; END IF;
  SELECT * INTO e FROM employees WHERE id = NEW.employee_id;
  IF e.id IS NULL OR e.org_id IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'Employee not found in this organization'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Project not found in this organization';
  END IF;
  IF (e.hire_date IS NOT NULL AND NEW.attendance_date < e.hire_date) OR (e.termination_date IS NOT NULL AND NEW.attendance_date > e.termination_date) THEN
    RAISE EXCEPTION 'The employee was not employed on this date';
  END IF;
  IF NEW.status IN ('absent', 'leave') AND (coalesce(NEW.hours_worked, 0) > 0 OR NEW.overtime_hours > 0) THEN
    RAISE EXCEPTION 'An absence or leave carries no hours';
  END IF;
  IF NEW.status = 'present' AND coalesce(NEW.hours_worked, 0) <= 0 THEN RAISE EXCEPTION 'A present day needs the hours worked'; END IF;
  SELECT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = NEW.employee_id AND l.status = 'approved'
                  AND NEW.attendance_date BETWEEN l.from_date AND l.to_date) INTO on_leave;
  IF NEW.status = 'leave' AND NOT on_leave THEN RAISE EXCEPTION 'Leave needs an approved leave request covering the date'; END IF;
  IF NEW.status IN ('present', 'overtime') AND on_leave THEN RAISE EXCEPTION 'The employee is on approved leave on this date'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.approved_by IS NOT NULL AND (NEW.employee_id, NEW.project_id, NEW.attendance_date, NEW.status, NEW.hours_worked, NEW.overtime_hours, NEW.recorded_by)
       IS DISTINCT FROM (OLD.employee_id, OLD.project_id, OLD.attendance_date, OLD.status, OLD.hours_worked, OLD.overtime_hours, OLD.recorded_by) THEN
      RAISE EXCEPTION 'Attendance is approved as recorded';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_attendance ON attendance;
CREATE TRIGGER trg_guard_attendance BEFORE INSERT OR UPDATE OR DELETE ON attendance FOR EACH ROW EXECUTE FUNCTION guard_attendance();
