-- G-010 findings (hostile_concurrency.mjs):
--  F-14 the period status endpoint failed on every call (42P08), so no period could ever be closed: the
--       period-lock control existed in the database but was unreachable;
--  posting into a date with no defined fiscal period was silently accepted.
-- (transaction managed by migrator)
-- Controls added: posting requires a defined, non-closed period (fail closed); reopening a closed period
-- needs a different user from the one who closed it and a recorded reason (STEP15 journal/close SoD).
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS reopened_by BIGINT REFERENCES users(id);
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

CREATE OR REPLACE FUNCTION enforce_open_fiscal_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM fiscal_periods
   WHERE org_id = NEW.org_id AND NEW.transaction_date BETWEEN start_date AND end_date
   ORDER BY period_no LIMIT 1;
  IF st IS NULL THEN RAISE EXCEPTION 'No fiscal period is defined for transaction date %', NEW.transaction_date; END IF;
  IF st = 'closed' THEN RAISE EXCEPTION 'Accounting period is closed for transaction date %', NEW.transaction_date; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_fiscal_period_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    IF NEW.reopened_by IS NULL OR NEW.reopen_reason IS NULL OR length(trim(NEW.reopen_reason)) < 10 THEN
      RAISE EXCEPTION 'Reopening a closed period requires the reopening user and a reason';
    END IF;
    IF NEW.reopened_by = OLD.closed_by THEN
      RAISE EXCEPTION 'Segregation of duties: the user who closed a period cannot reopen it';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM general_ledger g WHERE g.org_id = OLD.org_id AND g.transaction_date BETWEEN OLD.start_date AND OLD.end_date) THEN
    RAISE EXCEPTION 'A fiscal period with ledger postings cannot be deleted';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_fiscal_period_reopen ON fiscal_periods;
CREATE TRIGGER trg_fiscal_period_reopen BEFORE UPDATE OR DELETE ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION guard_fiscal_period_reopen();
