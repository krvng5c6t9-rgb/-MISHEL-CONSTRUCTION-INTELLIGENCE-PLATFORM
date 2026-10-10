-- Stage 30 / DEC-009 part 1 (GC-13): the client IPC as a billing, client retention as a conditional contract asset,
-- the client advance as a liability received through receipts. (transaction managed by migrator)
-- Before (E3 @dcbe4cb, analysis section 0): posting an IPC debited receivables with the certified net and credited the
-- IPC rule account; the retention kept by the client and the advance recovered had no GL at all (retention_ledger is
-- an operational list); a client advance was marked 'received' by typing a reference - no receipt, no cash, no GL
-- (mirror of F-33, F-45); retained amounts could never be released and collected (no release, no receivable).
-- Now:
--  * IPC posting (glPosting.service.ts): Dr receivables (certified net) + Dr retention receivable (retention kept) +
--    Dr client advances liability (advance recovered) / Cr the IPC rule account for the period billing (gross). The
--    retention and advance legs need their rules (ipc / retention_receivable, ipc / client_advance) when non-zero.
--    Under DEC-009 the IPC rule credit account is the contract billings control account; revenue is recognised by the
--    revenue recognition run (Stage 31), not here;
--  * receivables carry their source: 'ipc', 'client_advance' (advance request on approval, no GL of its own) or
--    'retention_release' (retention released against its taking-over / defects certificate); a source receivable equals
--    its source amount and the contract client;
--  * a receipt clears the account its receivable was debited to: advance request -> client advances liability,
--    released retention -> retention receivable, IPC -> receivables (rule);
--  * a client advance becomes received only when posted receipts settle its receivable in full; the typed route is
--    refused;
--  * retention release: reason + certificate reference, someone other than the IPC preparer, once, never deleted;
--  * contract_receivable_position(contract): billed, collected, receivables outstanding, retention held / released /
--    collected, advances received / recovered / outstanding liability.
-- Rollback: re-apply 078 guard_payment_settlement / apply_payment_settlement, 070 guard_client_advance, 006 tenant
-- guard; drop the added columns, triggers and functions; restore UNIQUE NOT NULL accounts_receivable.ipc_id.

ALTER TABLE accounts_receivable ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) NOT NULL DEFAULT 'ipc'
  CHECK (source_type IN ('ipc','client_advance','retention_release'));
ALTER TABLE accounts_receivable ADD COLUMN IF NOT EXISTS source_record_id BIGINT;
ALTER TABLE accounts_receivable ALTER COLUMN ipc_id DROP NOT NULL;
ALTER TABLE accounts_receivable ADD CONSTRAINT accounts_receivable_source_shape CHECK (
  (source_type = 'ipc' AND ipc_id IS NOT NULL AND source_record_id IS NULL) OR
  (source_type <> 'ipc' AND ipc_id IS NULL AND source_record_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_source ON accounts_receivable(source_type, source_record_id) WHERE source_type <> 'ipc';

ALTER TABLE client_advances ADD COLUMN IF NOT EXISTS receivable_id BIGINT REFERENCES accounts_receivable(id);
ALTER TABLE client_advances ADD COLUMN IF NOT EXISTS received_payment_id BIGINT REFERENCES payments(id);
ALTER TABLE client_advances DROP CONSTRAINT IF EXISTS client_advances_check1;
ALTER TABLE client_advances ADD CONSTRAINT client_advances_received_evidence CHECK (status <> 'received' OR (
  received_at IS NOT NULL AND length(trim(coalesce(receipt_reference,''))) >= 3 AND
  (received_payment_id IS NOT NULL OR (received_by IS NOT NULL AND received_by <> created_by))));

ALTER TABLE retention_ledger ADD COLUMN IF NOT EXISTS release_reason TEXT;
ALTER TABLE retention_ledger ADD COLUMN IF NOT EXISTS release_reference TEXT;
ALTER TABLE retention_ledger ADD COLUMN IF NOT EXISTS released_by BIGINT REFERENCES users(id);
ALTER TABLE retention_ledger ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE retention_ledger ADD COLUMN IF NOT EXISTS release_receivable_id BIGINT REFERENCES accounts_receivable(id);

-- The tenant guard checked every receivable against an IPC; non-IPC receivables are checked by their source guard.
CREATE OR REPLACE FUNCTION guard_financial_transaction_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE parent_org BIGINT; ref_org BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'accounts_payable' THEN
    SELECT org_id INTO ref_org FROM vendors_subcontractors WHERE id = NEW.vendor_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'AP vendor organization mismatch'; END IF;
    IF NEW.project_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'AP project organization mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'accounts_receivable' THEN
    SELECT org_id INTO ref_org FROM clients WHERE id = NEW.client_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'AR client organization mismatch'; END IF;
    SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'AR project organization mismatch'; END IF;
    IF NEW.ipc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ipcs i WHERE i.id = NEW.ipc_id AND i.org_id = NEW.org_id AND i.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'AR IPC/project organization mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    SELECT org_id INTO ref_org FROM bank_accounts WHERE id = NEW.bank_account_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'Payment bank account organization mismatch'; END IF;
    IF NEW.related_ap_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts_payable ap WHERE ap.id = NEW.related_ap_id AND ap.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment AP organization mismatch';
    END IF;
    IF NEW.related_ar_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts_receivable ar WHERE ar.id = NEW.related_ar_id AND ar.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment AR organization mismatch';
    END IF;
    IF NEW.party_type = 'client' AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.party_id AND c.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment client organization mismatch';
    END IF;
    IF NEW.party_type = 'vendor' AND NOT EXISTS (SELECT 1 FROM vendors_subcontractors v WHERE v.id = NEW.party_id AND v.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Payment vendor organization mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'general_ledger' THEN
    SELECT org_id INTO ref_org FROM chart_of_accounts WHERE id = NEW.account_id;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'GL account organization mismatch'; END IF;
    IF NEW.project_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'GL project organization mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'manual_journal_entries' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM projects WHERE id = NEW.project_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'Manual journal project organization mismatch'; END IF;
    END IF;
    SELECT org_id INTO ref_org FROM users WHERE id = NEW.requested_by;
    IF ref_org IS NULL OR ref_org <> NEW.org_id THEN RAISE EXCEPTION 'Manual journal requester organization mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Contract behind a receivable (IPC, advance request or released retention).
CREATE OR REPLACE FUNCTION ar_contract_id(p_ar BIGINT) RETURNS BIGINT AS $$
  SELECT CASE a.source_type
    WHEN 'ipc' THEN (SELECT contract_id FROM ipcs WHERE id = a.ipc_id)
    WHEN 'client_advance' THEN (SELECT contract_id FROM client_advances WHERE id = a.source_record_id)
    WHEN 'retention_release' THEN (SELECT i.contract_id FROM retention_ledger r JOIN ipcs i ON i.id = r.ipc_id WHERE r.id = a.source_record_id)
  END FROM accounts_receivable a WHERE a.id = p_ar
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_ar_source() RETURNS trigger AS $$
DECLARE c record; v_expected numeric;
BEGIN
  IF NEW.source_type = 'ipc' THEN RETURN NEW; END IF;
  IF NEW.source_type = 'client_advance' THEN
    SELECT k.id, k.org_id, k.client_id, k.project_id, k.currency_id, a.amount AS amt INTO c
      FROM client_advances a JOIN contracts k ON k.id = a.contract_id WHERE a.id = NEW.source_record_id;
  ELSE
    SELECT k.id, k.org_id, k.client_id, k.project_id, k.currency_id, r.retained_amount AS amt, r.release_status INTO c
      FROM retention_ledger r JOIN ipcs i ON i.id = r.ipc_id JOIN contracts k ON k.id = i.contract_id WHERE r.id = NEW.source_record_id;
  END IF;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Receivable source % % not found in this organization', NEW.source_type, NEW.source_record_id; END IF;
  IF NEW.client_id <> c.client_id OR NEW.project_id <> c.project_id THEN RAISE EXCEPTION 'Receivable client/project must be the contract client/project'; END IF;
  IF NEW.currency_id <> c.currency_id THEN RAISE EXCEPTION 'Receivable currency differs from the contract currency'; END IF;
  IF NEW.amount <> c.amt THEN RAISE EXCEPTION 'Receivable % for % % must equal its source amount %', NEW.amount, NEW.source_type, NEW.source_record_id, c.amt; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ar_source ON accounts_receivable;
CREATE TRIGGER trg_ar_source BEFORE INSERT OR UPDATE OF amount, client_id, project_id, currency_id, source_type, source_record_id ON accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION guard_ar_source();

CREATE OR REPLACE FUNCTION guard_client_advance() RETURNS trigger AS $$
DECLARE c record; total numeric; ar record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft client advance can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, contract_status, contract_value, advance_payment_percent INTO c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Contract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A client advance starts as draft'; END IF;
    IF NEW.receivable_id IS NOT NULL OR NEW.received_payment_id IS NOT NULL THEN RAISE EXCEPTION 'A draft client advance has no receivable or receipt'; END IF;
    IF c.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'Client advances are recorded only under a signed or active contract (contract % is %)', c.id, c.contract_status; END IF;
    IF c.advance_payment_percent IS NULL OR c.advance_payment_percent <= 0 THEN
      RAISE EXCEPTION 'Contract % provides no advance payment (advance_payment_percent not set)', c.id;
    END IF;
    SELECT coalesce(sum(amount), 0) INTO total FROM client_advances WHERE contract_id = NEW.contract_id;
    IF total + NEW.amount > round(c.contract_value * c.advance_payment_percent / 100, 2) THEN
      RAISE EXCEPTION 'Client advances % exceed % percent of the contract value %', total + NEW.amount, c.advance_payment_percent, c.contract_value;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.org_id, NEW.contract_id, NEW.amount, NEW.recovery_percent, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.org_id, OLD.contract_id, OLD.amount, OLD.recovery_percent, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Client advance % is approved; its terms are frozen', OLD.id;
  END IF;
  IF OLD.status = 'received' THEN RAISE EXCEPTION 'Client advance % is received and immutable', OLD.id; END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status IN ('draft','approved')) OR (OLD.status = 'approved' AND NEW.status IN ('approved','received'))) THEN
    RAISE EXCEPTION 'Invalid client advance transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.receivable_id IS NOT NULL AND NEW.receivable_id IS DISTINCT FROM OLD.receivable_id THEN RAISE EXCEPTION 'Client advance % receivable is fixed', OLD.id; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'approved' AND NOT (OLD.receivable_id IS NULL AND NEW.receivable_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An approved client advance changes only by being received';
  END IF;
  IF NEW.status = 'approved' THEN
    SELECT id, source_type, source_record_id INTO ar FROM accounts_receivable WHERE id = NEW.receivable_id;
    IF ar.id IS NULL OR ar.source_type <> 'client_advance' OR ar.source_record_id <> NEW.id THEN
      RAISE EXCEPTION 'An approved client advance needs its own advance receivable';
    END IF;
  END IF;
  IF NEW.status = 'received' THEN
    IF NEW.received_payment_id IS NULL OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = NEW.received_payment_id AND p.related_ar_id = OLD.receivable_id AND p.status IN ('posted','reconciled')) THEN
      RAISE EXCEPTION 'Client advance % is received only through posted receipts against its receivable %', OLD.id, OLD.receivable_id;
    END IF;
    IF (SELECT coalesce(sum(amount + withheld_tax_amount), 0) FROM payments WHERE related_ar_id = OLD.receivable_id AND status IN ('posted','reconciled')) < OLD.amount THEN
      RAISE EXCEPTION 'Client advance % is not fully received', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Retention release: once, with reason and certificate reference, into its own receivable; released rows are frozen.
CREATE OR REPLACE FUNCTION guard_retention_release() RETURNS trigger AS $$
DECLARE ar record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retention records are never deleted'; END IF;
  IF OLD.release_status = 'released' THEN RAISE EXCEPTION 'Retention % is released and immutable', OLD.id; END IF;
  IF (NEW.org_id, NEW.project_id, NEW.ipc_id, NEW.retained_amount, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.project_id, OLD.ipc_id, OLD.retained_amount, OLD.created_at) THEN
    RAISE EXCEPTION 'Retention % amount and source are fixed', OLD.id;
  END IF;
  IF NEW.release_status = 'released' THEN
    IF length(trim(coalesce(NEW.release_reason, ''))) < 10 OR length(trim(coalesce(NEW.release_reference, ''))) < 3 OR NEW.released_by IS NULL OR NEW.released_at IS NULL THEN
      RAISE EXCEPTION 'A retention release needs a reason, the certificate reference and who released it';
    END IF;
    IF NEW.released_by = (SELECT prepared_by FROM ipcs WHERE id = OLD.ipc_id) THEN RAISE EXCEPTION 'Segregation of duties: the IPC preparer cannot release its retention'; END IF;
    SELECT id, source_type, source_record_id INTO ar FROM accounts_receivable WHERE id = NEW.release_receivable_id;
    IF ar.id IS NULL OR ar.source_type <> 'retention_release' OR ar.source_record_id <> OLD.id THEN RAISE EXCEPTION 'A released retention needs its own receivable'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_retention_release ON retention_ledger;
CREATE TRIGGER trg_retention_release BEFORE UPDATE OR DELETE ON retention_ledger FOR EACH ROW EXECUTE FUNCTION guard_retention_release();

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
      SELECT p.client_withholding_code INTO prof FROM contract_tax_profiles p
        WHERE p.contract_id = ar_contract_id(d.id) AND p.status = 'confirmed';
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
    -- DEC-009: the client advance is received when its receivable is settled in full by posted receipts.
    IF posted >= total THEN
      UPDATE client_advances SET status = 'received', received_at = now(), received_payment_id = NEW.id,
        receipt_reference = coalesce(nullif(trim(NEW.reference_no), ''), 'RECEIPT-' || NEW.id)
      WHERE receivable_id = NEW.related_ar_id AND status = 'approved';
    END IF;
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

CREATE OR REPLACE FUNCTION contract_receivable_position(p_contract BIGINT) RETURNS jsonb AS $$
  WITH i AS (
    SELECT coalesce(client_certified_amount, net_amount_due) AS net, coalesce(client_certified_retention, less_retention) AS ret,
           coalesce(client_certified_advance_recovery, less_advance_recovery) AS adv, coalesce(output_tax_amount, 0) AS tax
    FROM ipcs WHERE contract_id = p_contract AND status IN ('posted','paid')),
  ar AS (SELECT a.id, a.source_type, a.amount, (SELECT coalesce(sum(p.amount + p.withheld_tax_amount), 0) FROM payments p
           WHERE p.related_ar_id = a.id AND p.status IN ('posted','reconciled')) AS settled
         FROM accounts_receivable a WHERE ar_contract_id(a.id) = p_contract),
  r AS (SELECT r.retained_amount, r.release_status FROM retention_ledger r JOIN ipcs x ON x.id = r.ipc_id WHERE x.contract_id = p_contract)
  SELECT jsonb_build_object(
    'contract_id', p_contract,
    'billed_gross', (SELECT coalesce(sum(net + ret + adv), 0) FROM i),
    'billed_net', (SELECT coalesce(sum(net), 0) FROM i),
    'output_tax_billed', (SELECT coalesce(sum(tax), 0) FROM i),
    'receivables_outstanding', (SELECT coalesce(sum(amount - settled), 0) FROM ar WHERE source_type IN ('ipc','retention_release')),
    'collected', (SELECT coalesce(sum(settled), 0) FROM ar WHERE source_type IN ('ipc','retention_release')),
    'retention_held', (SELECT coalesce(sum(retained_amount), 0) FROM r WHERE release_status = 'held'),
    'retention_released', (SELECT coalesce(sum(retained_amount), 0) FROM r WHERE release_status = 'released'),
    'advances_received', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = p_contract AND status = 'received'),
    'advance_requests_outstanding', (SELECT coalesce(sum(amount - settled), 0) FROM ar WHERE source_type = 'client_advance'),
    'advance_recovered', (SELECT coalesce(sum(adv), 0) FROM i),
    'advance_liability', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = p_contract AND status = 'received') - (SELECT coalesce(sum(adv), 0) FROM i))
$$ LANGUAGE sql STABLE;

-- Existing approved (not received) client advances get their receivable.
INSERT INTO accounts_receivable (org_id, client_id, project_id, source_type, source_record_id, amount, currency_id)
SELECT a.org_id, k.client_id, k.project_id, 'client_advance', a.id, a.amount, k.currency_id
FROM client_advances a JOIN contracts k ON k.id = a.contract_id
WHERE a.status = 'approved' AND a.receivable_id IS NULL
ON CONFLICT DO NOTHING;
UPDATE client_advances a SET receivable_id = ar.id FROM accounts_receivable ar
WHERE a.status = 'approved' AND a.receivable_id IS NULL AND ar.source_type = 'client_advance' AND ar.source_record_id = a.id;
