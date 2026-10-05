-- REV14 — HSE / QAQC workflow integrity and dashboard correctness

-- Track independent reviewers/closers.
ALTER TABLE ncrs ADD COLUMN IF NOT EXISTS closed_by BIGINT REFERENCES users(id);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_by BIGINT REFERENCES users(id);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE permits_to_work ADD COLUMN IF NOT EXISTS requested_by BIGINT REFERENCES users(id);
ALTER TABLE permits_to_work ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id);
ALTER TABLE permits_to_work ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE permits_to_work ADD COLUMN IF NOT EXISTS activated_by BIGINT REFERENCES users(id);
ALTER TABLE permits_to_work ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE permits_to_work ADD COLUMN IF NOT EXISTS closed_by BIGINT REFERENCES users(id);
ALTER TABLE permits_to_work ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE permits_to_work SET requested_by=issued_by WHERE requested_by IS NULL;
ALTER TABLE permits_to_work ALTER COLUMN requested_by SET NOT NULL;

-- Expand PTW lifecycle from direct-active to controlled request/approval/activation.
ALTER TABLE permits_to_work DROP CONSTRAINT IF EXISTS permits_to_work_status_check;
ALTER TABLE permits_to_work ADD CONSTRAINT permits_to_work_status_check
  CHECK (status IN ('requested','approved','active','expired','closed'));
ALTER TABLE permits_to_work ALTER COLUMN status SET DEFAULT 'requested';

-- NCR closure must be independent and evidenced.
CREATE OR REPLACE FUNCTION guard_ncr_closure_integrity() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (OLD.status='open' AND NEW.status='closed') THEN
      RAISE EXCEPTION 'Invalid NCR transition % -> %', OLD.status, NEW.status;
    END IF;
    IF NEW.closed_by IS NULL OR NEW.closed_by=OLD.raised_by THEN
      RAISE EXCEPTION 'NCR maker cannot close own NCR and closed_by is required';
    END IF;
    IF NEW.closed_date IS NULL OR nullif(trim(coalesce(NEW.root_cause,'')),'') IS NULL
       OR nullif(trim(coalesce(NEW.corrective_action,'')),'') IS NULL THEN
      RAISE EXCEPTION 'NCR closure requires closed_date, root cause and corrective action';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ncr_status ON ncrs;
CREATE TRIGGER trg_ncr_status BEFORE UPDATE OF status ON ncrs
FOR EACH ROW EXECUTE FUNCTION guard_ncr_closure_integrity();

-- Incident closure uses independent checker and closure timestamp.
CREATE OR REPLACE FUNCTION guard_incident_closure_integrity() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.investigation_status IS DISTINCT FROM NEW.investigation_status THEN
    IF NOT (OLD.investigation_status='open' AND NEW.investigation_status='closed') THEN
      RAISE EXCEPTION 'Invalid incident transition % -> %', OLD.investigation_status, NEW.investigation_status;
    END IF;
    IF NEW.closed_by IS NULL OR NEW.closed_by=OLD.reported_by THEN
      RAISE EXCEPTION 'Incident reporter cannot close own investigation and closed_by is required';
    END IF;
    IF NEW.closed_at IS NULL OR nullif(trim(coalesce(NEW.corrective_actions,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Incident closure requires closure timestamp and corrective actions';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_incident_status ON incidents;
CREATE TRIGGER trg_incident_status BEFORE UPDATE OF investigation_status ON incidents
FOR EACH ROW EXECUTE FUNCTION guard_incident_closure_integrity();

-- PTW state machine + maker/checker protection at DB level.
CREATE OR REPLACE FUNCTION guard_ptw_workflow_integrity() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  IF (OLD.status,NEW.status) NOT IN (
    ('requested','approved'),
    ('approved','active'),
    ('requested','closed'),
    ('approved','closed'),
    ('active','closed'),
    ('active','expired'),
    ('approved','expired')
  ) THEN
    RAISE EXCEPTION 'Invalid PTW transition % -> %', OLD.status, NEW.status;
  END IF;

  IF NEW.status='approved' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_by=OLD.requested_by THEN
      RAISE EXCEPTION 'PTW requester cannot approve own permit';
    END IF;
    IF NEW.approved_at IS NULL THEN RAISE EXCEPTION 'PTW approved_at is required'; END IF;
  ELSIF NEW.status='active' THEN
    IF OLD.approved_by IS NULL OR NEW.activated_by IS NULL OR NEW.activated_by=OLD.requested_by THEN
      RAISE EXCEPTION 'PTW activation requires prior approval and independent activator';
    END IF;
    IF NEW.activated_at IS NULL THEN RAISE EXCEPTION 'PTW activated_at is required'; END IF;
  ELSIF NEW.status='closed' THEN
    IF NEW.closed_by IS NULL OR NEW.closed_by=OLD.requested_by THEN
      RAISE EXCEPTION 'PTW requester cannot close own permit';
    END IF;
    IF NEW.closed_at IS NULL THEN RAISE EXCEPTION 'PTW closed_at is required'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_permit_status ON permits_to_work;
CREATE TRIGGER trg_permit_status BEFORE UPDATE OF status ON permits_to_work
FOR EACH ROW EXECUTE FUNCTION guard_ptw_workflow_integrity();

-- Existing rows remain valid; new rows must begin as requests.
CREATE OR REPLACE FUNCTION guard_ptw_insert_integrity() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> 'requested' THEN
    RAISE EXCEPTION 'New PTW must start in requested status';
  END IF;
  IF NEW.requested_by IS NULL THEN NEW.requested_by := NEW.issued_by; END IF;
  IF NEW.requested_by <> NEW.issued_by THEN
    RAISE EXCEPTION 'PTW requested_by must match authenticated issuer at creation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_permit_insert_integrity ON permits_to_work;
CREATE TRIGGER trg_permit_insert_integrity BEFORE INSERT ON permits_to_work
FOR EACH ROW EXECUTE FUNCTION guard_ptw_insert_integrity();

CREATE INDEX IF NOT EXISTS idx_ptw_status_project ON permits_to_work(project_id,status);
CREATE INDEX IF NOT EXISTS idx_ncr_status_project ON ncrs(project_id,status);
CREATE INDEX IF NOT EXISTS idx_incident_status_project ON incidents(project_id,investigation_status);
