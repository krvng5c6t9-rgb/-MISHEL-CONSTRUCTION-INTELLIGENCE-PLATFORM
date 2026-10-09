-- Stage 26 / DEC-016, DEC-017 (decided professionally, governance/decisions/DEC-016_019_TAX_FRAMEWORK_CUTOVER.md):
-- tax engine without any rate or rule invented by the system. (transaction managed by migrator)
--  * tax_codes: per-organisation codes (output tax, input tax, tax withheld by client, tax withheld from supplier) with
--    rate, calculation base, GL account, effective dates, legal reference and source; confirmed by a second person;
--    confirmed versions are immutable except closing their effective_to once; versions of a code never overlap.
--  * contract_tax_profiles / subcontract_tax_profiles: which codes apply to a contract, confirmed by a second person.
--  * Output tax is computed when the client certification is recorded (version effective on the certification date),
--    stored on the IPC and immutable; the receivable = certified + output tax. A contract without a confirmed profile
--    computes no tax and the IPC says so (tax_treatment = 'no_tax_profile').
--  * Tax withheld by the client is recorded on the receipt as stated on the client's withholding certificate (reference
--    required) and settles the receivable together with the cash.
--  * E-invoice UUID recorded once on a certified IPC (automatic submission needs the company's credentials).
--  * tax_position(from, to): output tax and tax withheld by clients per code.
-- Supplier side (input tax, withholding on subcontractor payments) is enabled with subcontract payables (Stage 27).
-- Rollback: drop tax tables/columns/triggers; re-apply the 072/073 functions.

CREATE TABLE IF NOT EXISTS tax_codes (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  code VARCHAR(30) NOT NULL CHECK (length(trim(code)) >= 2),
  name TEXT NOT NULL CHECK (length(trim(name)) >= 3),
  kind VARCHAR(25) NOT NULL CHECK (kind IN ('output_tax','input_tax','withheld_by_client','withheld_from_supplier')),
  rate NUMERIC(7,4) CHECK (rate IS NULL OR (rate >= 0 AND rate <= 100)),
  base VARCHAR(25) NOT NULL CHECK (base IN ('certified_net','certified_gross','as_per_certificate')),
  gl_account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  legal_reference TEXT NOT NULL CHECK (length(trim(legal_reference)) >= 3),
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) >= 3),
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  confirmed_by BIGINT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((kind IN ('output_tax','input_tax')) = (base IN ('certified_net','certified_gross'))),
  CHECK (kind NOT IN ('output_tax','input_tax') OR rate IS NOT NULL),
  CHECK (status = 'draft' OR (confirmed_by IS NOT NULL AND confirmed_by <> created_by AND confirmed_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION guard_tax_code() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed tax codes are never deleted; close them with an end date'; END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE id = NEW.gl_account_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'GL account not found in this organization'; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'Tax codes start as draft'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    IF (NEW.org_id, NEW.code, NEW.name, NEW.kind, NEW.rate, NEW.base, NEW.gl_account_id, NEW.effective_from, NEW.legal_reference, NEW.source_reference, NEW.status, NEW.created_by, NEW.confirmed_by)
       IS DISTINCT FROM (OLD.org_id, OLD.code, OLD.name, OLD.kind, OLD.rate, OLD.base, OLD.gl_account_id, OLD.effective_from, OLD.legal_reference, OLD.source_reference, OLD.status, OLD.created_by, OLD.confirmed_by)
       OR OLD.effective_to IS NOT NULL THEN
      RAISE EXCEPTION 'Confirmed tax code % is immutable; only an open end date can be set once (issue a new version)', OLD.id;
    END IF;
    IF NEW.effective_to IS NOT NULL AND EXISTS (SELECT 1 FROM ipcs WHERE output_tax_code_id = OLD.id AND client_certified_on > NEW.effective_to) THEN
      RAISE EXCEPTION 'Tax code % was applied after %', OLD.id, NEW.effective_to;
    END IF;
  END IF;
  IF NEW.status = 'confirmed' AND EXISTS (
       SELECT 1 FROM tax_codes t WHERE t.org_id = NEW.org_id AND t.code = NEW.code AND t.id <> NEW.id AND t.status = 'confirmed'
         AND daterange(t.effective_from, t.effective_to, '[]') && daterange(NEW.effective_from, NEW.effective_to, '[]')) THEN
    RAISE EXCEPTION 'Tax code % already has a confirmed version overlapping % - %', NEW.code, NEW.effective_from, coalesce(NEW.effective_to::text, 'open');
  END IF;
  IF EXISTS (SELECT 1 FROM tax_codes t WHERE t.org_id = NEW.org_id AND t.code = NEW.code AND t.id <> NEW.id AND t.kind <> NEW.kind) THEN
    RAISE EXCEPTION 'All versions of tax code % must have the same kind', NEW.code;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tax_code ON tax_codes;
CREATE TRIGGER trg_tax_code BEFORE INSERT OR UPDATE OR DELETE ON tax_codes FOR EACH ROW EXECUTE FUNCTION guard_tax_code();

CREATE TABLE IF NOT EXISTS contract_tax_profiles (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  contract_id BIGINT NOT NULL UNIQUE REFERENCES contracts(id),
  output_tax_code VARCHAR(30),
  client_withholding_code VARCHAR(30),
  note TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  confirmed_by BIGINT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (output_tax_code IS NOT NULL OR client_withholding_code IS NOT NULL OR length(trim(coalesce(note,''))) >= 10),
  CHECK (status = 'draft' OR (confirmed_by IS NOT NULL AND confirmed_by <> created_by AND confirmed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS subcontract_tax_profiles (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  subcontract_id BIGINT NOT NULL UNIQUE REFERENCES subcontracts(id),
  input_tax_code VARCHAR(30),
  supplier_withholding_code VARCHAR(30),
  note TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  confirmed_by BIGINT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (input_tax_code IS NOT NULL OR supplier_withholding_code IS NOT NULL OR length(trim(coalesce(note,''))) >= 10),
  CHECK (status = 'draft' OR (confirmed_by IS NOT NULL AND confirmed_by <> created_by AND confirmed_at IS NOT NULL))
);
-- A profile names codes that exist with the right kind; confirmed profiles are immutable. One function per table.
CREATE OR REPLACE FUNCTION guard_contract_tax_profile() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed tax profiles are never deleted'; END IF; RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed tax profile % is immutable', OLD.id; END IF;
  IF NOT EXISTS (SELECT 1 FROM contracts WHERE id = NEW.contract_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Contract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'Tax profiles start as draft'; END IF;
  IF NEW.output_tax_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE org_id = NEW.org_id AND code = NEW.output_tax_code AND kind = 'output_tax') THEN
    RAISE EXCEPTION 'Output tax code % not found', NEW.output_tax_code; END IF;
  IF NEW.client_withholding_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE org_id = NEW.org_id AND code = NEW.client_withholding_code AND kind = 'withheld_by_client') THEN
    RAISE EXCEPTION 'Client withholding code % not found', NEW.client_withholding_code; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_tax_profile ON contract_tax_profiles;
CREATE TRIGGER trg_contract_tax_profile BEFORE INSERT OR UPDATE OR DELETE ON contract_tax_profiles FOR EACH ROW EXECUTE FUNCTION guard_contract_tax_profile();
CREATE OR REPLACE FUNCTION guard_subcontract_tax_profile() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed tax profiles are never deleted'; END IF; RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed tax profile % is immutable', OLD.id; END IF;
  IF NOT EXISTS (SELECT 1 FROM subcontracts WHERE id = NEW.subcontract_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Subcontract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'Tax profiles start as draft'; END IF;
  IF NEW.input_tax_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE org_id = NEW.org_id AND code = NEW.input_tax_code AND kind = 'input_tax') THEN
    RAISE EXCEPTION 'Input tax code % not found', NEW.input_tax_code; END IF;
  IF NEW.supplier_withholding_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE org_id = NEW.org_id AND code = NEW.supplier_withholding_code AND kind = 'withheld_from_supplier') THEN
    RAISE EXCEPTION 'Supplier withholding code % not found', NEW.supplier_withholding_code; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_tax_profile ON subcontract_tax_profiles;
CREATE TRIGGER trg_subcontract_tax_profile BEFORE INSERT OR UPDATE OR DELETE ON subcontract_tax_profiles FOR EACH ROW EXECUTE FUNCTION guard_subcontract_tax_profile();

ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS tax_treatment VARCHAR(20) CHECK (tax_treatment IS NULL OR tax_treatment IN ('computed','no_tax_profile'));
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS output_tax_code_id BIGINT REFERENCES tax_codes(id);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS output_tax_base NUMERIC(18,2);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS output_tax_amount NUMERIC(18,2) CHECK (output_tax_amount IS NULL OR output_tax_amount >= 0);
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS einvoice_uuid TEXT;
ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS einvoice_recorded_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS withheld_tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (withheld_tax_amount >= 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS withholding_tax_code_id BIGINT REFERENCES tax_codes(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS withholding_certificate_ref TEXT;

CREATE OR REPLACE FUNCTION guard_ipc_tax() RETURNS trigger AS $$
DECLARE prof record; tc record; v_base numeric;
BEGIN
  IF OLD.status = 'submitted_to_client' AND NEW.status = 'client_approved' THEN
    SELECT output_tax_code INTO prof FROM contract_tax_profiles WHERE contract_id = OLD.contract_id AND status = 'confirmed';
    IF prof.output_tax_code IS NULL THEN
      NEW.tax_treatment := 'no_tax_profile'; NEW.output_tax_code_id := NULL; NEW.output_tax_base := NULL; NEW.output_tax_amount := NULL;
      RETURN NEW;
    END IF;
    SELECT id, rate, base INTO tc FROM tax_codes WHERE org_id = OLD.org_id AND code = prof.output_tax_code AND kind = 'output_tax' AND status = 'confirmed'
      AND effective_from <= NEW.client_certified_on AND (effective_to IS NULL OR effective_to >= NEW.client_certified_on);
    IF tc.id IS NULL THEN RAISE EXCEPTION 'No confirmed output tax code % effective on %', prof.output_tax_code, NEW.client_certified_on; END IF;
    IF tc.base = 'certified_gross' THEN
      IF NEW.client_certified_gross IS NULL THEN RAISE EXCEPTION 'Output tax code % is computed on the certified gross: record the client breakdown', prof.output_tax_code; END IF;
      v_base := NEW.client_certified_gross;
    ELSE
      v_base := NEW.client_certified_amount;
    END IF;
    NEW.tax_treatment := 'computed'; NEW.output_tax_code_id := tc.id; NEW.output_tax_base := v_base; NEW.output_tax_amount := round(v_base * tc.rate / 100, 2);
    RETURN NEW;
  END IF;
  IF (NEW.tax_treatment, NEW.output_tax_code_id, NEW.output_tax_base, NEW.output_tax_amount) IS DISTINCT FROM (OLD.tax_treatment, OLD.output_tax_code_id, OLD.output_tax_base, OLD.output_tax_amount) THEN
    RAISE EXCEPTION 'IPC % output tax is computed at client certification and is immutable', OLD.id;
  END IF;
  IF (NEW.einvoice_uuid, NEW.einvoice_recorded_at) IS DISTINCT FROM (OLD.einvoice_uuid, OLD.einvoice_recorded_at) THEN
    IF OLD.einvoice_uuid IS NOT NULL THEN RAISE EXCEPTION 'IPC % e-invoice reference is recorded and immutable', OLD.id; END IF;
    IF OLD.status NOT IN ('client_approved','posted','paid') THEN RAISE EXCEPTION 'The e-invoice is recorded after the client certification'; END IF;
    IF length(trim(coalesce(NEW.einvoice_uuid, ''))) < 8 THEN RAISE EXCEPTION 'E-invoice UUID is required'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ipc_tax ON ipcs;
CREATE TRIGGER trg_ipc_tax BEFORE UPDATE ON ipcs FOR EACH ROW EXECUTE FUNCTION guard_ipc_tax();

CREATE OR REPLACE FUNCTION guard_ar_ipc_amount() RETURNS trigger AS $$
DECLARE i record;
BEGIN
  IF NEW.ipc_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, net_amount_due, client_certified_amount, output_tax_amount INTO i FROM ipcs WHERE id = NEW.ipc_id;
  IF i.id IS NOT NULL AND NEW.amount <> coalesce(i.client_certified_amount, i.net_amount_due) + coalesce(i.output_tax_amount, 0) THEN
    RAISE EXCEPTION 'Receivable % for IPC % must equal the client-certified amount plus output tax %', NEW.amount, i.id, coalesce(i.client_certified_amount, i.net_amount_due) + coalesce(i.output_tax_amount, 0);
  END IF;
  -- F-37: the due date comes from the confirmed contract payment terms, or is left empty when none are recorded.
  IF i.id IS NOT NULL AND NEW.due_date IS DISTINCT FROM ipc_payment_due_date(i.id) THEN
    RAISE EXCEPTION 'Receivable due date % for IPC % must follow the confirmed contract payment terms (%)', NEW.due_date, i.id, coalesce(ipc_payment_due_date(i.id)::text, 'no payment terms recorded');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

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
    SELECT id, vendor_id AS party, amount, currency_id INTO d FROM accounts_payable WHERE id = NEW.related_ap_id FOR UPDATE;
    IF d.id IS NULL THEN RAISE EXCEPTION 'Payable % not found', NEW.related_ap_id; END IF;
    IF NEW.party_id <> d.party THEN RAISE EXCEPTION 'Payment vendor % is not the payable vendor %', NEW.party_id, d.party; END IF;
    SELECT coalesce(sum(amount + withheld_tax_amount), 0) INTO settled FROM payments
      WHERE related_ap_id = d.id AND id IS DISTINCT FROM NEW.id AND status IN ('approved','posted','reconciled');
    IF NEW.withheld_tax_amount > 0 THEN RAISE EXCEPTION 'Withholding on supplier payments is enabled with subcontract payables (Stage 27)'; END IF;
  END IF;
  IF NEW.currency_id <> d.currency_id THEN RAISE EXCEPTION 'Payment currency % differs from the % currency %', NEW.currency_id, CASE WHEN NEW.payment_type = 'incoming' THEN 'receivable' ELSE 'payable' END, d.currency_id; END IF;
  IF NEW.amount + NEW.withheld_tax_amount > d.amount - settled THEN
    RAISE EXCEPTION 'Payment % (cash % + tax withheld %) exceeds the outstanding balance % (amount %, already settled %)', NEW.amount + NEW.withheld_tax_amount, NEW.amount, NEW.withheld_tax_amount, d.amount - settled, d.amount, settled;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION apply_payment_settlement() RETURNS trigger AS $$
DECLARE total numeric; posted numeric; last_date date;
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
    SELECT amount INTO total FROM accounts_payable WHERE id = NEW.related_ap_id;
    SELECT coalesce(sum(amount + withheld_tax_amount), 0) INTO posted FROM payments WHERE related_ap_id = NEW.related_ap_id AND status IN ('posted','reconciled');
    UPDATE accounts_payable SET status = CASE WHEN posted >= total THEN 'paid' ELSE 'partially_paid' END, updated_at = now() WHERE id = NEW.related_ap_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION receivable_aging(p_as_of DATE) RETURNS TABLE (
  receivable_id BIGINT, client_id BIGINT, project_id BIGINT, ipc_id BIGINT, amount NUMERIC, received NUMERIC, outstanding NUMERIC,
  due_date DATE, days_overdue INT, aging_basis TEXT) AS $$
  SELECT ar.id, ar.client_id, ar.project_id, ar.ipc_id, ar.amount, r.received, ar.amount - r.received,
         ar.due_date,
         CASE WHEN ar.due_date IS NULL THEN NULL ELSE greatest(p_as_of - ar.due_date, 0) END,
         CASE WHEN ar.due_date IS NULL THEN 'no_due_date_recorded' WHEN p_as_of > ar.due_date THEN 'overdue' ELSE 'not_yet_due' END
  FROM accounts_receivable ar
  CROSS JOIN LATERAL (SELECT coalesce(sum(p.amount + p.withheld_tax_amount), 0) AS received FROM payments p
                      WHERE p.related_ar_id = ar.id AND p.status IN ('posted','reconciled') AND p.payment_date <= p_as_of) r
  WHERE ar.amount - r.received > 0
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION tax_position(p_from DATE, p_to DATE) RETURNS TABLE (kind TEXT, code TEXT, documents BIGINT, base NUMERIC, tax NUMERIC) AS $$
  SELECT 'output_tax'::text, t.code::text, count(*), sum(i.output_tax_base), sum(i.output_tax_amount)
  FROM ipcs i JOIN tax_codes t ON t.id = i.output_tax_code_id
  WHERE i.client_certified_on BETWEEN p_from AND p_to AND i.output_tax_amount IS NOT NULL
  GROUP BY t.code
  UNION ALL
  SELECT 'withheld_by_client'::text, t.code::text, count(*), sum(p.amount + p.withheld_tax_amount), sum(p.withheld_tax_amount)
  FROM payments p JOIN tax_codes t ON t.id = p.withholding_tax_code_id
  WHERE p.payment_date BETWEEN p_from AND p_to AND p.status IN ('posted','reconciled') AND p.withheld_tax_amount > 0
  GROUP BY t.code
$$ LANGUAGE sql STABLE;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tax_codes','contract_tax_profiles','subcontract_tax_profiles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
