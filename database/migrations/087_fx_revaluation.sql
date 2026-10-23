-- Stage 48 / CC-078 / DEC-022 (decisions the owner delegated, 2026-10-23): exchange differences and the rate rules.
-- (transaction managed by migrator)
-- Before (E3 @7235c1b): foreign-currency balances kept the rates at which they were recorded for ever - a receivable
-- settled at another rate left a base-currency residue in its control account and nothing reached profit or loss;
-- open foreign balances were never restated at a closing rate; any register rate, however old, could be used.
-- Now (EAS 13: exchange differences on settlement and on translation of monetary items at the closing rate are
-- recognised in profit or loss of the period):
--  * period-end revaluation (cumulative method): for each account the company marks as a monetary item (fx_revalue) and
--    each foreign currency, the base balance is brought to foreign balance x closing rate as of the period end; the
--    difference is an exchange gain or loss, posted in the base currency against the company's exchange gain / loss
--    accounts. This also clears the base residue left by settlements at another rate (the realised difference), so the
--    period's profit or loss carries both. One revaluation per organisation and period end; the next one starts from
--    the balance this one leaves (nothing is reversed).
--  * the closing rate is the register rate for the period end under the same rule as transactions.
--  * a register rate older than the company's maximum rate age (default 7 calendar days - weekends and public-holiday
--    runs; a company setting) can no longer be used: the transaction or revaluation is refused until a current rate is
--    recorded.
--  * no account is assumed: revaluation is refused until the company sets its exchange gain and loss accounts.
-- Rollback: drop table fx_revaluation_lines, fx_revaluations; drop the added columns; restore fx_rate_to_base (085),
-- validate_gl_insert (083) and the source-module check (082).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS fx_gain_account_id BIGINT REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS fx_loss_account_id BIGINT REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS fx_max_rate_age_days INT NOT NULL DEFAULT 7 CHECK (fx_max_rate_age_days BETWEEN 0 AND 366);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS fx_revalue BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE general_ledger ADD COLUMN IF NOT EXISTS fx_revalued_currency_id BIGINT REFERENCES currencies(id);

CREATE TABLE IF NOT EXISTS fx_revaluations (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'posting' CHECK (status IN ('posting', 'posted')),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ,
  UNIQUE (org_id, period_end)
);
CREATE TABLE IF NOT EXISTS fx_revaluation_lines (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  revaluation_id BIGINT NOT NULL REFERENCES fx_revaluations(id),
  account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id),
  currency_id BIGINT NOT NULL REFERENCES currencies(id),
  foreign_balance NUMERIC(18,2) NOT NULL,
  closing_rate NUMERIC(20,8) NOT NULL,
  rate_date DATE NOT NULL,
  base_before NUMERIC(18,2) NOT NULL,
  base_target NUMERIC(18,2) NOT NULL,
  adjustment NUMERIC(18,2) NOT NULL,
  gl_batch_id BIGINT,
  UNIQUE (revaluation_id, account_id, currency_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fx_revaluations','fx_revaluation_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

-- A posted revaluation and its lines are a record: lines are written once; the run only moves posting -> posted.
CREATE OR REPLACE FUNCTION guard_fx_revaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Exchange revaluations cannot be deleted'; END IF;
  IF TG_TABLE_NAME = 'fx_revaluation_lines' THEN
    IF (NEW.revaluation_id, NEW.account_id, NEW.currency_id, NEW.foreign_balance, NEW.closing_rate, NEW.rate_date, NEW.base_before, NEW.base_target, NEW.adjustment)
       IS DISTINCT FROM (OLD.revaluation_id, OLD.account_id, OLD.currency_id, OLD.foreign_balance, OLD.closing_rate, OLD.rate_date, OLD.base_before, OLD.base_target, OLD.adjustment)
       OR (OLD.gl_batch_id IS NOT NULL AND NEW.gl_batch_id IS DISTINCT FROM OLD.gl_batch_id) THEN
      RAISE EXCEPTION 'Exchange revaluation lines are immutable';
    END IF;
  ELSIF OLD.status = 'posted' OR (NEW.org_id, NEW.period_end) IS DISTINCT FROM (OLD.org_id, OLD.period_end) THEN
    RAISE EXCEPTION 'A posted exchange revaluation is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_fx_revaluation ON fx_revaluations;
CREATE TRIGGER trg_guard_fx_revaluation BEFORE UPDATE OR DELETE ON fx_revaluations FOR EACH ROW EXECUTE FUNCTION guard_fx_revaluation();
DROP TRIGGER IF EXISTS trg_guard_fx_revaluation_lines ON fx_revaluation_lines;
CREATE TRIGGER trg_guard_fx_revaluation_lines BEFORE UPDATE OR DELETE ON fx_revaluation_lines FOR EACH ROW EXECUTE FUNCTION guard_fx_revaluation();

-- Rate rule with the maximum rate age (definition otherwise as 085).
CREATE OR REPLACE FUNCTION fx_rate_to_base(p_org bigint, p_currency bigint, p_date date, OUT rate numeric, OUT rate_date date)
LANGUAGE plpgsql STABLE AS $$
DECLARE base bigint; max_age int; cur_code text;
BEGIN
  SELECT base_currency_id, fx_max_rate_age_days INTO base, max_age FROM organizations WHERE id = p_org;
  IF base IS NULL THEN RAISE EXCEPTION 'Organization % has no base currency', p_org; END IF;
  IF p_currency = base THEN rate := 1; rate_date := p_date; RETURN; END IF;
  SELECT e.rate_to_base, e.rate_date INTO rate, rate_date FROM exchange_rates e
   WHERE e.org_id = p_org AND e.currency_id = p_currency AND e.rate_date <= p_date ORDER BY e.rate_date DESC LIMIT 1;
  IF rate IS NOT NULL AND p_date - rate_date > max_age THEN
    SELECT code INTO cur_code FROM currencies WHERE id = p_currency;
    RAISE EXCEPTION 'The latest exchange rate for % is dated %, more than % days before % - record a current rate first', cur_code, rate_date, max_age, p_date;
  END IF;
END $$;

ALTER TABLE general_ledger DROP CONSTRAINT IF EXISTS general_ledger_source_module_check;
ALTER TABLE general_ledger ADD CONSTRAINT general_ledger_source_module_check
  CHECK (source_module IN ('cost_transaction','ipc','payment','manual_journal','payroll_overhead','revenue_recognition','retention_release','opening_balance','fx_revaluation'));

-- GL validation: as 083, plus revaluation lines (base currency, on the period end, for a run being posted).
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
    fr  fx_revaluations%ROWTYPE;
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

    -- Stage 35 (083): released opening client retention is reclassified once, on the project of its contract.
    ELSIF NEW.source_module = 'retention_release' AND NEW.source_table = 'opening_retention_releases' THEN
        IF NOT EXISTS (SELECT 1 FROM opening_retention_releases o JOIN cutover_contract_positions p ON p.id = o.position_id JOIN contracts k ON k.id = p.contract_id
                       WHERE o.id = NEW.source_record_id AND o.kind = 'client' AND o.gl_batch_id IS NULL AND k.project_id = NEW.project_id) THEN
            RAISE EXCEPTION 'Opening retention release % is not a client release awaiting its reclassification on this project.', NEW.source_record_id;
        END IF;

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

    ELSIF NEW.source_module = 'fx_revaluation' THEN
        IF NEW.source_table <> 'fx_revaluations' THEN RAISE EXCEPTION 'fx_revaluation GL rows must have source_table = ''fx_revaluations''.'; END IF;
        SELECT * INTO fr FROM fx_revaluations WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'fx_revaluations row % not found', NEW.source_record_id; END IF;
        IF fr.status <> 'posting' OR NEW.org_id <> fr.org_id OR NEW.transaction_date <> fr.period_end THEN RAISE EXCEPTION 'Exchange revaluation % is not being posted on its period end.', fr.id; END IF;
        IF NEW.currency_id <> (SELECT base_currency_id FROM organizations WHERE id = fr.org_id) THEN RAISE EXCEPTION 'Exchange revaluation lines are in the base currency.'; END IF;

    ELSE
        RAISE EXCEPTION 'Unrecognized GL source_module "%".', NEW.source_module;
    END IF;

    RETURN NEW;
END;
$$;
