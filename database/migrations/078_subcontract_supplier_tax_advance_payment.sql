-- Stage 29 / DEC-012 remainder + DEC-016/017 supplier side (F-33, F-44). (transaction managed by migrator)
-- Before (E3 069/073/074/077, glPosting.service.ts @bddd43a):
--  * F-33: a subcontract advance was marked 'paid' by typing a reference - no payable, no cash movement, no GL; the
--    advance asset that certificate recoveries credit (rule subcontract_advance) was never debited.
--  * F-44: every outgoing payment debited the outgoing-payment rule's account (generic accounts payable) whatever the
--    payable was; subcontract payables are credited to the subcontractors payable / retention payable accounts, so
--    paying them left those control accounts credited and the generic account debited.
--  * input tax on subcontract certificates and withholding on subcontractor payments were refused (074: "enabled with
--    subcontract payables").
-- Now (DEC-016/017 mechanism; no rate, base or threshold is assumed - all come from confirmed tax codes):
--  * an approved advance gets its own payable (source 'subcontract_advance'), like a down-payment request: it carries
--    no GL entry of its own; the advance becomes 'paid' only when payments posted against that payable settle it in
--    full, and the payment debits the advance asset account (the subcontract_advance rule's account), not a payable;
--  * every outgoing payment against a subcontract payable debits the account the payable was credited to
--    (subcontract / subcontract_retention rule accounts); vendor invoices keep the outgoing-payment rule;
--  * input tax: when a certificate is approved and its subcontract has a confirmed tax profile with an input tax code,
--    the version effective on the approval date is applied on its base (certified net or gross), stored, immutable;
--    the payable = net + input tax; GL Dr input tax account / Cr subcontractors payable. No profile: 'no_tax_profile';
--  * withholding: an outgoing payment against a subcontract payable may carry tax withheld from the subcontractor,
--    with our withholding notice reference and the subcontract's confirmed code (version effective on the payment
--    date); cash + withheld settles the payable; GL Dr payable account / Cr the code's liability account. The amount
--    is the one stated on our notice - the system does not invent a rate; supplier payables of vendor invoices have
--    no tax profile and still refuse withholding;
--  * subcontract payables are tied to their source: advance payable = advance amount, certificate payable = net +
--    input tax, retention payable = the retention released;
--  * tax_position adds input tax and tax withheld from suppliers.
-- Rollback: re-apply guard_subcontract_advance (069), guard_payment_settlement / apply_payment_settlement / tax_position
-- (074); DROP TRIGGER trg_subcontract_certificate_tax, trg_ap_subcontract_source; drop the added columns.

ALTER TABLE subcontract_advances ADD COLUMN IF NOT EXISTS payable_id BIGINT REFERENCES accounts_payable(id);
ALTER TABLE subcontract_advances ADD COLUMN IF NOT EXISTS paid_payment_id BIGINT REFERENCES payments(id);
ALTER TABLE subcontract_advances DROP CONSTRAINT IF EXISTS subcontract_advances_check1;
ALTER TABLE subcontract_advances ADD CONSTRAINT subcontract_advances_paid_evidence CHECK (status <> 'paid' OR (
  paid_at IS NOT NULL AND length(trim(coalesce(payment_reference,''))) >= 3 AND
  (paid_payment_id IS NOT NULL OR (paid_by IS NOT NULL AND paid_by <> created_by))));

CREATE OR REPLACE FUNCTION guard_subcontract_advance() RETURNS trigger AS $$
DECLARE s record; total numeric; ap record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft advance can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, status, contract_value, advance_payment_percent, vendor_id INTO s FROM subcontracts WHERE id = NEW.subcontract_id FOR UPDATE;
  IF s.id IS NULL OR s.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Subcontract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'An advance starts as draft'; END IF;
    IF NEW.payable_id IS NOT NULL OR NEW.paid_payment_id IS NOT NULL THEN RAISE EXCEPTION 'A draft advance has no payable or payment'; END IF;
    IF s.status <> 'active' THEN RAISE EXCEPTION 'Advances are recorded only on an active subcontract (subcontract % is %)', s.id, s.status; END IF;
    IF s.advance_payment_percent IS NULL OR s.advance_payment_percent <= 0 THEN
      RAISE EXCEPTION 'Subcontract % provides no advance payment (advance_payment_percent not set)', s.id;
    END IF;
    SELECT coalesce(sum(amount), 0) INTO total FROM subcontract_advances WHERE subcontract_id = NEW.subcontract_id;
    IF total + NEW.amount > round(s.contract_value * s.advance_payment_percent / 100, 2) THEN
      RAISE EXCEPTION 'Advances % exceed % percent of the subcontract value %', total + NEW.amount, s.advance_payment_percent, s.contract_value;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.subcontract_id, NEW.amount, NEW.recovery_percent, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.org_id, OLD.subcontract_id, OLD.amount, OLD.recovery_percent, OLD.created_by, OLD.created_at) AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Advance % is approved; its terms are frozen', OLD.id;
  END IF;
  IF OLD.status = 'paid' THEN RAISE EXCEPTION 'Advance % is paid and immutable', OLD.id; END IF;
  IF NOT ((OLD.status = NEW.status) OR (OLD.status = 'draft' AND NEW.status = 'approved') OR (OLD.status = 'approved' AND NEW.status = 'paid')) THEN
    RAISE EXCEPTION 'Invalid advance transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'approved' AND NOT (OLD.payable_id IS NULL AND NEW.payable_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An approved advance changes only by being paid';
  END IF;
  IF OLD.payable_id IS NOT NULL AND NEW.payable_id IS DISTINCT FROM OLD.payable_id THEN RAISE EXCEPTION 'Advance % payable is fixed', OLD.id; END IF;
  -- F-33: approval opens the advance payable; payment is evidenced only by posted payments that settle it.
  IF NEW.status = 'approved' THEN
    SELECT id, source_type, source_record_id, vendor_id, amount INTO ap FROM accounts_payable WHERE id = NEW.payable_id;
    IF ap.id IS NULL OR ap.source_type <> 'subcontract_advance' OR ap.source_record_id <> NEW.id THEN
      RAISE EXCEPTION 'An approved advance needs its own advance payable';
    END IF;
  END IF;
  IF NEW.status = 'paid' THEN
    IF NEW.paid_payment_id IS NULL OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = NEW.paid_payment_id AND p.related_ap_id = OLD.payable_id AND p.status IN ('posted','reconciled')) THEN
      RAISE EXCEPTION 'Advance % is paid only through posted payments against its payable %', OLD.id, OLD.payable_id;
    END IF;
    IF (SELECT coalesce(sum(amount + withheld_tax_amount), 0) FROM payments WHERE related_ap_id = OLD.payable_id AND status IN ('posted','reconciled')) < OLD.amount THEN
      RAISE EXCEPTION 'Advance % is not fully settled', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- A subcontract payable equals its source: advance amount, certificate net + input tax, retention released.
CREATE OR REPLACE FUNCTION ap_subcontract_id(p_source_type TEXT, p_source_id BIGINT) RETURNS BIGINT AS $$
  SELECT CASE p_source_type
    WHEN 'subcontract_certificate' THEN (SELECT subcontract_id FROM subcontract_certificates WHERE id = p_source_id)
    WHEN 'subcontract_retention' THEN (SELECT subcontract_id FROM subcontract_retentions WHERE id = p_source_id)
    WHEN 'subcontract_advance' THEN (SELECT subcontract_id FROM subcontract_advances WHERE id = p_source_id)
  END
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_ap_subcontract_source() RETURNS trigger AS $$
DECLARE sc record; v_expected numeric;
BEGIN
  IF NEW.source_type NOT LIKE 'subcontract%' THEN RETURN NEW; END IF;
  SELECT s.id, s.org_id, s.vendor_id, s.currency_id INTO sc FROM subcontracts s WHERE s.id = ap_subcontract_id(NEW.source_type, NEW.source_record_id);
  IF sc.id IS NULL OR sc.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Subcontract source % % not found in this organization', NEW.source_type, NEW.source_record_id; END IF;
  IF NEW.vendor_id <> sc.vendor_id THEN RAISE EXCEPTION 'Payable vendor % is not the subcontractor %', NEW.vendor_id, sc.vendor_id; END IF;
  IF NEW.currency_id <> sc.currency_id THEN RAISE EXCEPTION 'Payable currency differs from the subcontract currency'; END IF;
  v_expected := CASE NEW.source_type
    WHEN 'subcontract_advance' THEN (SELECT amount FROM subcontract_advances WHERE id = NEW.source_record_id)
    WHEN 'subcontract_retention' THEN (SELECT amount FROM subcontract_retentions WHERE id = NEW.source_record_id)
    WHEN 'subcontract_certificate' THEN (SELECT net_amount_due + coalesce(input_tax_amount, 0) FROM subcontract_certificates WHERE id = NEW.source_record_id)
  END;
  IF NEW.amount <> v_expected THEN
    RAISE EXCEPTION 'Payable % for % % must equal its source amount %', NEW.amount, NEW.source_type, NEW.source_record_id, v_expected;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

ALTER TABLE subcontract_certificates ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) CHECK (tax_treatment IS NULL OR tax_treatment IN ('computed','no_tax_profile'));
ALTER TABLE subcontract_certificates ADD COLUMN IF NOT EXISTS input_tax_code_id BIGINT REFERENCES tax_codes(id);
ALTER TABLE subcontract_certificates ADD COLUMN IF NOT EXISTS input_tax_base NUMERIC(18,2);
ALTER TABLE subcontract_certificates ADD COLUMN IF NOT EXISTS input_tax_amount NUMERIC(18,2) CHECK (input_tax_amount IS NULL OR input_tax_amount >= 0);
ALTER TABLE subcontract_certificates ADD COLUMN IF NOT EXISTS input_tax_point DATE;

DROP TRIGGER IF EXISTS trg_ap_subcontract_source ON accounts_payable;
CREATE TRIGGER trg_ap_subcontract_source BEFORE INSERT OR UPDATE OF amount, source_type, source_record_id, vendor_id, currency_id ON accounts_payable
  FOR EACH ROW EXECUTE FUNCTION guard_ap_subcontract_source();

-- Input tax at approval. Generated columns are not available in BEFORE triggers: the net is read from OLD (the amounts
-- are frozen once QS-certified).
CREATE OR REPLACE FUNCTION guard_subcontract_certificate_tax() RETURNS trigger AS $$
DECLARE prof record; tc record; v_base numeric;
BEGIN
  IF OLD.status = 'qs_certified' AND NEW.status = 'approved' THEN
    SELECT input_tax_code INTO prof FROM subcontract_tax_profiles WHERE subcontract_id = OLD.subcontract_id AND status = 'confirmed';
    NEW.input_tax_point := current_date;
    IF prof.input_tax_code IS NULL THEN
      NEW.tax_treatment := 'no_tax_profile'; NEW.input_tax_code_id := NULL; NEW.input_tax_base := NULL; NEW.input_tax_amount := NULL;
      RETURN NEW;
    END IF;
    SELECT id, rate, base INTO tc FROM tax_codes WHERE org_id = OLD.org_id AND code = prof.input_tax_code AND kind = 'input_tax' AND status = 'confirmed'
      AND effective_from <= current_date AND (effective_to IS NULL OR effective_to >= current_date);
    IF tc.id IS NULL THEN RAISE EXCEPTION 'No confirmed input tax code % effective on %', prof.input_tax_code, current_date; END IF;
    v_base := CASE WHEN tc.base = 'certified_gross' THEN OLD.gross_work_done ELSE OLD.net_amount_due END;
    NEW.tax_treatment := 'computed'; NEW.input_tax_code_id := tc.id; NEW.input_tax_base := v_base; NEW.input_tax_amount := round(v_base * tc.rate / 100, 2);
    RETURN NEW;
  END IF;
  IF (NEW.tax_treatment, NEW.input_tax_code_id, NEW.input_tax_base, NEW.input_tax_amount, NEW.input_tax_point)
     IS DISTINCT FROM (OLD.tax_treatment, OLD.input_tax_code_id, OLD.input_tax_base, OLD.input_tax_amount, OLD.input_tax_point) THEN
    RAISE EXCEPTION 'Subcontract certificate % input tax is computed at approval and is immutable', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_certificate_tax ON subcontract_certificates;
CREATE TRIGGER trg_subcontract_certificate_tax BEFORE UPDATE ON subcontract_certificates FOR EACH ROW EXECUTE FUNCTION guard_subcontract_certificate_tax();

CREATE OR REPLACE FUNCTION guard_payment_settlement() RETURNS trigger AS $$
DECLARE d record; settled numeric; prof record; tc record;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'approved') OR
       (NEW.amount, NEW.withheld_tax_amount, NEW.related_ar_id, NEW.related_ap_id, NEW.party_id, NEW.currency_id) IS DISTINCT FROM (OLD.amount, OLD.withheld_tax_amount, OLD.related_ar_id, OLD.related_ap_id, OLD.party_id, OLD.currency_id)) THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_type = 'incoming' THEN
    SELECT id, client_id AS party, amount, currency_id INTO d FROM accounts_receivable WHERE id = NEW.related_ar_id FOR UPDATE;
    IF d.id IS NULL THEN RAISE EXCEPTION 'Receivable % not found', NEW.related_ar_id; END IF;
    IF NEW.party_id <> d.party THEN RAISE EXCEPTION 'Receipt client % is not the receivable client %', NEW.party_id, d.party; END IF;
    SELECT coalesce(sum(amount + withheld_tax_amount), 0) INTO settled FROM payments
      WHERE related_ar_id = d.id AND id IS DISTINCT FROM NEW.id AND status IN ('approved','posted','reconciled');
    -- DEC-017: tax withheld by the client, as stated on the client's withholding certificate, settles the receivable
    -- with the cash; the code comes from the contract's confirmed tax profile, version effective on the payment date.
    IF NEW.withheld_tax_amount > 0 THEN
      IF length(trim(coalesce(NEW.withholding_certificate_ref, ''))) < 3 THEN RAISE EXCEPTION 'Tax withheld by the client needs the withholding certificate reference'; END IF;
      SELECT p.client_withholding_code INTO prof FROM accounts_receivable a JOIN ipcs i ON i.id = a.ipc_id
        JOIN contract_tax_profiles p ON p.contract_id = i.contract_id AND p.status = 'confirmed' WHERE a.id = d.id;
      IF prof.client_withholding_code IS NULL THEN RAISE EXCEPTION 'The contract has no confirmed client withholding tax code'; END IF;
      SELECT id INTO tc FROM tax_codes WHERE org_id = NEW.org_id AND code = prof.client_withholding_code AND kind = 'withheld_by_client' AND status = 'confirmed'
        AND effective_from <= NEW.payment_date AND (effective_to IS NULL OR effective_to >= NEW.payment_date);
      IF tc.id IS NULL THEN RAISE EXCEPTION 'No confirmed withholding tax code % effective on %', prof.client_withholding_code, NEW.payment_date; END IF;
      NEW.withholding_tax_code_id := tc.id;
    END IF;
  ELSE
    SELECT id, vendor_id AS party, amount, currency_id, source_type, source_record_id INTO d FROM accounts_payable WHERE id = NEW.related_ap_id FOR UPDATE;
    IF d.id IS NULL THEN RAISE EXCEPTION 'Payable % not found', NEW.related_ap_id; END IF;
    IF NEW.party_id <> d.party THEN RAISE EXCEPTION 'Payment vendor % is not the payable vendor %', NEW.party_id, d.party; END IF;
    SELECT coalesce(sum(amount + withheld_tax_amount), 0) INTO settled FROM payments
      WHERE related_ap_id = d.id AND id IS DISTINCT FROM NEW.id AND status IN ('approved','posted','reconciled');
    -- DEC-017: tax we withhold from a subcontractor, as stated on our withholding notice, with the subcontract's
    -- confirmed code (version effective on the payment date).
    IF NEW.withheld_tax_amount > 0 THEN
      IF d.source_type NOT LIKE 'subcontract%' THEN RAISE EXCEPTION 'Withholding applies to subcontract payables with a confirmed tax profile'; END IF;
      IF length(trim(coalesce(NEW.withholding_certificate_ref, ''))) < 3 THEN RAISE EXCEPTION 'Tax withheld from the subcontractor needs our withholding notice reference'; END IF;
      SELECT p.supplier_withholding_code INTO prof FROM subcontract_tax_profiles p
        WHERE p.subcontract_id = ap_subcontract_id(d.source_type, d.source_record_id) AND p.status = 'confirmed';
      IF prof.supplier_withholding_code IS NULL THEN RAISE EXCEPTION 'The subcontract has no confirmed supplier withholding tax code'; END IF;
      SELECT id INTO tc FROM tax_codes WHERE org_id = NEW.org_id AND code = prof.supplier_withholding_code AND kind = 'withheld_from_supplier' AND status = 'confirmed'
        AND effective_from <= NEW.payment_date AND (effective_to IS NULL OR effective_to >= NEW.payment_date);
      IF tc.id IS NULL THEN RAISE EXCEPTION 'No confirmed withholding tax code % effective on %', prof.supplier_withholding_code, NEW.payment_date; END IF;
      NEW.withholding_tax_code_id := tc.id;
    END IF;
  END IF;
  IF NEW.currency_id <> d.currency_id THEN RAISE EXCEPTION 'Payment currency % differs from the % currency %', NEW.currency_id, CASE WHEN NEW.payment_type = 'incoming' THEN 'receivable' ELSE 'payable' END, d.currency_id; END IF;
  IF NEW.amount + NEW.withheld_tax_amount > d.amount - settled THEN
    RAISE EXCEPTION 'Payment % (cash % + tax withheld %) exceeds the outstanding balance % (amount %, already settled %)', NEW.amount + NEW.withheld_tax_amount, NEW.amount, NEW.withheld_tax_amount, d.amount - settled, d.amount, settled;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION apply_payment_settlement() RETURNS trigger AS $$
DECLARE total numeric; posted numeric; last_date date; ap record;
BEGIN
  IF NEW.status NOT IN ('posted','reconciled') OR OLD.status IN ('posted','reconciled') THEN RETURN NEW; END IF;
  IF NEW.related_ar_id IS NOT NULL THEN
    SELECT amount INTO total FROM accounts_receivable WHERE id = NEW.related_ar_id;
    SELECT coalesce(sum(amount + withheld_tax_amount), 0), max(payment_date) INTO posted, last_date FROM payments WHERE related_ar_id = NEW.related_ar_id AND status IN ('posted','reconciled');
    UPDATE accounts_receivable SET status = CASE WHEN posted >= total THEN 'paid' ELSE 'partially_paid' END, updated_at = now() WHERE id = NEW.related_ar_id;
    IF posted >= total THEN
      UPDATE ipcs SET status = 'paid', paid_date = last_date, updated_at = now() WHERE posted_ar_id = NEW.related_ar_id AND status = 'posted';
    END IF;
  ELSIF NEW.related_ap_id IS NOT NULL THEN
    SELECT amount, source_type, source_record_id INTO ap FROM accounts_payable WHERE id = NEW.related_ap_id;
    SELECT coalesce(sum(amount + withheld_tax_amount), 0) INTO posted FROM payments WHERE related_ap_id = NEW.related_ap_id AND status IN ('posted','reconciled');
    UPDATE accounts_payable SET status = CASE WHEN posted >= ap.amount THEN 'paid' ELSE 'partially_paid' END, updated_at = now() WHERE id = NEW.related_ap_id;
    -- F-33: the advance is paid when its payable is settled in full by posted payments.
    IF ap.source_type = 'subcontract_advance' AND posted >= ap.amount THEN
      UPDATE subcontract_advances SET status = 'paid', paid_at = now(), paid_payment_id = NEW.id,
        payment_reference = coalesce(nullif(trim(NEW.reference_no), ''), 'PAYMENT-' || NEW.id)
      WHERE id = ap.source_record_id AND status = 'approved';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS tax_position(date, date);
CREATE FUNCTION tax_position(p_from DATE, p_to DATE) RETURNS TABLE (kind TEXT, code TEXT, documents BIGINT, base NUMERIC, tax NUMERIC) AS $$
  SELECT 'output_tax'::text, t.code::text, count(*), sum(i.output_tax_base), sum(i.output_tax_amount)
  FROM ipcs i JOIN tax_codes t ON t.id = i.output_tax_code_id
  WHERE i.client_certified_on BETWEEN p_from AND p_to AND i.output_tax_amount IS NOT NULL
  GROUP BY t.code
  UNION ALL
  SELECT 'input_tax'::text, t.code::text, count(*), sum(c.input_tax_base), sum(c.input_tax_amount)
  FROM subcontract_certificates c JOIN tax_codes t ON t.id = c.input_tax_code_id
  WHERE c.input_tax_point BETWEEN p_from AND p_to AND c.input_tax_amount IS NOT NULL
  GROUP BY t.code
  UNION ALL
  SELECT t.kind::text, t.code::text, count(*), sum(p.amount + p.withheld_tax_amount), sum(p.withheld_tax_amount)
  FROM payments p JOIN tax_codes t ON t.id = p.withholding_tax_code_id
  WHERE p.payment_date BETWEEN p_from AND p_to AND p.status IN ('posted','reconciled') AND p.withheld_tax_amount > 0
  GROUP BY t.kind, t.code
$$ LANGUAGE sql STABLE;

-- Existing approved (unpaid) advances get their payable so they can be paid through payments.
INSERT INTO accounts_payable (org_id, vendor_id, project_id, source_type, source_record_id, amount, currency_id)
SELECT a.org_id, s.vendor_id, s.project_id, 'subcontract_advance', a.id, a.amount, s.currency_id
FROM subcontract_advances a JOIN subcontracts s ON s.id = a.subcontract_id
WHERE a.status = 'approved' AND a.payable_id IS NULL
ON CONFLICT (source_type, source_record_id) DO NOTHING;
UPDATE subcontract_advances a SET payable_id = ap.id FROM accounts_payable ap
WHERE a.status = 'approved' AND a.payable_id IS NULL AND ap.source_type = 'subcontract_advance' AND ap.source_record_id = a.id;
