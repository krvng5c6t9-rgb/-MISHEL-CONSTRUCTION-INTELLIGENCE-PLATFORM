-- Stage 25 / GC-13 step 8 (and the AP mirror): receipts and payments settle the receivable/payable they reference,
-- within its outstanding balance, for its own client/vendor and currency; status follows what was actually settled.
-- (transaction managed by migrator)
-- Before (E1 SW-GC13_collection_BEFORE_fix_pt2.txt, E3 glPosting.service.ts @af8dba0): an incoming receipt could name
-- another client and three times the receivable; posting ANY receipt set the receivable 'paid' and its IPC 'paid'
-- (a receipt of 1 would close a 95,000 receivable); outgoing payments did the same to payables.
-- Now:
--  * a receipt/payment must be for the receivable's client (payable's vendor) and in its currency, and never above the
--    outstanding balance (amount less other approved/posted/reconciled settlements); checked at creation and again,
--    serialised on the receivable/payable row, when the payment is approved;
--  * when a payment is posted (or reconciled) the receivable/payable becomes partially_paid or paid from the sum
--    actually settled, and the IPC is marked paid (with the last receipt date) only when fully settled;
--  * receivable_aging(as_of) lists outstanding receivables with days overdue against the due date from the contract
--    payment terms (CC-053); receivables without a due date are listed as such, not as current or overdue.
-- Rollback: DROP TRIGGER trg_payment_settlement_guard, trg_payment_settlement_status ON payments;
--           DROP FUNCTION receivable_aging(date); restore the unconditional status updates in glPosting.service.ts.

CREATE OR REPLACE FUNCTION guard_payment_settlement() RETURNS trigger AS $$
DECLARE d record; settled numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'approved') OR
       (NEW.amount, NEW.related_ar_id, NEW.related_ap_id, NEW.party_id, NEW.currency_id) IS DISTINCT FROM (OLD.amount, OLD.related_ar_id, OLD.related_ap_id, OLD.party_id, OLD.currency_id)) THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_type = 'incoming' THEN
    SELECT id, client_id AS party, amount, currency_id INTO d FROM accounts_receivable WHERE id = NEW.related_ar_id FOR UPDATE;
    IF d.id IS NULL THEN RAISE EXCEPTION 'Receivable % not found', NEW.related_ar_id; END IF;
    IF NEW.party_id <> d.party THEN RAISE EXCEPTION 'Receipt client % is not the receivable client %', NEW.party_id, d.party; END IF;
    SELECT coalesce(sum(amount), 0) INTO settled FROM payments
      WHERE related_ar_id = d.id AND id IS DISTINCT FROM NEW.id AND status IN ('approved','posted','reconciled');
  ELSE
    SELECT id, vendor_id AS party, amount, currency_id INTO d FROM accounts_payable WHERE id = NEW.related_ap_id FOR UPDATE;
    IF d.id IS NULL THEN RAISE EXCEPTION 'Payable % not found', NEW.related_ap_id; END IF;
    IF NEW.party_id <> d.party THEN RAISE EXCEPTION 'Payment vendor % is not the payable vendor %', NEW.party_id, d.party; END IF;
    SELECT coalesce(sum(amount), 0) INTO settled FROM payments
      WHERE related_ap_id = d.id AND id IS DISTINCT FROM NEW.id AND status IN ('approved','posted','reconciled');
  END IF;
  IF NEW.currency_id <> d.currency_id THEN RAISE EXCEPTION 'Payment currency % differs from the % currency %', NEW.currency_id, CASE WHEN NEW.payment_type = 'incoming' THEN 'receivable' ELSE 'payable' END, d.currency_id; END IF;
  IF NEW.amount > d.amount - settled THEN
    RAISE EXCEPTION 'Payment % exceeds the outstanding balance % (amount %, already settled %)', NEW.amount, d.amount - settled, d.amount, settled;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_settlement_guard ON payments;
CREATE TRIGGER trg_payment_settlement_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_settlement();

CREATE OR REPLACE FUNCTION apply_payment_settlement() RETURNS trigger AS $$
DECLARE total numeric; posted numeric; last_date date;
BEGIN
  IF NEW.status NOT IN ('posted','reconciled') OR OLD.status IN ('posted','reconciled') THEN RETURN NEW; END IF;
  IF NEW.related_ar_id IS NOT NULL THEN
    SELECT amount INTO total FROM accounts_receivable WHERE id = NEW.related_ar_id;
    SELECT coalesce(sum(amount), 0), max(payment_date) INTO posted, last_date FROM payments WHERE related_ar_id = NEW.related_ar_id AND status IN ('posted','reconciled');
    UPDATE accounts_receivable SET status = CASE WHEN posted >= total THEN 'paid' ELSE 'partially_paid' END, updated_at = now() WHERE id = NEW.related_ar_id;
    IF posted >= total THEN
      UPDATE ipcs SET status = 'paid', paid_date = last_date, updated_at = now() WHERE posted_ar_id = NEW.related_ar_id AND status = 'posted';
    END IF;
  ELSIF NEW.related_ap_id IS NOT NULL THEN
    SELECT amount INTO total FROM accounts_payable WHERE id = NEW.related_ap_id;
    SELECT coalesce(sum(amount), 0) INTO posted FROM payments WHERE related_ap_id = NEW.related_ap_id AND status IN ('posted','reconciled');
    UPDATE accounts_payable SET status = CASE WHEN posted >= total THEN 'paid' ELSE 'partially_paid' END, updated_at = now() WHERE id = NEW.related_ap_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_settlement_status ON payments;
CREATE TRIGGER trg_payment_settlement_status AFTER UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION apply_payment_settlement();

-- Collection view (information): outstanding receivables against their contractual due dates.
CREATE OR REPLACE FUNCTION receivable_aging(p_as_of DATE) RETURNS TABLE (
  receivable_id BIGINT, client_id BIGINT, project_id BIGINT, ipc_id BIGINT, amount NUMERIC, received NUMERIC, outstanding NUMERIC,
  due_date DATE, days_overdue INT, aging_basis TEXT) AS $$
  SELECT ar.id, ar.client_id, ar.project_id, ar.ipc_id, ar.amount, r.received, ar.amount - r.received,
         ar.due_date,
         CASE WHEN ar.due_date IS NULL THEN NULL ELSE greatest(p_as_of - ar.due_date, 0) END,
         CASE WHEN ar.due_date IS NULL THEN 'no_due_date_recorded' WHEN p_as_of > ar.due_date THEN 'overdue' ELSE 'not_yet_due' END
  FROM accounts_receivable ar
  CROSS JOIN LATERAL (SELECT coalesce(sum(p.amount), 0) AS received FROM payments p
                      WHERE p.related_ar_id = ar.id AND p.status IN ('posted','reconciled') AND p.payment_date <= p_as_of) r
  WHERE ar.amount - r.received > 0
$$ LANGUAGE sql STABLE;
