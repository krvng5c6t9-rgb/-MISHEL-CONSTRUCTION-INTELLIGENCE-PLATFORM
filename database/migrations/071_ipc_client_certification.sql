-- Stage 22 / GC-13 steps 5-6 (F-35): client certification of an IPC recorded as evidence, and the receivable raised
-- at the amount the client certified. (transaction managed by migrator)
-- Before: POST /finance/ipcs/:id/client-approve flipped the status only - no client reference, no certification date,
-- no certified amount, no record of who entered it, and the IPC's preparer could enter it; a client certifying less
-- than submitted could not be captured, and AR/GL was always raised at the submitted net.
-- Now, submitted_to_client -> client_approved requires: the amount the client certified, the client's certificate
-- reference, the certification date (not before submission, not in the future), the recording user (not the
-- preparer), and a reason whenever the certified amount differs from the submitted net. The difference stays visible
-- on the IPC (submitted net - certified). Certification fields are immutable once recorded.
-- submitted_to_client -> disputed requires a dispute reason; resubmission after a dispute is recorded with a note.
-- AR and the GL batch are raised at the certified amount (GC-13 rule "AR = certified net"); the revenue method itself
-- is unchanged and remains DEC-009. Only the certified net is captured, not the client's breakdown of retention or
-- advance recovery (F-36). Legacy IPCs approved before this migration have no certified amount; they post at the
-- submitted net as before (labelled legacy in the posting result).
-- Rollback: DROP TRIGGER trg_ipc_client_certification ON ipcs; ALTER TABLE ipcs DROP COLUMN client_certified_amount,
-- client_reference, client_certified_on, certification_recorded_by, certification_difference_reason, dispute_reason,
-- resubmission_note.

ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS client_certified_amount NUMERIC(18,2) CHECK (client_certified_amount IS NULL OR client_certified_amount >= 0);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS client_reference TEXT;
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS client_certified_on DATE;
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS certification_recorded_by BIGINT REFERENCES users(id);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS certification_difference_reason TEXT;
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS dispute_reason TEXT;
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS resubmission_note TEXT;

CREATE OR REPLACE FUNCTION guard_ipc_client_certification() RETURNS trigger AS $$
BEGIN
  -- Certification evidence is written once.
  IF OLD.client_certified_amount IS NOT NULL AND
     (NEW.client_certified_amount, NEW.client_reference, NEW.client_certified_on, NEW.certification_recorded_by, NEW.certification_difference_reason)
     IS DISTINCT FROM (OLD.client_certified_amount, OLD.client_reference, OLD.client_certified_on, OLD.certification_recorded_by, OLD.certification_difference_reason) THEN
    RAISE EXCEPTION 'IPC % client certification is recorded and immutable', OLD.id;
  END IF;
  IF OLD.status = 'submitted_to_client' AND NEW.status = 'client_approved' THEN
    IF NEW.client_certified_amount IS NULL THEN RAISE EXCEPTION 'Client certification needs the amount the client certified'; END IF;
    IF length(trim(coalesce(NEW.client_reference, ''))) < 3 THEN RAISE EXCEPTION 'Client certification needs the client certificate reference'; END IF;
    IF NEW.client_certified_on IS NULL OR NEW.client_certified_on > current_date THEN RAISE EXCEPTION 'Client certification date is required and cannot be in the future'; END IF;
    IF OLD.submitted_date IS NOT NULL AND NEW.client_certified_on < OLD.submitted_date THEN
      RAISE EXCEPTION 'Client certification date % precedes submission %', NEW.client_certified_on, OLD.submitted_date;
    END IF;
    IF NEW.certification_recorded_by IS NULL OR NEW.certification_recorded_by = OLD.prepared_by THEN
      RAISE EXCEPTION 'Client certification is recorded by someone other than the IPC preparer';
    END IF;
    -- OLD.net_amount_due: the generated column is not computed on NEW in a BEFORE trigger (F-31); valuation is frozen.
    IF NEW.client_certified_amount <> OLD.net_amount_due AND length(trim(coalesce(NEW.certification_difference_reason, ''))) < 10 THEN
      RAISE EXCEPTION 'Certified amount % differs from submitted net %; the reason for the difference is required', NEW.client_certified_amount, OLD.net_amount_due;
    END IF;
  ELSIF NEW.client_certified_amount IS DISTINCT FROM OLD.client_certified_amount THEN
    RAISE EXCEPTION 'Client certification is recorded only when the IPC moves to client_approved';
  END IF;
  IF OLD.status = 'submitted_to_client' AND NEW.status = 'disputed' AND length(trim(coalesce(NEW.dispute_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A disputed IPC needs the client''s reason';
  END IF;
  IF OLD.status = 'disputed' AND NEW.status = 'submitted_to_client' AND length(trim(coalesce(NEW.resubmission_note, ''))) < 10 THEN
    RAISE EXCEPTION 'Resubmission after a dispute needs a note on what was resolved';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ipc_client_certification ON ipcs;
CREATE TRIGGER trg_ipc_client_certification BEFORE UPDATE ON ipcs FOR EACH ROW EXECUTE FUNCTION guard_ipc_client_certification();

-- The receivable raised from an IPC equals the client-certified amount (submitted net for legacy IPCs).
CREATE OR REPLACE FUNCTION guard_ar_ipc_amount() RETURNS trigger AS $$
DECLARE i record;
BEGIN
  IF NEW.ipc_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, net_amount_due, client_certified_amount INTO i FROM ipcs WHERE id = NEW.ipc_id;
  IF i.id IS NOT NULL AND NEW.amount <> coalesce(i.client_certified_amount, i.net_amount_due) THEN
    RAISE EXCEPTION 'Receivable % for IPC % must equal the client-certified amount %', NEW.amount, i.id, coalesce(i.client_certified_amount, i.net_amount_due);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ar_ipc_amount ON accounts_receivable;
CREATE TRIGGER trg_ar_ipc_amount BEFORE INSERT OR UPDATE OF amount, ipc_id ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION guard_ar_ipc_amount();
