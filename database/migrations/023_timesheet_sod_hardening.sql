-- REV11 — Timesheet segregation-of-duties hardening
-- New timesheets must retain maker identity. Approval must be a distinct user.

ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_timesheets_created_by ON timesheets(created_by);

CREATE OR REPLACE FUNCTION guard_timesheet_approval_sod() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'Timesheet approval requires approved_by';
    END IF;
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'Timesheet approval blocked: maker identity is missing';
    END IF;
    IF NEW.created_by = NEW.approved_by THEN
      RAISE EXCEPTION 'Segregation of duties violation: maker cannot approve own timesheet';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timesheet_approval_sod ON timesheets;
CREATE TRIGGER trg_timesheet_approval_sod
BEFORE UPDATE OF status, approved_by ON timesheets
FOR EACH ROW EXECUTE FUNCTION guard_timesheet_approval_sod();


-- Leave-request maker/checker segregation.
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_created_by ON leave_requests(created_by);

CREATE OR REPLACE FUNCTION guard_leave_request_decision_sod() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('approved','rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'Leave request decision requires approved_by';
    END IF;
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'Leave request decision blocked: maker identity is missing';
    END IF;
    IF NEW.created_by = NEW.approved_by THEN
      RAISE EXCEPTION 'Segregation of duties violation: maker cannot decide own leave request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leave_request_decision_sod ON leave_requests;
CREATE TRIGGER trg_leave_request_decision_sod
BEFORE UPDATE OF status, approved_by ON leave_requests
FOR EACH ROW EXECUTE FUNCTION guard_leave_request_decision_sod();
