-- Stage 34 / GC-24 / DEC-019 part 1: go-live cut-over - opening trial balance, opening receivables and payables,
-- in-flight contract and subcontract positions, mandatory reconciliation, second-person approval, opening journal.
-- (transaction managed by migrator)
-- Before (E3 @d18abd7): no way to bring an existing company's balances into the system - GC-24 legacy import ABSENT;
-- opening figures could only be typed as manual journals, with no tie to receivables, payables, retention or advances.
-- DEC-019 methodology (decided 2026-10-09):
--  * the cut-over date is the first day of a fiscal period (checked) and opening balances are imported only while the
--    organisation has no GL posting at all (no double counting with live activity); one live plan per organisation;
--  * opening trial balance lines (account, debit or credit); opening receivables and payables item by item (party,
--    project, reference, amount, the control account they sit in); in-flight client contracts and subcontracts at
--    cumulative-to-date values (certified gross, retention held, advances received/paid and recovered; for contracts
--    also cost to date, EAC and revenue recognised to date);
--  * cutover_reconciliation(plan): the trial balance must balance, and every control account must equal its detail -
--    receivable / payable accounts vs their items; retention receivable, client advances liability, subcontract
--    retention payable and subcontract advance asset (the accounts the posting rules use) vs the positions. Approval is
--    refused unless every line agrees; a position without a configured account rule is itself a difference;
--  * the preparer reconciles (status 'reconciled', report frozen with SHA-256); someone else approves: the opening
--    journal posts on the cut-over date (GL source 'opening_balance', one balanced batch) and the opening receivables
--    and payables become collectable / payable items (source 'opening') that clear their own control account;
--  * everything is frozen once opened. The cut-over date itself is the owner's decision (OI-4).
-- Not in this stage (F-49): live engines do not yet continue from the opening positions (revenue run baseline, the
-- next subcontract certificate's previous cumulative, release of opening retention, recovery of opening advances).
-- Rollback: drop the cutover_* tables and functions; re-apply 081 validate_gl_insert, 079 guard_ar_source and
-- ar_contract_id; restore the AR / AP source_type and GL source_module checks.

ALTER TABLE general_ledger DROP CONSTRAINT IF EXISTS general_ledger_source_module_check;
ALTER TABLE general_ledger ADD CONSTRAINT general_ledger_source_module_check
  CHECK (source_module IN ('cost_transaction','ipc','payment','manual_journal','payroll_overhead','revenue_recognition','retention_release','opening_balance'));

CREATE TABLE IF NOT EXISTS cutover_plans (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  cutover_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reconciled','opened','cancelled')),
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  reconciliation JSONB,
  reconciliation_sha256 CHAR(64),
  reconciled_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  gl_batch_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'reconciled' OR (reconciliation IS NOT NULL AND reconciliation_sha256 IS NOT NULL AND reconciled_at IS NOT NULL)),
  CHECK (status <> 'opened' OR (approved_by IS NOT NULL AND approved_by <> prepared_by AND approved_at IS NOT NULL AND gl_batch_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cutover_live_plan ON cutover_plans(org_id) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS cutover_tb_lines (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), plan_id BIGINT NOT NULL REFERENCES cutover_plans(id),
  account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id),
  debit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0), credit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  note TEXT,
  CHECK ((debit > 0) <> (credit > 0))
);
CREATE TABLE IF NOT EXISTS cutover_receivables (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), plan_id BIGINT NOT NULL REFERENCES cutover_plans(id),
  client_id BIGINT NOT NULL REFERENCES clients(id), project_id BIGINT NOT NULL REFERENCES projects(id), contract_id BIGINT REFERENCES contracts(id),
  reference TEXT NOT NULL CHECK (length(trim(reference)) >= 2), amount NUMERIC(18,2) NOT NULL CHECK (amount > 0), due_date DATE,
  gl_account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id), receivable_id BIGINT REFERENCES accounts_receivable(id),
  UNIQUE (plan_id, reference)
);
CREATE TABLE IF NOT EXISTS cutover_payables (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), plan_id BIGINT NOT NULL REFERENCES cutover_plans(id),
  vendor_id BIGINT NOT NULL REFERENCES vendors_subcontractors(id), project_id BIGINT REFERENCES projects(id), subcontract_id BIGINT REFERENCES subcontracts(id),
  reference TEXT NOT NULL CHECK (length(trim(reference)) >= 2), amount NUMERIC(18,2) NOT NULL CHECK (amount > 0), due_date DATE,
  gl_account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id), payable_id BIGINT REFERENCES accounts_payable(id),
  UNIQUE (plan_id, reference)
);
CREATE TABLE IF NOT EXISTS cutover_contract_positions (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), plan_id BIGINT NOT NULL REFERENCES cutover_plans(id),
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  certified_gross_to_date NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (certified_gross_to_date >= 0),
  retention_held NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (retention_held >= 0),
  advances_received NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (advances_received >= 0),
  advance_recovered NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (advance_recovered >= 0),
  cost_to_date NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cost_to_date >= 0),
  eac NUMERIC(18,2) CHECK (eac IS NULL OR eac > 0),
  revenue_recognised_to_date NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (revenue_recognised_to_date >= 0),
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) >= 3),
  UNIQUE (plan_id, contract_id),
  CHECK (advance_recovered <= advances_received),
  CHECK (retention_held + advance_recovered <= certified_gross_to_date)
);
CREATE TABLE IF NOT EXISTS cutover_subcontract_positions (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES organizations(id), plan_id BIGINT NOT NULL REFERENCES cutover_plans(id),
  subcontract_id BIGINT NOT NULL REFERENCES subcontracts(id),
  certified_gross_to_date NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (certified_gross_to_date >= 0),
  retention_held NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (retention_held >= 0),
  advance_paid NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (advance_paid >= 0),
  advance_recovered NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (advance_recovered >= 0),
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) >= 3),
  UNIQUE (plan_id, subcontract_id),
  CHECK (advance_recovered <= advance_paid),
  CHECK (retention_held + advance_recovered <= certified_gross_to_date)
);

-- Plan lifecycle: created on the first day of a fiscal period of an organisation without any posting; moves
-- draft -> reconciled (clean report) -> opened (approved by someone else, journal posted); reconciled -> draft to
-- correct; draft -> cancelled. Opened plans are immutable.
CREATE OR REPLACE FUNCTION guard_cutover_plan() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cut-over plans are never deleted; cancel a draft instead'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A cut-over plan starts as draft'; END IF;
    IF NOT EXISTS (SELECT 1 FROM fiscal_periods WHERE org_id = NEW.org_id AND start_date = NEW.cutover_date) THEN
      RAISE EXCEPTION 'The cut-over date % must be the first day of a fiscal period of this organisation (DEC-019)', NEW.cutover_date;
    END IF;
    IF EXISTS (SELECT 1 FROM general_ledger WHERE org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Opening balances are imported only before any GL posting; this organisation already has postings';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('opened','cancelled') THEN RAISE EXCEPTION 'Cut-over plan % is % and immutable', OLD.id, OLD.status; END IF;
  IF (NEW.org_id, NEW.cutover_date, NEW.prepared_by, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.cutover_date, OLD.prepared_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Cut-over plan date and author are fixed';
  END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status IN ('reconciled','cancelled')) OR (OLD.status = 'reconciled' AND NEW.status IN ('draft','opened'))) THEN
    RAISE EXCEPTION 'Invalid cut-over plan transition % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'reconciled' AND (NEW.reconciliation->>'clean')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'The reconciliation has differences; the plan cannot be marked reconciled';
  END IF;
  IF NEW.status = 'draft' THEN NEW.reconciliation := NULL; NEW.reconciliation_sha256 := NULL; NEW.reconciled_at := NULL; END IF;
  IF NEW.status = 'opened' THEN
    IF NEW.approved_by = OLD.prepared_by THEN RAISE EXCEPTION 'Segregation of duties: the preparer cannot approve the opening balances'; END IF;
    IF NEW.gl_batch_id IS NULL OR NOT EXISTS (SELECT 1 FROM general_ledger WHERE journal_batch_id = NEW.gl_batch_id AND source_module = 'opening_balance' AND source_record_id = OLD.id) THEN
      RAISE EXCEPTION 'Cut-over plan % is opened by posting its opening journal', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cutover_plan ON cutover_plans;
CREATE TRIGGER trg_cutover_plan BEFORE INSERT OR UPDATE OR DELETE ON cutover_plans FOR EACH ROW EXECUTE FUNCTION guard_cutover_plan();

-- Detail rows change only while their plan is draft (the generated receivable / payable link is set once at opening),
-- and every referenced record belongs to the plan's organisation. One function per table.
CREATE OR REPLACE FUNCTION cutover_plan_editable(p_plan BIGINT, p_org BIGINT, p_link_only BOOLEAN) RETURNS VOID AS $$
DECLARE st text; o bigint;
BEGIN
  SELECT status, org_id INTO st, o FROM cutover_plans WHERE id = p_plan;
  IF o IS NULL OR o <> p_org THEN RAISE EXCEPTION 'Cut-over plan not found in this organisation'; END IF;
  IF p_link_only THEN
    IF st <> 'reconciled' THEN RAISE EXCEPTION 'Opening items are linked only while the plan is being opened'; END IF;
  ELSIF st <> 'draft' THEN RAISE EXCEPTION 'Cut-over plan % is %: reopen it to change its lines', p_plan, st; END IF;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION same_org(p_table TEXT, p_id BIGINT, p_org BIGINT) RETURNS BOOLEAN AS $$
DECLARE o bigint;
BEGIN
  IF p_id IS NULL THEN RETURN true; END IF;
  EXECUTE format('SELECT org_id FROM %I WHERE id = $1', p_table) INTO o USING p_id;
  RETURN o = p_org;
END $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION guard_cutover_tb_line() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM cutover_plan_editable(OLD.plan_id, OLD.org_id, false); RETURN OLD; END IF;
  PERFORM cutover_plan_editable(NEW.plan_id, NEW.org_id, false);
  IF NOT same_org('chart_of_accounts', NEW.account_id, NEW.org_id) THEN RAISE EXCEPTION 'Account not found in this organisation'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION guard_cutover_receivable() RETURNS trigger AS $$
DECLARE link_only boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM cutover_plan_editable(OLD.plan_id, OLD.org_id, false); RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN
    link_only := OLD.receivable_id IS NULL AND NEW.receivable_id IS NOT NULL AND (to_jsonb(NEW) - 'receivable_id') = (to_jsonb(OLD) - 'receivable_id');
  END IF;
  PERFORM cutover_plan_editable(NEW.plan_id, NEW.org_id, link_only);
  IF true THEN
    IF NOT (same_org('clients', NEW.client_id, NEW.org_id) AND same_org('projects', NEW.project_id, NEW.org_id) AND same_org('contracts', NEW.contract_id, NEW.org_id) AND same_org('chart_of_accounts', NEW.gl_account_id, NEW.org_id)) THEN
      RAISE EXCEPTION 'Client, project, contract or account not found in this organisation';
    END IF;
    IF NEW.contract_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contracts WHERE id = NEW.contract_id AND client_id = NEW.client_id AND project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'The receivable client/project must be the contract client/project';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION guard_cutover_payable() RETURNS trigger AS $$
DECLARE link_only boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM cutover_plan_editable(OLD.plan_id, OLD.org_id, false); RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN
    link_only := OLD.payable_id IS NULL AND NEW.payable_id IS NOT NULL AND (to_jsonb(NEW) - 'payable_id') = (to_jsonb(OLD) - 'payable_id');
  END IF;
  PERFORM cutover_plan_editable(NEW.plan_id, NEW.org_id, link_only);
  IF true THEN
    IF NOT (same_org('vendors_subcontractors', NEW.vendor_id, NEW.org_id) AND same_org('projects', NEW.project_id, NEW.org_id) AND same_org('subcontracts', NEW.subcontract_id, NEW.org_id) AND same_org('chart_of_accounts', NEW.gl_account_id, NEW.org_id)) THEN
      RAISE EXCEPTION 'Vendor, project, subcontract or account not found in this organisation';
    END IF;
    IF NEW.subcontract_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcontracts WHERE id = NEW.subcontract_id AND vendor_id = NEW.vendor_id) THEN
      RAISE EXCEPTION 'The payable vendor must be the subcontractor';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION guard_cutover_contract_position() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM cutover_plan_editable(OLD.plan_id, OLD.org_id, false); RETURN OLD; END IF;
  PERFORM cutover_plan_editable(NEW.plan_id, NEW.org_id, false);
  IF NOT EXISTS (SELECT 1 FROM contracts WHERE id = NEW.contract_id AND org_id = NEW.org_id AND contract_status IN ('signed','active')) THEN
    RAISE EXCEPTION 'An in-flight contract position needs a signed or active contract of this organisation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION guard_cutover_subcontract_position() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM cutover_plan_editable(OLD.plan_id, OLD.org_id, false); RETURN OLD; END IF;
  PERFORM cutover_plan_editable(NEW.plan_id, NEW.org_id, false);
  IF NOT EXISTS (SELECT 1 FROM subcontracts WHERE id = NEW.subcontract_id AND org_id = NEW.org_id AND status = 'active') THEN
    RAISE EXCEPTION 'An in-flight subcontract position needs an active subcontract of this organisation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cutover_tb_line ON cutover_tb_lines;
CREATE TRIGGER trg_cutover_tb_line BEFORE INSERT OR UPDATE OR DELETE ON cutover_tb_lines FOR EACH ROW EXECUTE FUNCTION guard_cutover_tb_line();
DROP TRIGGER IF EXISTS trg_cutover_receivable ON cutover_receivables;
CREATE TRIGGER trg_cutover_receivable BEFORE INSERT OR UPDATE OR DELETE ON cutover_receivables FOR EACH ROW EXECUTE FUNCTION guard_cutover_receivable();
DROP TRIGGER IF EXISTS trg_cutover_payable ON cutover_payables;
CREATE TRIGGER trg_cutover_payable BEFORE INSERT OR UPDATE OR DELETE ON cutover_payables FOR EACH ROW EXECUTE FUNCTION guard_cutover_payable();
DROP TRIGGER IF EXISTS trg_cutover_contract_position ON cutover_contract_positions;
CREATE TRIGGER trg_cutover_contract_position BEFORE INSERT OR UPDATE OR DELETE ON cutover_contract_positions FOR EACH ROW EXECUTE FUNCTION guard_cutover_contract_position();
DROP TRIGGER IF EXISTS trg_cutover_subcontract_position ON cutover_subcontract_positions;
CREATE TRIGGER trg_cutover_subcontract_position BEFORE INSERT OR UPDATE OR DELETE ON cutover_subcontract_positions FOR EACH ROW EXECUTE FUNCTION guard_cutover_subcontract_position();

-- The account a posting rule uses (exact subtype only), or NULL when the rule is not configured.
CREATE OR REPLACE FUNCTION rule_account(p_org BIGINT, p_module TEXT, p_subtype TEXT, p_side TEXT) RETURNS BIGINT AS $$
  SELECT CASE WHEN p_side = 'debit' THEN debit_account_id ELSE credit_account_id END FROM gl_posting_rules
  WHERE org_id = p_org AND source_module = p_module AND source_subtype = p_subtype AND is_active
    AND effective_from <= current_date AND (effective_to IS NULL OR effective_to >= current_date)
  ORDER BY effective_from DESC, id DESC LIMIT 1
$$ LANGUAGE sql STABLE;

-- Mandatory reconciliation (DEC-019): control accounts in the opening trial balance vs their detail.
CREATE OR REPLACE FUNCTION cutover_reconciliation(p_plan BIGINT) RETURNS jsonb AS $$
DECLARE p record; v_lines jsonb := '[]'::jsonb; r record; acc bigint; tb numeric; det numeric; dr numeric; cr numeric;
BEGIN
  SELECT * INTO p FROM cutover_plans WHERE id = p_plan;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO dr, cr FROM cutover_tb_lines WHERE plan_id = p_plan;
  v_lines := v_lines || jsonb_build_object('check', 'trial_balance', 'account_id', NULL, 'trial_balance', dr, 'detail', cr, 'difference', dr - cr,
    'note', 'total debits vs total credits');
  FOR r IN SELECT gl_account_id, sum(amount) AS total, count(*) AS n FROM cutover_receivables WHERE plan_id = p_plan GROUP BY gl_account_id LOOP
    SELECT coalesce(sum(debit - credit), 0) INTO tb FROM cutover_tb_lines WHERE plan_id = p_plan AND account_id = r.gl_account_id;
    v_lines := v_lines || jsonb_build_object('check', 'receivables', 'account_id', r.gl_account_id, 'trial_balance', tb, 'detail', r.total, 'difference', tb - r.total, 'note', r.n || ' opening receivables');
  END LOOP;
  FOR r IN SELECT gl_account_id, sum(amount) AS total, count(*) AS n FROM cutover_payables WHERE plan_id = p_plan GROUP BY gl_account_id LOOP
    SELECT coalesce(sum(credit - debit), 0) INTO tb FROM cutover_tb_lines WHERE plan_id = p_plan AND account_id = r.gl_account_id;
    v_lines := v_lines || jsonb_build_object('check', 'payables', 'account_id', r.gl_account_id, 'trial_balance', tb, 'detail', r.total, 'difference', tb - r.total, 'note', r.n || ' opening payables');
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('retention_receivable', 'ipc', 'retention_receivable', 'debit', 1, (SELECT coalesce(sum(retention_held), 0) FROM cutover_contract_positions WHERE plan_id = p_plan)),
      ('client_advances', 'ipc', 'client_advance', 'debit', -1, (SELECT coalesce(sum(advances_received - advance_recovered), 0) FROM cutover_contract_positions WHERE plan_id = p_plan)),
      ('subcontract_retention', 'cost_transaction', 'subcontract_retention', 'credit', -1, (SELECT coalesce(sum(retention_held), 0) FROM cutover_subcontract_positions WHERE plan_id = p_plan)),
      ('subcontract_advances', 'cost_transaction', 'subcontract_advance', 'credit', 1, (SELECT coalesce(sum(advance_paid - advance_recovered), 0) FROM cutover_subcontract_positions WHERE plan_id = p_plan))
    ) AS t(chk, module, subtype, side, sign, total) LOOP
    acc := rule_account(p.org_id, r.module, r.subtype, r.side);
    IF acc IS NULL THEN
      IF r.total <> 0 THEN
        v_lines := v_lines || jsonb_build_object('check', r.chk, 'account_id', NULL, 'trial_balance', NULL, 'detail', r.total, 'difference', r.total,
          'note', format('no active posting rule %s / %s: the account holding this balance is unknown', r.module, r.subtype));
      END IF;
      CONTINUE;
    END IF;
    SELECT coalesce(sum((debit - credit) * r.sign), 0) INTO tb FROM cutover_tb_lines WHERE plan_id = p_plan AND account_id = acc;
    IF tb <> 0 OR r.total <> 0 THEN
      v_lines := v_lines || jsonb_build_object('check', r.chk, 'account_id', acc, 'trial_balance', tb, 'detail', r.total, 'difference', tb - r.total,
        'note', format('positions vs the %s / %s rule account', r.module, r.subtype));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('plan_id', p_plan, 'cutover_date', p.cutover_date, 'lines', v_lines,
    'counts', jsonb_build_object('tb_lines', (SELECT count(*) FROM cutover_tb_lines WHERE plan_id = p_plan),
      'receivables', (SELECT count(*) FROM cutover_receivables WHERE plan_id = p_plan), 'payables', (SELECT count(*) FROM cutover_payables WHERE plan_id = p_plan),
      'contracts', (SELECT count(*) FROM cutover_contract_positions WHERE plan_id = p_plan), 'subcontracts', (SELECT count(*) FROM cutover_subcontract_positions WHERE plan_id = p_plan)),
    'clean', dr > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l WHERE (l->>'difference')::numeric <> 0));
END $$ LANGUAGE plpgsql STABLE;

-- Opening receivables / payables: equal to their cut-over item; a receipt / payment clears the item's control account.
ALTER TABLE accounts_receivable DROP CONSTRAINT IF EXISTS accounts_receivable_source_type_check;
ALTER TABLE accounts_receivable ADD CONSTRAINT accounts_receivable_source_type_check CHECK (source_type IN ('ipc','client_advance','retention_release','opening'));
ALTER TABLE accounts_payable DROP CONSTRAINT IF EXISTS accounts_payable_source_type_check;
ALTER TABLE accounts_payable ADD CONSTRAINT accounts_payable_source_type_check
  CHECK (source_type IN ('vendor_invoice','subcontract_certificate','subcontract_retention','subcontract_advance','opening'));

CREATE OR REPLACE FUNCTION guard_ar_source() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF NEW.source_type = 'ipc' THEN RETURN NEW; END IF;
  IF NEW.source_type = 'opening' THEN
    SELECT o.id, o.org_id, o.client_id, o.project_id, org.base_currency_id AS currency_id, o.amount AS amt INTO c
      FROM cutover_receivables o JOIN organizations org ON org.id = o.org_id WHERE o.id = NEW.source_record_id;
  ELSIF NEW.source_type = 'client_advance' THEN
    SELECT k.id, k.org_id, k.client_id, k.project_id, k.currency_id, a.amount AS amt INTO c
      FROM client_advances a JOIN contracts k ON k.id = a.contract_id WHERE a.id = NEW.source_record_id;
  ELSE
    SELECT k.id, k.org_id, k.client_id, k.project_id, k.currency_id, r.retained_amount AS amt INTO c
      FROM retention_ledger r JOIN ipcs i ON i.id = r.ipc_id JOIN contracts k ON k.id = i.contract_id WHERE r.id = NEW.source_record_id;
  END IF;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Receivable source % % not found in this organization', NEW.source_type, NEW.source_record_id; END IF;
  IF NEW.client_id <> c.client_id OR NEW.project_id <> c.project_id THEN RAISE EXCEPTION 'Receivable client/project must be the source client/project'; END IF;
  IF NEW.currency_id <> c.currency_id THEN RAISE EXCEPTION 'Receivable currency differs from the source currency'; END IF;
  IF NEW.amount <> c.amt THEN RAISE EXCEPTION 'Receivable % for % % must equal its source amount %', NEW.amount, NEW.source_type, NEW.source_record_id, c.amt; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ar_contract_id(p_ar BIGINT) RETURNS BIGINT AS $$
  SELECT CASE a.source_type
    WHEN 'ipc' THEN (SELECT contract_id FROM ipcs WHERE id = a.ipc_id)
    WHEN 'client_advance' THEN (SELECT contract_id FROM client_advances WHERE id = a.source_record_id)
    WHEN 'retention_release' THEN (SELECT i.contract_id FROM retention_ledger r JOIN ipcs i ON i.id = r.ipc_id WHERE r.id = a.source_record_id)
    WHEN 'opening' THEN (SELECT contract_id FROM cutover_receivables WHERE id = a.source_record_id)
  END FROM accounts_receivable a WHERE a.id = p_ar
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_ap_opening() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF NEW.source_type <> 'opening' THEN RETURN NEW; END IF;
  SELECT o.id, o.org_id, o.vendor_id, o.project_id, org.base_currency_id AS currency_id, o.amount INTO c
    FROM cutover_payables o JOIN organizations org ON org.id = o.org_id WHERE o.id = NEW.source_record_id;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Opening payable % not found in this organization', NEW.source_record_id; END IF;
  IF NEW.vendor_id <> c.vendor_id OR NEW.project_id IS DISTINCT FROM c.project_id OR NEW.currency_id <> c.currency_id OR NEW.amount <> c.amount THEN
    RAISE EXCEPTION 'Opening payable must equal its cut-over item (vendor, project, currency, amount %)', c.amount;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ap_opening ON accounts_payable;
CREATE TRIGGER trg_ap_opening BEFORE INSERT OR UPDATE OF amount, source_type, source_record_id, vendor_id, project_id, currency_id ON accounts_payable
  FOR EACH ROW EXECUTE FUNCTION guard_ap_opening();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cutover_plans','cutover_tb_lines','cutover_receivables','cutover_payables','cutover_contract_positions','cutover_subcontract_positions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

-- Opening journal (Stage 34): only for a reconciled plan not yet opened, on its cut-over date, in the base currency.
CREATE OR REPLACE FUNCTION validate_gl_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE
    ct  cost_transactions%ROWTYPE;
    ipc ipcs%ROWTYPE;
    pay payments%ROWTYPE;
    mje manual_journal_entries%ROWTYPE;
    pl  payroll_lines%ROWTYPE;
    pr  payroll_runs%ROWTYPE;
    rr  revenue_recognition_runs%ROWTYPE;
    rl  retention_ledger%ROWTYPE;
    cp  cutover_plans%ROWTYPE;
BEGIN
    IF NEW.source_module = 'cost_transaction' THEN
        IF NEW.source_table <> 'cost_transactions' THEN
            RAISE EXCEPTION 'cost_transaction GL rows must have source_table = ''cost_transactions''.';
        END IF;
        SELECT * INTO ct FROM cost_transactions WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'cost_transactions row % not found', NEW.source_record_id; END IF;
        IF ct.is_posted_to_gl THEN RAISE EXCEPTION 'cost_transactions % already posted to GL.', ct.id; END IF;
        IF NEW.project_id IS DISTINCT FROM ct.project_id THEN RAISE EXCEPTION 'project_id mismatch for %.', ct.id; END IF;
        IF NEW.currency_id <> ct.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for %.', ct.id; END IF;

    ELSIF NEW.source_module = 'ipc' THEN
        IF NEW.source_table <> 'ipcs' THEN RAISE EXCEPTION 'ipc GL rows must have source_table = ''ipcs''.'; END IF;
        SELECT * INTO ipc FROM ipcs WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'ipcs row % not found', NEW.source_record_id; END IF;
        IF ipc.status <> 'client_approved' THEN RAISE EXCEPTION 'ipcs % status "%" not postable.', ipc.id, ipc.status; END IF;
        IF ipc.posted_ar_id IS NOT NULL THEN RAISE EXCEPTION 'ipcs % already posted.', ipc.id; END IF;
        IF NEW.project_id <> ipc.project_id THEN RAISE EXCEPTION 'project_id mismatch for %.', ipc.id; END IF;

    ELSIF NEW.source_module = 'payment' THEN
        IF NEW.source_table <> 'payments' THEN RAISE EXCEPTION 'payment GL rows must have source_table = ''payments''.'; END IF;
        SELECT * INTO pay FROM payments WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'payments row % not found', NEW.source_record_id; END IF;
        IF pay.status <> 'approved' THEN RAISE EXCEPTION 'payments % status "%" not postable.', pay.id, pay.status; END IF;
        IF NEW.currency_id <> pay.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for %.', pay.id; END IF;

    ELSIF NEW.source_module = 'manual_journal' THEN
        IF NEW.source_table <> 'manual_journal_entries' THEN RAISE EXCEPTION 'must have source_table = ''manual_journal_entries''.'; END IF;
        SELECT * INTO mje FROM manual_journal_entries WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'manual_journal_entries row % not found', NEW.source_record_id; END IF;
        IF mje.status <> 'approved' THEN RAISE EXCEPTION 'manual_journal_entries % status "%" not postable.', mje.id, mje.status; END IF;

    -- ---------------- payroll_overhead: NEW in Phase 4 ----------------
    ELSIF NEW.source_module = 'payroll_overhead' THEN
        IF NEW.source_table <> 'payroll_lines' THEN
            RAISE EXCEPTION 'payroll_overhead GL rows must have source_table = ''payroll_lines''.';
        END IF;
        SELECT * INTO pl FROM payroll_lines WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'payroll_lines row % not found', NEW.source_record_id; END IF;
        IF pl.project_id IS NOT NULL THEN
            RAISE EXCEPTION 'payroll_lines % has a project_id — project-allocated payroll posts via cost_transactions, not payroll_overhead.', pl.id;
        END IF;
        SELECT * INTO pr FROM payroll_runs WHERE id = pl.payroll_run_id;
        IF pr.status <> 'approved' THEN RAISE EXCEPTION 'payroll_runs % status "%" not postable.', pr.id, pr.status; END IF;
        IF pl.posted_gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'payroll_lines % already posted to GL.', pl.id; END IF;
        IF NEW.currency_id <> pl.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for payroll_lines %.', pl.id; END IF;

    -- ---------------- Stage 31 / DEC-009 (080) ----------------
    ELSIF NEW.source_module = 'revenue_recognition' THEN
        IF NEW.source_table <> 'revenue_recognition_runs' THEN RAISE EXCEPTION 'revenue_recognition GL rows must have source_table = ''revenue_recognition_runs''.'; END IF;
        SELECT * INTO rr FROM revenue_recognition_runs WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'revenue_recognition_runs row % not found', NEW.source_record_id; END IF;
        IF rr.status <> 'prepared' THEN RAISE EXCEPTION 'Revenue run % is % and cannot be posted again.', rr.id, rr.status; END IF;
        IF NEW.project_id IS DISTINCT FROM rr.project_id THEN RAISE EXCEPTION 'project_id mismatch for revenue run %.', rr.id; END IF;
        IF NEW.transaction_date <> rr.period_end THEN RAISE EXCEPTION 'Revenue run % posts on its period end %.', rr.id, rr.period_end; END IF;

    ELSIF NEW.source_module = 'retention_release' THEN
        IF NEW.source_table <> 'retention_ledger' THEN RAISE EXCEPTION 'retention_release GL rows must have source_table = ''retention_ledger''.'; END IF;
        SELECT * INTO rl FROM retention_ledger WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'retention_ledger row % not found', NEW.source_record_id; END IF;
        IF rl.release_status <> 'released' OR rl.release_gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'Retention % is not a released, unposted retention.', rl.id; END IF;
        IF NEW.project_id IS DISTINCT FROM rl.project_id THEN RAISE EXCEPTION 'project_id mismatch for retention %.', rl.id; END IF;

    ELSIF NEW.source_module = 'opening_balance' THEN
        IF NEW.source_table <> 'cutover_plans' THEN RAISE EXCEPTION 'opening_balance GL rows must have source_table = ''cutover_plans''.'; END IF;
        SELECT * INTO cp FROM cutover_plans WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'cutover_plans row % not found', NEW.source_record_id; END IF;
        IF cp.status <> 'reconciled' OR cp.gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'Cut-over plan % is not a reconciled plan awaiting its opening journal.', cp.id; END IF;
        IF NEW.org_id <> cp.org_id OR NEW.transaction_date <> cp.cutover_date THEN RAISE EXCEPTION 'The opening journal posts on the cut-over date % of its organisation.', cp.cutover_date; END IF;
        IF NEW.currency_id <> (SELECT base_currency_id FROM organizations WHERE id = cp.org_id) THEN RAISE EXCEPTION 'The opening journal is in the base currency.'; END IF;

    ELSE
        RAISE EXCEPTION 'Unrecognized GL source_module "%".', NEW.source_module;
    END IF;

    RETURN NEW;
END;
$$;

