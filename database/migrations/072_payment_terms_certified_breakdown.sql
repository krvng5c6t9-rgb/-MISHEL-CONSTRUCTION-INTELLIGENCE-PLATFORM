-- Stage 24 / GC-13 steps 5-8 (F-36, F-37): the client's certified breakdown, and receivable due dates from confirmed
-- contract payment terms. (transaction managed by migrator)
-- F-37 before: the receivable due date was the IPC period end - a date with no contractual meaning. Contracts held no
-- payment terms. Now contract_payment_terms records the period stated in the contract (days after submission or after
-- certification, clause reference, source) and is confirmed by a second person; the receivable due date is computed
-- from the confirmed terms; when no confirmed terms exist the due date is left empty and the posting result says so
-- (nothing invented). A DB trigger refuses a receivable whose due date does not follow the terms.
-- F-36 before: only the certified net was captured. Now the client's breakdown (gross, retention, advance recovery,
-- previous certified) may be recorded with the certification; when recorded it must be complete, add up to the
-- certified net and respect the contract retention percentage; the retention ledger, the advance recovered and the
-- "previous certified" cap then use the client's figures (coalesce to the submitted figures when no breakdown).
-- Rollback: DROP TABLE contract_payment_terms; DROP FUNCTION ipc_payment_due_date(bigint); ALTER TABLE ipcs DROP the
-- client_certified_* breakdown columns; re-apply the 070/071 functions.

CREATE TABLE IF NOT EXISTS contract_payment_terms (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  contract_id BIGINT NOT NULL UNIQUE REFERENCES contracts(id),
  basis VARCHAR(30) NOT NULL CHECK (basis IN ('after_submission','after_client_certification')),
  days INT NOT NULL CHECK (days BETWEEN 0 AND 3650),
  clause_ref VARCHAR(60) NOT NULL CHECK (length(trim(clause_ref)) >= 1),
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) >= 3),
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  confirmed_by BIGINT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by <> created_by))
);
CREATE OR REPLACE FUNCTION guard_contract_payment_terms() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed payment terms cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed payment terms are immutable'; END IF;
  SELECT id, org_id INTO c FROM contracts WHERE id = NEW.contract_id;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Contract % not found in this organization', NEW.contract_id; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'Payment terms start as draft'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.contract_id, NEW.org_id, NEW.created_by) IS DISTINCT FROM (OLD.contract_id, OLD.org_id, OLD.created_by) THEN
    RAISE EXCEPTION 'Payment terms ownership cannot change';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_payment_terms ON contract_payment_terms;
CREATE TRIGGER trg_contract_payment_terms BEFORE INSERT OR UPDATE OR DELETE ON contract_payment_terms FOR EACH ROW EXECUTE FUNCTION guard_contract_payment_terms();
ALTER TABLE contract_payment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_payment_terms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON contract_payment_terms;
DROP POLICY IF EXISTS tenant_isolation_write ON contract_payment_terms;
CREATE POLICY tenant_isolation_select ON contract_payment_terms FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON contract_payment_terms FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);

ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS client_certified_gross NUMERIC(18,2) CHECK (client_certified_gross IS NULL OR client_certified_gross >= 0);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS client_certified_retention NUMERIC(18,2) CHECK (client_certified_retention IS NULL OR client_certified_retention >= 0);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS client_certified_advance_recovery NUMERIC(18,2) CHECK (client_certified_advance_recovery IS NULL OR client_certified_advance_recovery >= 0);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS client_certified_previous NUMERIC(18,2) CHECK (client_certified_previous IS NULL OR client_certified_previous >= 0);

-- Due date of an IPC receivable under the confirmed payment terms of its contract (NULL when none are confirmed or the
-- reference date is not yet known).
CREATE OR REPLACE FUNCTION ipc_payment_due_date(p_ipc BIGINT) RETURNS DATE AS $$
  SELECT CASE t.basis WHEN 'after_submission' THEN i.submitted_date + t.days
                      WHEN 'after_client_certification' THEN i.client_certified_on + t.days END
  FROM ipcs i LEFT JOIN contract_payment_terms t ON t.contract_id = i.contract_id AND t.status = 'confirmed'
  WHERE i.id = p_ipc
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_ipc_client_certification() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  -- Certification evidence is written once.
  IF OLD.client_certified_amount IS NOT NULL AND
     (NEW.client_certified_amount, NEW.client_reference, NEW.client_certified_on, NEW.certification_recorded_by, NEW.certification_difference_reason,
      NEW.client_certified_gross, NEW.client_certified_retention, NEW.client_certified_advance_recovery, NEW.client_certified_previous)
     IS DISTINCT FROM (OLD.client_certified_amount, OLD.client_reference, OLD.client_certified_on, OLD.certification_recorded_by, OLD.certification_difference_reason,
      OLD.client_certified_gross, OLD.client_certified_retention, OLD.client_certified_advance_recovery, OLD.client_certified_previous) THEN
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
    -- F-36: the client's breakdown, when recorded, is complete and adds up to the certified net.
    IF num_nonnulls(NEW.client_certified_gross, NEW.client_certified_retention, NEW.client_certified_advance_recovery, NEW.client_certified_previous) NOT IN (0, 4) THEN
      RAISE EXCEPTION 'The client breakdown needs gross, retention, advance recovery and previous certified together';
    END IF;
    IF NEW.client_certified_gross IS NOT NULL THEN
      IF NEW.client_certified_gross - NEW.client_certified_retention - NEW.client_certified_advance_recovery - NEW.client_certified_previous <> NEW.client_certified_amount THEN
        RAISE EXCEPTION 'Client breakdown % - % - % - % does not equal the certified net %', NEW.client_certified_gross, NEW.client_certified_retention, NEW.client_certified_advance_recovery, NEW.client_certified_previous, NEW.client_certified_amount;
      END IF;
      SELECT retention_percent INTO c FROM contracts WHERE id = OLD.contract_id;
      IF c.retention_percent IS NOT NULL AND NEW.client_certified_retention > round(NEW.client_certified_gross * c.retention_percent / 100, 2) THEN
        RAISE EXCEPTION 'Certified retention % exceeds % percent of certified gross %', NEW.client_certified_retention, c.retention_percent, NEW.client_certified_gross;
      END IF;
    END IF;
  ELSIF (NEW.client_certified_amount, NEW.client_certified_gross) IS DISTINCT FROM (OLD.client_certified_amount, OLD.client_certified_gross) THEN
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

CREATE OR REPLACE FUNCTION guard_ipc_deductions() RETURNS trigger AS $$
DECLARE c record; received numeric; recovered numeric; outstanding numeric; rate_part numeric; rated int; expected numeric; prev_net numeric;
BEGIN
  IF NOT (TG_OP = 'INSERT' OR (OLD.status = 'draft' AND NEW.status = 'submitted_to_client')) THEN RETURN NEW; END IF;
  SELECT id, retention_percent INTO c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF c.retention_percent IS NOT NULL AND NEW.less_retention > round((NEW.gross_work_done_this_period + NEW.materials_on_site_value) * c.retention_percent / 100, 2) THEN
    RAISE EXCEPTION 'Retention % exceeds % percent of gross this period plus materials on site %', NEW.less_retention, c.retention_percent, NEW.gross_work_done_this_period + NEW.materials_on_site_value;
  END IF;
  SELECT coalesce(sum(amount), 0), coalesce(sum(round(NEW.gross_work_done_this_period * recovery_percent / 100, 2)), 0), count(recovery_percent)
    INTO received, rate_part, rated FROM client_advances WHERE contract_id = NEW.contract_id AND status = 'received';
  SELECT coalesce(sum(coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) INTO recovered FROM ipcs
    WHERE contract_id = NEW.contract_id AND id IS DISTINCT FROM NEW.id AND status <> 'draft';
  outstanding := received - recovered;
  IF NEW.less_advance_recovery > outstanding THEN
    RAISE EXCEPTION 'Advance recovery % exceeds the outstanding received advance % (received %, already recovered %)', NEW.less_advance_recovery, outstanding, received, recovered;
  END IF;
  IF rated > 0 THEN
    expected := least(rate_part, outstanding);
    IF NEW.less_advance_recovery <> expected THEN
      RAISE EXCEPTION 'Advance recovery % differs from the recovery due % (recorded rate on gross this period %, capped at outstanding %)', NEW.less_advance_recovery, expected, NEW.gross_work_done_this_period, outstanding;
    END IF;
  END IF;
  SELECT coalesce(sum(coalesce(client_certified_amount, net_amount_due)), 0) INTO prev_net FROM ipcs
    WHERE contract_id = NEW.contract_id AND id IS DISTINCT FROM NEW.id AND status IN ('client_approved','posted','paid');
  IF NEW.less_previous_certified > prev_net THEN
    RAISE EXCEPTION 'Less previous certified % exceeds the net certified on earlier client-approved IPCs %', NEW.less_previous_certified, prev_net;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION client_advance_position(p_contract BIGINT) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'contract_id', c.id,
    'advance_limit', CASE WHEN c.advance_payment_percent IS NULL THEN NULL ELSE round(c.contract_value * c.advance_payment_percent / 100, 2) END,
    'advances_recorded', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id),
    'advances_received', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id AND status = 'received'),
    'advance_recovered', (SELECT coalesce(sum(coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) FROM ipcs WHERE contract_id = c.id AND status <> 'draft'),
    'advance_outstanding', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id AND status = 'received')
                         - (SELECT coalesce(sum(coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) FROM ipcs WHERE contract_id = c.id AND status <> 'draft'),
    'net_certified', (SELECT coalesce(sum(coalesce(client_certified_amount, net_amount_due)), 0) FROM ipcs WHERE contract_id = c.id AND status IN ('client_approved','posted','paid')))
  FROM contracts c WHERE c.id = p_contract
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_ar_ipc_amount() RETURNS trigger AS $$
DECLARE i record;
BEGIN
  IF NEW.ipc_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, net_amount_due, client_certified_amount INTO i FROM ipcs WHERE id = NEW.ipc_id;
  IF i.id IS NOT NULL AND NEW.amount <> coalesce(i.client_certified_amount, i.net_amount_due) THEN
    RAISE EXCEPTION 'Receivable % for IPC % must equal the client-certified amount %', NEW.amount, i.id, coalesce(i.client_certified_amount, i.net_amount_due);
  END IF;
  -- F-37: the due date comes from the confirmed contract payment terms, or is left empty when none are recorded.
  IF i.id IS NOT NULL AND NEW.due_date IS DISTINCT FROM ipc_payment_due_date(i.id) THEN
    RAISE EXCEPTION 'Receivable due date % for IPC % must follow the confirmed contract payment terms (%)', NEW.due_date, i.id, coalesce(ipc_payment_due_date(i.id)::text, 'no payment terms recorded');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
-- The 071 trigger fired only on amount/ipc_id changes; the due date is now part of what it guards (found by the
-- Stage 24 probe: a direct due-date edit was accepted).
DROP TRIGGER IF EXISTS trg_ar_ipc_amount ON accounts_receivable;
CREATE TRIGGER trg_ar_ipc_amount BEFORE INSERT OR UPDATE OF amount, ipc_id, due_date ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION guard_ar_ipc_amount();
