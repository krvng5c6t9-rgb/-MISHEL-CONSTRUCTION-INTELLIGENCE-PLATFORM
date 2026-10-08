-- CC-032 (RK-003 / plant & equipment): first runtime execution (sweep_assets.mjs).
-- PE0 guard_phase5_posting_lock() read payroll-only columns (posted_gl_batch_id) in a condition evaluated for
--     equipment_usage (same class as CC-006/CC-028): every equipment-usage submission failed with 42703 / HTTP 500,
--     so plant usage could never be approved or costed.
-- PE1 asset put "in use" with no project; retired assets returned to service; missing/foreign asset status change
--     returned 200 (route).
-- PE2 usage booked on a project where the asset is not mobilised, while under maintenance/retired, beyond 24
--     machine-hours a day, in the future, or with a terminated / foreign operator; maker not recorded; usage
--     editable while under approval.
-- PE3 maintenance next-due date before the maintenance date; maintenance on retired assets.
-- (transaction managed by migrator)
CREATE OR REPLACE FUNCTION guard_phase5_posting_lock() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'payroll_lines' THEN
    IF OLD.posted_cost_transaction_id IS NOT NULL OR OLD.posted_gl_batch_id IS NOT NULL THEN
      IF NEW.employee_id <> OLD.employee_id OR NEW.payroll_run_id <> OLD.payroll_run_id
         OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
         OR NEW.currency_id <> OLD.currency_id OR NEW.basic <> OLD.basic OR NEW.overtime <> OLD.overtime
         OR NEW.allowances <> OLD.allowances OR NEW.deductions <> OLD.deductions THEN
        RAISE EXCEPTION 'Posted payroll line % is frozen; use a controlled correction/reversal.', OLD.id;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'equipment_usage' THEN
    IF OLD.posted_cost_transaction_id IS NOT NULL THEN
      IF NEW.asset_id <> OLD.asset_id OR NEW.project_id <> OLD.project_id OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
         OR NEW.currency_id <> OLD.currency_id OR NEW.hours_used <> OLD.hours_used OR NEW.hourly_rate <> OLD.hourly_rate THEN
        RAISE EXCEPTION 'Posted equipment usage % is frozen; use a controlled correction/reversal.', OLD.id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_asset_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'in_use' AND NEW.current_project_id IS NULL THEN RAISE EXCEPTION 'An asset in use must be mobilised to a project'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'retired' AND NEW.status <> 'retired' THEN RAISE EXCEPTION 'Retired asset % cannot return to service', OLD.id; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_asset_status ON assets_equipment;
CREATE TRIGGER trg_asset_status BEFORE INSERT OR UPDATE ON assets_equipment FOR EACH ROW EXECUTE FUNCTION guard_asset_status();

ALTER TABLE equipment_usage ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
CREATE OR REPLACE FUNCTION guard_equipment_usage_integrity() RETURNS trigger AS $$
DECLARE a record; day_total numeric; op_org bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.asset_id, NEW.project_id, NEW.usage_date, NEW.hours_used, NEW.operator_id, NEW.cost_code_id, NEW.currency_id, NEW.hourly_rate)
       IS NOT DISTINCT FROM (OLD.asset_id, OLD.project_id, OLD.usage_date, OLD.hours_used, OLD.operator_id, OLD.cost_code_id, OLD.currency_id, OLD.hourly_rate) THEN
      RETURN NEW; -- status / approval / posting references only
    END IF;
    IF OLD.status <> 'draft' OR OLD.approval_instance_id IS NOT NULL THEN
      RAISE EXCEPTION 'Equipment usage % is under approval or approved and cannot be edited', OLD.id;
    END IF;
  END IF;
  SELECT id, org_id, status, current_project_id INTO a FROM assets_equipment WHERE id = NEW.asset_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Asset % not found in this organization', NEW.asset_id; END IF;
  IF a.status <> 'in_use' OR a.current_project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'Asset % is not mobilised to project % (status %)', NEW.asset_id, NEW.project_id, a.status;
  END IF;
  IF NEW.usage_date > current_date THEN RAISE EXCEPTION 'Usage cannot be dated in the future'; END IF;
  SELECT coalesce(sum(hours_used), 0) INTO day_total FROM equipment_usage WHERE asset_id = NEW.asset_id AND usage_date = NEW.usage_date AND id IS DISTINCT FROM NEW.id;
  IF day_total + NEW.hours_used > 24 THEN RAISE EXCEPTION 'Asset % would have % machine-hours on %', NEW.asset_id, day_total + NEW.hours_used, NEW.usage_date; END IF;
  IF NEW.operator_id IS NOT NULL THEN
    SELECT org_id INTO op_org FROM employees WHERE id = NEW.operator_id;
    IF op_org IS NULL OR op_org <> a.org_id OR NOT employee_employed_between(NEW.operator_id, NEW.usage_date, NEW.usage_date) THEN
      RAISE EXCEPTION 'Operator % is not an employee of this organization employed on %', NEW.operator_id, NEW.usage_date;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_equipment_usage_integrity ON equipment_usage;
CREATE TRIGGER trg_equipment_usage_integrity BEFORE INSERT OR UPDATE ON equipment_usage FOR EACH ROW EXECUTE FUNCTION guard_equipment_usage_integrity();

CREATE OR REPLACE FUNCTION guard_maintenance_log() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM assets_equipment WHERE id = NEW.asset_id;
  IF st = 'retired' THEN RAISE EXCEPTION 'Maintenance cannot be recorded on a retired asset'; END IF;
  IF NEW.next_due_date IS NOT NULL AND NEW.next_due_date < NEW.maintenance_date THEN RAISE EXCEPTION 'Next due date is before the maintenance date'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_maintenance_log_guard ON maintenance_log;
CREATE TRIGGER trg_maintenance_log_guard BEFORE INSERT OR UPDATE ON maintenance_log FOR EACH ROW EXECUTE FUNCTION guard_maintenance_log();
