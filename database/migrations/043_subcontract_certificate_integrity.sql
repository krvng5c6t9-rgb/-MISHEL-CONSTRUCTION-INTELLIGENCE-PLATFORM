-- GC-12 runtime defects found by tests/e2e/wave1_subcontract_ipc.mjs (first execution of this flow):
--  D1 certificates could be raised against a draft (unapproved) subcontract;
--  D2 the certificate gross was not reconciled with its measured lines;
--  D3 retention above the subcontract retention percentage was accepted;
--  D4 lines could be added/changed after verification (a 1,000,000 line was accepted post-verification).
-- (transaction managed by migrator)
-- The valuation model (periodic vs cumulative) and the cost/AP posting basis (gross vs net) are NOT changed
-- here; they are owner/accountant decision DEC-012 (same family as DEC-009).

CREATE OR REPLACE FUNCTION guard_subcontract_certificate_integrity() RETURNS trigger AS $$
DECLARE s subcontracts%ROWTYPE; line_total numeric; line_count int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft subcontract certificates can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO s FROM subcontracts WHERE id = NEW.subcontract_id;
  IF TG_OP = 'INSERT' THEN
    IF s.status <> 'active' THEN RAISE EXCEPTION 'Certificates can only be raised against an active (approved) subcontract; subcontract % is %', s.id, s.status; END IF;
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Certificates start as draft'; END IF;
    RETURN NEW;
  END IF;
  -- Valuation fields are frozen once the certificate leaves draft.
  IF OLD.status <> 'draft' AND (NEW.gross_work_done, NEW.less_retention, NEW.less_advance_recovery, NEW.less_previous_paid, NEW.penalties_deductions, NEW.subcontract_id, NEW.project_id, NEW.period_from, NEW.period_to)
       IS DISTINCT FROM (OLD.gross_work_done, OLD.less_retention, OLD.less_advance_recovery, OLD.less_previous_paid, OLD.penalties_deductions, OLD.subcontract_id, OLD.project_id, OLD.period_from, OLD.period_to) THEN
    RAISE EXCEPTION 'Subcontract certificate valuation is frozen after draft';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'site_verified' THEN
    SELECT coalesce(sum(amount), 0), count(*) INTO line_total, line_count FROM subcontract_certificate_lines WHERE certificate_id = NEW.id;
    IF line_count > 0 AND line_total <> NEW.gross_work_done THEN
      RAISE EXCEPTION 'Certificate gross % does not equal the sum of its lines %', NEW.gross_work_done, line_total;
    END IF;
    IF s.retention_percent IS NOT NULL AND NEW.less_retention > round(NEW.gross_work_done * s.retention_percent / 100, 2) THEN
      RAISE EXCEPTION 'Retention % exceeds % percent of gross %', NEW.less_retention, s.retention_percent, NEW.gross_work_done;
    END IF;
    IF NEW.net_amount_due < 0 THEN RAISE EXCEPTION 'Net amount due cannot be negative; use a separate credit/back-charge process'; END IF;
    IF NEW.period_to < NEW.period_from THEN RAISE EXCEPTION 'Certificate period end precedes start'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_certificate_integrity ON subcontract_certificates;
CREATE TRIGGER trg_subcontract_certificate_integrity BEFORE INSERT OR UPDATE OR DELETE ON subcontract_certificates FOR EACH ROW EXECUTE FUNCTION guard_subcontract_certificate_integrity();

CREATE OR REPLACE FUNCTION guard_subcontract_certificate_lines() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM subcontract_certificates WHERE id = COALESCE(NEW.certificate_id, OLD.certificate_id);
  IF st IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Certificate lines can only change while the certificate is draft (status %)', st; END IF;
  IF TG_OP <> 'DELETE' AND NEW.cumulative_quantity < NEW.quantity_this_period THEN
    RAISE EXCEPTION 'Cumulative quantity cannot be less than this-period quantity';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_certificate_lines ON subcontract_certificate_lines;
CREATE TRIGGER trg_subcontract_certificate_lines BEFORE INSERT OR UPDATE OR DELETE ON subcontract_certificate_lines FOR EACH ROW EXECUTE FUNCTION guard_subcontract_certificate_lines();
