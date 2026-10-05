-- CC-028 (RK-003 / GC-37): HR, time and payroll integrity - first runtime execution (sweep_hr_payroll.mjs).
-- HP1 guard_phase5_status_transition() referenced OLD.investigation_status in a condition evaluated for every table
--     (same defect class as CC-006): every payroll run submission failed with 42703 / HTTP 500, so no payroll run
--     could ever reach approval. Restructured so each branch touches only its own table's columns.
-- HP2 payroll lines could be added, changed or deleted after submission and approval (only posting froze them).
-- HP3 the same employee could be paid twice in one run; HP4 negative net pay accepted;
-- HP5 employees terminated before the period could be paid; HP6 an employee of another tenant could be put on a
--     payroll line (FK checks bypass RLS); HP7 payroll period not normalised to a month;
-- HP8 termination without a date or dated before hire; HP9 timesheets beyond 24 h/day, outside employment, and
--     approved timesheets editable; HP10 overlapping leave requests for the same employee.
-- (transaction managed by migrator)

CREATE OR REPLACE FUNCTION guard_phase5_status_transition()
RETURNS trigger AS $$
DECLARE ok boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'incidents' THEN
    IF OLD.investigation_status IS NOT DISTINCT FROM NEW.investigation_status THEN RETURN NEW; END IF;
    ok := (OLD.investigation_status, NEW.investigation_status) IN (('open','closed'));
    IF NOT ok THEN RAISE EXCEPTION 'Invalid Phase 5 status transition on incidents: % -> %', OLD.investigation_status, NEW.investigation_status; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME NOT IN ('payroll_runs','equipment_usage','ncrs','permits_to_work') THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'payroll_runs' THEN
    -- No draft -> approved: a payroll run is approved only through its approval instance (CC-027).
    ok := (OLD.status, NEW.status) IN (('draft','pending_approval'),('pending_approval','approved'),('pending_approval','draft'),('approved','posted'),('posted','paid'));
  ELSIF TG_TABLE_NAME = 'equipment_usage' THEN
    ok := (OLD.status, NEW.status) IN (('draft','approved'));
  ELSIF TG_TABLE_NAME = 'ncrs' THEN
    ok := (OLD.status, NEW.status) IN (('open','closed'));
  ELSE
    ok := (OLD.status, NEW.status) IN (('active','expired'),('active','closed'));
  END IF;
  IF NOT ok THEN RAISE EXCEPTION 'Invalid Phase 5 status transition on %: % -> %', TG_TABLE_NAME, OLD.status, NEW.status; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- HP7: one run per calendar month, keyed by its first day (existing rows are not re-validated).
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS chk_payroll_period_is_month;
ALTER TABLE payroll_runs ADD CONSTRAINT chk_payroll_period_is_month CHECK (period_month = date_trunc('month', period_month)::date) NOT VALID;

-- HP4: net pay can never be negative.
ALTER TABLE payroll_lines DROP CONSTRAINT IF EXISTS chk_payroll_line_net_nonnegative;
ALTER TABLE payroll_lines ADD CONSTRAINT chk_payroll_line_net_nonnegative CHECK (basic + overtime + allowances - deductions >= 0) NOT VALID;
-- HP3: one line per employee per run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_line_run_employee ON payroll_lines(payroll_run_id, employee_id);

-- An employee is employed on a date when hired on/before it (if a hire date is recorded) and not terminated before it.
CREATE OR REPLACE FUNCTION employee_employed_between(p_employee bigint, p_from date, p_to date) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM employees e WHERE e.id = p_employee
    AND (e.hire_date IS NULL OR e.hire_date <= p_to)
    AND (e.termination_date IS NULL OR e.termination_date >= p_from));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_payroll_line_integrity() RETURNS trigger AS $$
DECLARE r record; emp_org bigint; period_end date;
BEGIN
  SELECT id, org_id, status, period_month INTO r FROM payroll_runs WHERE id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  IF TG_OP = 'DELETE' THEN
    IF r.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Payroll lines can only be removed while the run is draft (status %)', r.status; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.payroll_run_id, NEW.employee_id, NEW.project_id, NEW.cost_code_id, NEW.currency_id, NEW.basic, NEW.overtime, NEW.allowances, NEW.deductions)
       IS NOT DISTINCT FROM (OLD.payroll_run_id, OLD.employee_id, OLD.project_id, OLD.cost_code_id, OLD.currency_id, OLD.basic, OLD.overtime, OLD.allowances, OLD.deductions) THEN
    RETURN NEW; -- posting references only
  END IF;
  IF r.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Payroll lines can only change while the run is draft (status %)', r.status; END IF;
  SELECT org_id INTO emp_org FROM employees WHERE id = NEW.employee_id;
  IF emp_org IS NULL OR emp_org <> r.org_id THEN RAISE EXCEPTION 'Employee % is not an employee of this organization', NEW.employee_id; END IF;
  period_end := (r.period_month + interval '1 month' - interval '1 day')::date;
  IF NOT employee_employed_between(NEW.employee_id, r.period_month, period_end) THEN
    RAISE EXCEPTION 'Employee % is not employed during payroll period %', NEW.employee_id, r.period_month;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payroll_line_integrity ON payroll_lines;
CREATE TRIGGER trg_payroll_line_integrity BEFORE INSERT OR UPDATE OR DELETE ON payroll_lines FOR EACH ROW EXECUTE FUNCTION guard_payroll_line_integrity();

-- HP8: termination needs a date not before hire.
CREATE OR REPLACE FUNCTION guard_employee_dates() RETURNS trigger AS $$
BEGIN
  IF NEW.employment_status = 'terminated' AND NEW.termination_date IS NULL THEN RAISE EXCEPTION 'Termination requires a termination date'; END IF;
  IF NEW.termination_date IS NOT NULL AND NEW.hire_date IS NOT NULL AND NEW.termination_date < NEW.hire_date THEN
    RAISE EXCEPTION 'Termination date % is before hire date %', NEW.termination_date, NEW.hire_date;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_employee_dates ON employees;
CREATE TRIGGER trg_employee_dates BEFORE INSERT OR UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION guard_employee_dates();

-- HP9: timesheets within employment, at most 24 h per employee per day, immutable once approved.
CREATE OR REPLACE FUNCTION guard_timesheet_integrity() RETURNS trigger AS $$
DECLARE day_total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN RAISE EXCEPTION 'Approved timesheet % cannot be deleted', OLD.id; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    RAISE EXCEPTION 'Approved timesheet % is immutable', OLD.id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND (NEW.employee_id, NEW.project_id, NEW.cost_code_id, NEW.work_date, NEW.hours, NEW.activity_ref)
       IS NOT DISTINCT FROM (OLD.employee_id, OLD.project_id, OLD.cost_code_id, OLD.work_date, OLD.hours, OLD.activity_ref) THEN
    RETURN NEW; -- approval only
  END IF;
  PERFORM 1 FROM employees WHERE id = NEW.employee_id FOR UPDATE; -- serialise concurrent entries per employee
  IF NOT employee_employed_between(NEW.employee_id, NEW.work_date, NEW.work_date) THEN
    RAISE EXCEPTION 'Employee % is not employed on %', NEW.employee_id, NEW.work_date;
  END IF;
  SELECT coalesce(sum(hours), 0) INTO day_total FROM timesheets WHERE employee_id = NEW.employee_id AND work_date = NEW.work_date AND id IS DISTINCT FROM NEW.id;
  IF day_total + NEW.hours > 24 THEN
    RAISE EXCEPTION 'Employee % would have % hours on %', NEW.employee_id, day_total + NEW.hours, NEW.work_date;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_timesheet_integrity ON timesheets;
CREATE TRIGGER trg_timesheet_integrity BEFORE INSERT OR UPDATE OR DELETE ON timesheets FOR EACH ROW EXECUTE FUNCTION guard_timesheet_integrity();

-- HP10: no overlapping pending/approved leave for one employee.
CREATE OR REPLACE FUNCTION guard_leave_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'rejected' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.employee_id, NEW.from_date, NEW.to_date) IS NOT DISTINCT FROM (OLD.employee_id, OLD.from_date, OLD.to_date) THEN RETURN NEW; END IF;
  PERFORM 1 FROM employees WHERE id = NEW.employee_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = NEW.employee_id AND l.id IS DISTINCT FROM NEW.id
             AND l.status IN ('pending','approved') AND l.from_date <= NEW.to_date AND l.to_date >= NEW.from_date) THEN
    RAISE EXCEPTION 'Leave % .. % overlaps an existing leave request of employee %', NEW.from_date, NEW.to_date, NEW.employee_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_leave_overlap ON leave_requests;
CREATE TRIGGER trg_leave_overlap BEFORE INSERT OR UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION guard_leave_overlap();
