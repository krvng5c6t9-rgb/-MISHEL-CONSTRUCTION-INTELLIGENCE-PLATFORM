-- Stage 46 / CC-076 / DEC-021 (owner decision): cost in one currency at the rate of the transaction date.
-- (transaction managed by migrator)
-- Before (E3 @af49f72): cost_transactions kept only the amount in the transaction's own currency; cost control, BOQ vs
-- actual, cost snapshots / EAC (and through them the cost-to-cost revenue run), the project report pack and the finance
-- project summaries added those amounts across currencies (F-53).
-- Now (EAS 13 principle: a foreign-currency transaction is measured at the spot rate of its date):
--  * every cost transaction freezes, when it is recorded, the rate of its currency and of its project's currency to the
--    organisation's base currency - the latest rate in the exchange-rate register dated on or before the transaction
--    date (the base currency is 1) - and stores project_amount (project currency) and base_amount (base currency).
--    No rate in the register -> the transaction is refused (no rate is assumed). A reversal uses the rates of the
--    transaction it reverses, so the two net to zero in every currency.
--  * the frozen values never change (cost transactions are already immutable); a later register correction affects only
--    later transactions.
--  * cost control, BOQ vs actual, cost snapshots and the report pack sum project_amount (project currency, the currency
--    of budgets); the finance project summaries do the same.
-- Not in this stage (F-54, DEC-021 part 2): GL lines, receivables, payables, payments and accruals in the base currency,
-- realised exchange differences on settlement and period-end revaluation of monetary items.
-- Rollback: drop the trigger and function fx_rate_to_base, the added columns, and re-run the 058 / 008 / 084 definitions.

ALTER TABLE cost_transactions
  ADD COLUMN IF NOT EXISTS base_currency_id BIGINT REFERENCES currencies(id),
  ADD COLUMN IF NOT EXISTS fx_rate_to_base NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS fx_rate_date DATE,
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS project_currency_id BIGINT REFERENCES currencies(id),
  ADD COLUMN IF NOT EXISTS project_fx_rate_to_base NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS project_amount NUMERIC(18,2);

-- Rate of p_currency to the base currency of p_org for p_date: 1 for the base currency, else the latest register rate on
-- or before p_date. Returns no row when there is none (callers refuse).
CREATE OR REPLACE FUNCTION fx_rate_to_base(p_org bigint, p_currency bigint, p_date date, OUT rate numeric, OUT rate_date date)
LANGUAGE plpgsql STABLE AS $$
DECLARE base bigint;
BEGIN
  SELECT base_currency_id INTO base FROM organizations WHERE id = p_org;
  IF base IS NULL THEN RAISE EXCEPTION 'Organization % has no base currency', p_org; END IF;
  IF p_currency = base THEN rate := 1; rate_date := p_date; RETURN; END IF;
  SELECT e.rate_to_base, e.rate_date INTO rate, rate_date FROM exchange_rates e
   WHERE e.org_id = p_org AND e.currency_id = p_currency AND e.rate_date <= p_date ORDER BY e.rate_date DESC LIMIT 1;
END $$;

CREATE OR REPLACE FUNCTION set_cost_transaction_fx() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o cost_transactions%ROWTYPE; r record; pr record; pcur bigint; cur_code text;
BEGIN
  SELECT currency_id INTO pcur FROM projects WHERE id = NEW.project_id;
  NEW.base_currency_id := (SELECT base_currency_id FROM organizations WHERE id = NEW.org_id);
  IF NEW.base_currency_id IS NULL THEN RAISE EXCEPTION 'Organization % has no base currency', NEW.org_id; END IF;
  NEW.project_currency_id := pcur;
  IF NEW.reversal_of_transaction_id IS NOT NULL THEN
    SELECT * INTO o FROM cost_transactions WHERE id = NEW.reversal_of_transaction_id;
    IF FOUND AND o.fx_rate_to_base IS NOT NULL THEN
      NEW.fx_rate_to_base := o.fx_rate_to_base; NEW.fx_rate_date := o.fx_rate_date; NEW.project_fx_rate_to_base := o.project_fx_rate_to_base;
      NEW.base_amount := round(NEW.amount * NEW.fx_rate_to_base, 2);
      NEW.project_amount := CASE WHEN NEW.currency_id = pcur THEN NEW.amount ELSE round(NEW.amount * NEW.fx_rate_to_base / NEW.project_fx_rate_to_base, 2) END;
      RETURN NEW;
    END IF;
  END IF;
  SELECT * INTO r FROM fx_rate_to_base(NEW.org_id, NEW.currency_id, NEW.transaction_date);
  IF r.rate IS NULL THEN
    SELECT code INTO cur_code FROM currencies WHERE id = NEW.currency_id;
    RAISE EXCEPTION 'No exchange rate for % on or before % - record it in the exchange-rate register first', cur_code, NEW.transaction_date;
  END IF;
  SELECT * INTO pr FROM fx_rate_to_base(NEW.org_id, pcur, NEW.transaction_date);
  IF pr.rate IS NULL THEN
    SELECT code INTO cur_code FROM currencies WHERE id = pcur;
    RAISE EXCEPTION 'No exchange rate for the project currency % on or before % - record it in the exchange-rate register first', cur_code, NEW.transaction_date;
  END IF;
  NEW.fx_rate_to_base := r.rate; NEW.fx_rate_date := r.rate_date; NEW.project_fx_rate_to_base := pr.rate;
  NEW.base_amount := round(NEW.amount * r.rate, 2);
  NEW.project_amount := CASE WHEN NEW.currency_id = pcur THEN NEW.amount ELSE round(NEW.amount * r.rate / pr.rate, 2) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_zfx_cost_transaction_rates ON cost_transactions;
CREATE TRIGGER trg_zfx_cost_transaction_rates BEFORE INSERT ON cost_transactions FOR EACH ROW EXECUTE FUNCTION set_cost_transaction_fx();

-- Existing rows: same rule at their own transaction date; a row that cannot be converted stops the migration (record the
-- rate, then re-run) - nothing is assumed.
ALTER TABLE cost_transactions DISABLE TRIGGER trg_block_update_cost_transactions;
WITH c AS (
  SELECT t.id, o.base_currency_id, p.currency_id AS pcur, r.rate, r.rate_date, pr.rate AS prate,
         round(t.amount * r.rate, 2) AS base_amount,
         CASE WHEN t.currency_id = p.currency_id THEN t.amount ELSE round(t.amount * r.rate / pr.rate, 2) END AS project_amount
    FROM cost_transactions t JOIN projects p ON p.id = t.project_id JOIN organizations o ON o.id = t.org_id
   CROSS JOIN LATERAL fx_rate_to_base(t.org_id, t.currency_id, t.transaction_date) r
   CROSS JOIN LATERAL fx_rate_to_base(t.org_id, p.currency_id, t.transaction_date) pr
   WHERE t.project_amount IS NULL)
UPDATE cost_transactions t SET base_currency_id = c.base_currency_id, project_currency_id = c.pcur, fx_rate_to_base = c.rate,
       fx_rate_date = c.rate_date, project_fx_rate_to_base = c.prate, base_amount = c.base_amount, project_amount = c.project_amount
  FROM c WHERE c.id = t.id;
ALTER TABLE cost_transactions ENABLE TRIGGER trg_block_update_cost_transactions;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cost_transactions WHERE project_amount IS NULL OR base_amount IS NULL) THEN
    RAISE EXCEPTION 'Cost transactions without an exchange rate for their date exist - record the rates and re-run migration 085';
  END IF;
END $$;
ALTER TABLE cost_transactions ALTER COLUMN base_amount SET NOT NULL, ALTER COLUMN project_amount SET NOT NULL,
  ALTER COLUMN fx_rate_to_base SET NOT NULL, ALTER COLUMN project_fx_rate_to_base SET NOT NULL,
  ALTER COLUMN base_currency_id SET NOT NULL, ALTER COLUMN project_currency_id SET NOT NULL;

-- Cost sums in the project currency (definitions otherwise unchanged from 058 / 008 / 084).
CREATE OR REPLACE FUNCTION guard_cost_snapshot() RETURNS trigger AS $$
DECLARE b numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cost snapshots cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.as_of > current_date THEN RAISE EXCEPTION 'Snapshot cannot be dated in the future'; END IF;
    SELECT coalesce((SELECT amount FROM budgets WHERE project_id = NEW.project_id AND cost_code_id = NEW.cost_code_id AND budget_type = 'revised' AND approved_by IS NOT NULL),
                    (SELECT amount FROM budgets WHERE project_id = NEW.project_id AND cost_code_id = NEW.cost_code_id AND budget_type = 'original' AND approved_by IS NOT NULL), 0) INTO b;
    NEW.budget := b;
    SELECT coalesce(sum(project_amount) FILTER (WHERE transaction_type = 'committed'), 0), coalesce(sum(project_amount) FILTER (WHERE transaction_type = 'actual'), 0)
      INTO NEW.committed, NEW.actual FROM cost_transactions WHERE project_id = NEW.project_id AND cost_code_id = NEW.cost_code_id AND transaction_date <= NEW.as_of;
    NEW.accrual := cost_accrual_as_of(NEW.project_id, NEW.cost_code_id, NEW.as_of);
    IF NEW.etc_method = 'budget_remaining' THEN NEW.etc_amount := greatest(NEW.budget - NEW.actual - NEW.accrual, 0); END IF;
    NEW.approved_by := NULL; NEW.approved_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.approved_by IS NOT NULL THEN RAISE EXCEPTION 'Approved snapshot % is immutable', OLD.id; END IF;
  IF (NEW.project_id, NEW.cost_code_id, NEW.as_of, NEW.budget, NEW.committed, NEW.actual, NEW.accrual, NEW.etc_method, NEW.etc_amount, NEW.etc_basis, NEW.prepared_by)
     IS DISTINCT FROM (OLD.project_id, OLD.cost_code_id, OLD.as_of, OLD.budget, OLD.committed, OLD.actual, OLD.accrual, OLD.etc_method, OLD.etc_amount, OLD.etc_basis, OLD.prepared_by) THEN
    RAISE EXCEPTION 'Snapshot inputs are captured from the ledger and cannot be edited';
  END IF;
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.prepared_by THEN RAISE EXCEPTION 'The preparer cannot approve the snapshot'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW v_cost_control_summary AS
WITH pairs AS (
  SELECT project_id, cost_code_id FROM cost_transactions
  UNION SELECT project_id, cost_code_id FROM budgets WHERE approved_by IS NOT NULL
  UNION SELECT project_id, id FROM cost_codes WHERE project_id IS NOT NULL)
SELECT p.project_id, cc.id AS cost_code_id, cc.code, cc.description,
  coalesce((SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'revised' AND b.approved_by IS NOT NULL),
           (SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'original' AND b.approved_by IS NOT NULL), 0) AS budget,
  coalesce((SELECT sum(project_amount) FROM cost_transactions t WHERE t.project_id = p.project_id AND t.cost_code_id = cc.id AND t.transaction_type = 'committed'), 0) AS committed,
  coalesce((SELECT sum(project_amount) FROM cost_transactions t WHERE t.project_id = p.project_id AND t.cost_code_id = cc.id AND t.transaction_type = 'actual'), 0) AS actual,
  (SELECT s.eac FROM cost_forecast_snapshots s WHERE s.project_id = p.project_id AND s.cost_code_id = cc.id AND s.approved_by IS NOT NULL ORDER BY s.as_of DESC, s.id DESC LIMIT 1) AS estimate_at_completion,
  coalesce((SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'revised' AND b.approved_by IS NOT NULL),
           (SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'original' AND b.approved_by IS NOT NULL), 0)
   - coalesce((SELECT s.eac FROM cost_forecast_snapshots s WHERE s.project_id = p.project_id AND s.cost_code_id = cc.id AND s.approved_by IS NOT NULL ORDER BY s.as_of DESC, s.id DESC LIMIT 1), 0) AS variance_at_completion
FROM pairs p JOIN cost_codes cc ON cc.id = p.cost_code_id;
ALTER VIEW v_cost_control_summary SET (security_invoker = true);
CREATE OR REPLACE VIEW v_boq_vs_actual AS
SELECT
    pb.project_id, pb.id AS boq_item_id, pb.item_no, pb.description,
    COALESCE(pb.revised_amount, pb.contract_amount) AS current_contract_amount,
    COALESCE(SUM(ct.project_amount) FILTER (WHERE ct.transaction_type = 'actual'), 0) AS actual_cost,
    COALESCE(SUM(ct.project_amount) FILTER (WHERE ct.transaction_type = 'actual'), 0)
        - COALESCE(pb.revised_amount, pb.contract_amount) AS variance
FROM project_boq pb
LEFT JOIN cost_transactions ct ON ct.boq_item_id = pb.id
GROUP BY pb.project_id, pb.id, pb.item_no, pb.description, pb.contract_amount, pb.revised_amount;
ALTER VIEW v_boq_vs_actual SET (security_invoker = true);

CREATE OR REPLACE FUNCTION project_report_snapshot(p_project bigint, p_start date, p_end date)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH prev AS (
  SELECT period_end, decided_at FROM project_report_packs
   WHERE project_id = p_project AND status = 'approved' AND period_end < p_end
   ORDER BY period_end DESC LIMIT 1),
codes AS (
  SELECT DISTINCT cost_code_id FROM (
    SELECT cost_code_id FROM cost_transactions WHERE project_id = p_project AND transaction_date <= p_end
    UNION SELECT cost_code_id FROM budgets WHERE project_id = p_project AND approved_by IS NOT NULL AND approval_date <= p_end
    UNION SELECT cost_code_id FROM purchase_orders WHERE project_id = p_project AND cost_code_id IS NOT NULL) x),
per_code AS (
  SELECT c.cost_code_id,
    coalesce((SELECT amount FROM budgets b WHERE b.project_id = p_project AND b.cost_code_id = c.cost_code_id AND b.approved_by IS NOT NULL
               AND b.approval_date <= p_end ORDER BY (b.budget_type = 'revised') DESC, b.approval_date DESC, b.id DESC LIMIT 1), 0) AS budget,
    (SELECT count(*) FROM budgets b WHERE b.project_id = p_project AND b.cost_code_id = c.cost_code_id AND b.approved_by IS NOT NULL AND b.approval_date <= p_end) AS budget_rows,
    coalesce((SELECT sum(project_amount) FROM cost_transactions t WHERE t.project_id = p_project AND t.cost_code_id = c.cost_code_id AND t.transaction_type = 'committed' AND t.transaction_date <= p_end), 0) AS committed,
    coalesce((SELECT sum(project_amount) FROM cost_transactions t WHERE t.project_id = p_project AND t.cost_code_id = c.cost_code_id AND t.transaction_type = 'actual' AND t.transaction_date <= p_end), 0) AS actual,
    cost_accrual_as_of(p_project, c.cost_code_id, p_end) AS accrual
  FROM codes c),
cost AS (
  SELECT coalesce(sum(budget), 0)::numeric(18,2) AS budget, coalesce(sum(committed), 0)::numeric(18,2) AS committed,
         coalesce(sum(actual), 0)::numeric(18,2) AS actual, coalesce(sum(accrual), 0)::numeric(18,2) AS accrual FROM per_code),
unposted AS (
  SELECT count(*)::int AS n, coalesce(sum(project_amount), 0)::numeric(18,2) AS amount FROM cost_transactions
   WHERE project_id = p_project AND transaction_type = 'actual' AND transaction_date <= p_end AND NOT is_posted_to_gl),
backdated AS (
  SELECT count(*)::int AS n, coalesce(sum(t.project_amount), 0)::numeric(18,2) AS amount FROM cost_transactions t, prev
   WHERE t.project_id = p_project AND t.transaction_date <= prev.period_end AND t.created_at > prev.decided_at),
notices AS (
  SELECT count(*)::int AS n FROM contract_notices cn JOIN contracts c ON c.id = cn.contract_id
   WHERE c.project_id = p_project AND cn.status = 'open' AND cn.deadline < p_end),
diaries AS (
  SELECT count(*)::int AS n FROM site_diary WHERE project_id = p_project AND diary_date BETWEEN p_start AND p_end AND status <> 'signed'),
exceptions AS (
  SELECT jsonb_agg(e ORDER BY e->>'type') AS list FROM (
    SELECT jsonb_build_object('type', 'actual_not_posted_to_gl', 'count', n, 'amount', amount) e FROM unposted WHERE n > 0
    UNION ALL SELECT jsonb_build_object('type', 'commitment_above_budget', 'cost_code_id', cost_code_id, 'budget', budget::numeric(18,2), 'committed', committed::numeric(18,2))
      FROM per_code WHERE budget_rows > 0 AND committed > budget
    UNION ALL SELECT jsonb_build_object('type', 'actual_without_approved_budget', 'cost_code_id', cost_code_id, 'actual', actual::numeric(18,2))
      FROM per_code WHERE budget_rows = 0 AND actual > 0
    UNION ALL SELECT jsonb_build_object('type', 'backdated_into_approved_period', 'count', n, 'amount', amount) FROM backdated WHERE n > 0
    UNION ALL SELECT jsonb_build_object('type', 'notices_past_deadline_open', 'count', n) FROM notices WHERE n > 0
    UNION ALL SELECT jsonb_build_object('type', 'unsigned_site_diaries_in_period', 'count', n) FROM diaries WHERE n > 0) z)
SELECT jsonb_build_object(
  'project_id', p_project, 'period_start', p_start, 'period_end', p_end, 'data_as_of', p_end,
  'cost', jsonb_build_object('basis', 'as_of', 'budget', cost.budget, 'committed', cost.committed, 'actual', cost.actual, 'accrual', cost.accrual,
           'actual_plus_accrual', (cost.actual + cost.accrual)::numeric(18,2)),
  'quality', jsonb_build_object('basis', 'as_of',
           'ncrs_open', (SELECT count(*) FROM ncrs WHERE project_id = p_project AND raised_date <= p_end AND (closed_date IS NULL OR closed_date > p_end)),
           'ncrs_raised_in_period', (SELECT count(*) FROM ncrs WHERE project_id = p_project AND raised_date BETWEEN p_start AND p_end)),
  'hse', jsonb_build_object('basis', 'as_of',
           'incidents_in_period', (SELECT count(*) FROM incidents WHERE project_id = p_project AND incident_date BETWEEN p_start AND p_end),
           'major_or_fatal_in_period', (SELECT count(*) FROM incidents WHERE project_id = p_project AND incident_date BETWEEN p_start AND p_end AND severity IN ('major','fatality'))),
  'time', jsonb_build_object('basis', 'at_capture', 'contracts', coalesce((
           SELECT jsonb_agg(jsonb_build_object('contract_id', tp.contract_id, 'original_completion', tp.original_completion, 'revised_completion', tp.revised_completion,
                  'approved_extension_days', tp.approved_extension_days, 'forecast_completion', tp.forecast_completion, 'forecast_source', tp.forecast_source,
                  'days_late', tp.days_late, 'ld_exposure', tp.ld_exposure) ORDER BY tp.contract_id)
             FROM contracts c CROSS JOIN LATERAL contract_time_position(c.id, NULL) tp
            WHERE c.project_id = p_project AND c.contract_status IN ('signed','active')), '[]'::jsonb)),
  'risks', jsonb_build_object('basis', 'at_capture',
           'open', (SELECT count(*) FROM risks WHERE project_id = p_project AND status <> 'closed'),
           'escalated', (SELECT count(*) FROM risks WHERE project_id = p_project AND status = 'escalated'),
           'open_threat_expected_value', (SELECT coalesce(sum(expected_value), 0)::numeric(18,2) FROM risks WHERE project_id = p_project AND status <> 'closed' AND kind = 'threat')),
  'exceptions', coalesce(exceptions.list, '[]'::jsonb),
  'exceptions_basis', 'cost exceptions as_of; notices and diaries at_capture')
FROM cost, exceptions;
$$;
