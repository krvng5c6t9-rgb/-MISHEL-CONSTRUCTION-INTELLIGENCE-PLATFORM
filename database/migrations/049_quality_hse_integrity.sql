-- GC-08/GC-09 runtime findings (sweep_quality_hse.mjs, first execution):
--  QH1 recording an inspection result without a date failed (constraint requires one; route did not default it);
--  QH2 no inspection requester was recorded, so the requester could record the result of their own inspection
--      (SOD15-055) - the creator was stored as "inspected_by";
--  QH3 inspection results could be changed after being recorded (passed -> failed -> pending);
--  QH4 a permit to work could be activated after its expiry date (expiry-before-issue was already blocked by chk_permit_dates).
-- (transaction managed by migrator)
ALTER TABLE inspection_checklists ADD COLUMN IF NOT EXISTS requested_by BIGINT REFERENCES users(id);
ALTER TABLE inspection_checklists ADD COLUMN IF NOT EXISTS result_recorded_at TIMESTAMPTZ;
UPDATE inspection_checklists SET requested_by = inspected_by WHERE requested_by IS NULL;

CREATE OR REPLACE FUNCTION guard_inspection_result() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'Inspections are created pending'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' AND (NEW.status, NEW.inspected_by, NEW.inspection_date) IS DISTINCT FROM (OLD.status, OLD.inspected_by, OLD.inspection_date) THEN
    RAISE EXCEPTION 'Inspection % result is recorded and cannot be changed; raise an NCR or a new inspection', OLD.id;
  END IF;
  IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    IF NEW.inspected_by IS NULL OR NEW.inspected_by = NEW.requested_by THEN
      RAISE EXCEPTION 'Segregation of duties: the inspection result must be recorded by someone other than the requester';
    END IF;
    NEW.inspection_date := coalesce(NEW.inspection_date, current_date);
    NEW.result_recorded_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_inspection_result_guard ON inspection_checklists;
CREATE TRIGGER trg_inspection_result_guard BEFORE INSERT OR UPDATE ON inspection_checklists FOR EACH ROW EXECUTE FUNCTION guard_inspection_result();

CREATE OR REPLACE FUNCTION guard_permit_activation() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' AND NEW.expiry_date IS NOT NULL AND NEW.expiry_date < current_date THEN
    RAISE EXCEPTION 'Permit % expired on % and cannot be activated', NEW.id, NEW.expiry_date;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_permit_activation_guard ON permits_to_work;
CREATE TRIGGER trg_permit_activation_guard BEFORE UPDATE ON permits_to_work FOR EACH ROW EXECUTE FUNCTION guard_permit_activation();
