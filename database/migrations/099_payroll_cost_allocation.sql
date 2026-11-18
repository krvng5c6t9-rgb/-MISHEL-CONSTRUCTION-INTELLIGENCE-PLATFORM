-- Stage 65 / CC-094 / F-68 (A-006): payroll cost to projects by approved timesheet hours, as a company setting.
-- (transaction managed by migrator)
-- Before (E3 @CC-093): a payroll line's gross pay (DEC-013) reached a project only through the one project / cost code
-- chosen on the line; an employee working on several projects in the month could not be split.
-- Now each company chooses its basis (payroll_settings.cost_basis):
--  * 'line_project' - as before: the project and cost code on the payroll line (also the behaviour when the company
--    has not chosen, so existing data and flows are unchanged);
--  * 'timesheet_hours' - the line's gross pay is split over the (project, cost code) pairs of the employee's APPROVED
--    timesheets dated in the payroll month, in proportion to hours; each share rounded to 2 decimals and the rounding
--    remainder given to the largest share (ties: lowest project, then cost code) so the shares add up exactly to the
--    gross pay; one actual cost transaction per share; the split is kept in payroll_line_allocations (permanent).
--    Refused when the month has no approved hours or an approved timesheet has no cost code (nothing assumed).
-- Rollback: drop allocate_payroll_line, payroll_line_allocations, payroll_settings and payroll_lines.allocated_at.

CREATE TABLE IF NOT EXISTS payroll_settings (
  org_id BIGINT PRIMARY KEY REFERENCES organizations(id),
  cost_basis VARCHAR(20) NOT NULL CHECK (cost_basis IN ('line_project', 'timesheet_hours')),
  updated_by BIGINT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON payroll_settings;
DROP POLICY IF EXISTS tenant_isolation_write ON payroll_settings;
CREATE POLICY tenant_isolation_select ON payroll_settings FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON payroll_settings FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_payroll_settings ON payroll_settings;
CREATE TRIGGER trg_audit_payroll_settings AFTER INSERT OR UPDATE OR DELETE ON payroll_settings FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS allocated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payroll_line_allocations (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  payroll_line_id BIGINT NOT NULL REFERENCES payroll_lines(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  cost_code_id BIGINT NOT NULL REFERENCES cost_codes(id),
  hours NUMERIC(10,2) NOT NULL CHECK (hours > 0),
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  cost_transaction_id BIGINT REFERENCES cost_transactions(id),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payroll_line_id, project_id, cost_code_id)
);
ALTER TABLE payroll_line_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_line_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON payroll_line_allocations;
DROP POLICY IF EXISTS tenant_isolation_write ON payroll_line_allocations;
CREATE POLICY tenant_isolation_select ON payroll_line_allocations FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON payroll_line_allocations FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_payroll_line_allocations ON payroll_line_allocations;
CREATE TRIGGER trg_audit_payroll_line_allocations AFTER INSERT OR UPDATE OR DELETE ON payroll_line_allocations FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();
-- An allocation is written, then linked once to the cost transaction posted from it; after that it never changes.
CREATE OR REPLACE FUNCTION guard_payroll_line_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.cost_transaction_id IS NULL AND NEW.cost_transaction_id IS NOT NULL
     AND (NEW.org_id, NEW.payroll_line_id, NEW.project_id, NEW.cost_code_id, NEW.hours, NEW.amount, NEW.created_by, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.org_id, OLD.payroll_line_id, OLD.project_id, OLD.cost_code_id, OLD.hours, OLD.amount, OLD.created_by, OLD.created_at)
     AND EXISTS (SELECT 1 FROM cost_transactions c WHERE c.id = NEW.cost_transaction_id AND c.source_table = 'payroll_line_allocations' AND c.source_record_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Payroll cost allocations are permanent';
END $$;
DROP TRIGGER IF EXISTS trg_guard_payroll_line_allocation ON payroll_line_allocations;
CREATE TRIGGER trg_guard_payroll_line_allocation BEFORE UPDATE OR DELETE ON payroll_line_allocations FOR EACH ROW EXECUTE FUNCTION guard_payroll_line_allocation();

-- Splits one approved payroll line by approved timesheet hours of its month; returns the number of shares posted.
CREATE OR REPLACE FUNCTION allocate_payroll_line(p_line bigint, p_user bigint) RETURNS int LANGUAGE plpgsql AS $$
DECLARE l record; gross numeric; total numeric; missing int; n int := 0; s record; ct_id bigint; a_id bigint; period_end date;
BEGIN
  SELECT pl.*, pr.status AS run_status, pr.period_month, pr.org_id AS run_org INTO l
    FROM payroll_lines pl JOIN payroll_runs pr ON pr.id = pl.payroll_run_id WHERE pl.id = p_line FOR UPDATE OF pl;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Payroll line not found'; END IF;
  IF l.run_status <> 'approved' THEN RAISE EXCEPTION 'Only approved payroll runs can be posted'; END IF;
  IF l.posted_cost_transaction_id IS NOT NULL OR l.allocated_at IS NOT NULL OR l.posted_gl_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll line already posted';
  END IF;
  gross := l.basic + l.overtime + l.allowances;
  IF gross <= 0 THEN RAISE EXCEPTION 'The payroll line has no gross pay to allocate'; END IF;
  period_end := (l.period_month + interval '1 month' - interval '1 day')::date;
  SELECT count(*) INTO missing FROM timesheets t WHERE t.employee_id = l.employee_id AND t.status = 'approved'
     AND t.work_date BETWEEN l.period_month AND period_end AND t.cost_code_id IS NULL;
  IF missing > 0 THEN RAISE EXCEPTION 'Approved timesheets of the period have no cost code'; END IF;
  SELECT coalesce(sum(hours), 0) INTO total FROM timesheets t WHERE t.employee_id = l.employee_id AND t.status = 'approved'
     AND t.work_date BETWEEN l.period_month AND period_end;
  IF total <= 0 THEN RAISE EXCEPTION 'No approved timesheet hours in the payroll period'; END IF;
  FOR s IN
    WITH h AS (SELECT t.project_id, t.cost_code_id, sum(t.hours) AS hours FROM timesheets t
                WHERE t.employee_id = l.employee_id AND t.status = 'approved' AND t.work_date BETWEEN l.period_month AND period_end
                GROUP BY 1, 2),
         r AS (SELECT h.*, round(gross * h.hours / total, 2) AS share,
                      row_number() OVER (ORDER BY h.hours DESC, h.project_id, h.cost_code_id) AS rk FROM h)
    SELECT r.project_id, r.cost_code_id, r.hours,
           r.share + CASE WHEN r.rk = 1 THEN gross - (SELECT sum(share) FROM r) ELSE 0 END AS amount
      FROM r ORDER BY r.rk
  LOOP
    INSERT INTO payroll_line_allocations (org_id, payroll_line_id, project_id, cost_code_id, hours, amount, created_by)
    VALUES (l.run_org, l.id, s.project_id, s.cost_code_id, s.hours, s.amount, p_user) RETURNING id INTO a_id;
    INSERT INTO cost_transactions (project_id, cost_code_id, source_module, source_table, source_record_id, transaction_type, amount, currency_id, transaction_date, description)
    VALUES (s.project_id, s.cost_code_id, 'hr_payroll', 'payroll_line_allocations', a_id, 'actual', s.amount, l.currency_id, current_date,
            'Actual payroll cost (gross pay) of payroll line ' || l.id || ' allocated by approved timesheet hours (' || s.hours || ' of ' || total || ')')
    RETURNING id INTO ct_id;
    UPDATE payroll_line_allocations SET cost_transaction_id = ct_id WHERE id = a_id;
    n := n + 1;
  END LOOP;
  UPDATE payroll_lines SET allocated_at = now() WHERE id = l.id;
  RETURN n;
END $$;

-- Cost transaction guard of migration 077, extended with the allocation source (CC-094).
CREATE OR REPLACE FUNCTION public.validate_cost_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    pa record;
    r    cost_adjustment_requests%ROWTYPE;
    c    subcontract_certificates%ROWTYPE;
    s    subcontracts%ROWTYPE;
    pl   payroll_lines%ROWTYPE;
    pr   payroll_runs%ROWTYPE;
    eu   equipment_usage%ROWTYPE;
BEGIN

    IF NEW.source_module = 'manual_adjustment' THEN
        IF NEW.source_table <> 'cost_adjustment_requests' THEN
            RAISE EXCEPTION 'manual_adjustment rows must have source_table = ''cost_adjustment_requests''.';
        END IF;
        SELECT * INTO r FROM cost_adjustment_requests WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'No cost_adjustment_requests row with id %', NEW.source_record_id; END IF;
        IF r.status <> 'approved' THEN
            RAISE EXCEPTION 'cost_adjustment_requests % has status "%" — only approved may post.', r.id, r.status;
        END IF;
        IF r.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'cost_adjustment_requests % already posted transaction %.', r.id, r.posted_cost_transaction_id;
        END IF;
        IF NEW.project_id <> r.project_id OR NEW.cost_code_id <> r.cost_code_id
           OR NEW.boq_item_id IS DISTINCT FROM r.boq_item_id OR NEW.currency_id <> r.currency_id
           OR NEW.transaction_type <> r.transaction_type OR NEW.amount <> r.requested_amount THEN
            RAISE EXCEPTION 'Posted adjustment does not match approved request %.', r.id;
        END IF;
        IF r.adjustment_type = 'reversal' THEN
            IF NEW.reversal_of_transaction_id IS DISTINCT FROM r.original_cost_transaction_id THEN
                RAISE EXCEPTION 'A reversal posting must set reversal_of_transaction_id = %.', r.original_cost_transaction_id;
            END IF;
        ELSE
            IF NEW.reversal_of_transaction_id IS NOT NULL THEN
                RAISE EXCEPTION 'A replacement posting must NOT set reversal_of_transaction_id.';
            END IF;
        END IF;
        RETURN NEW;

    ELSIF NEW.source_module = 'subcontract' THEN
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        IF NEW.source_table <> 'subcontract_certificates' THEN
            RAISE EXCEPTION 'subcontract rows must have source_table = ''subcontract_certificates''.';
        END IF;
        SELECT * INTO c FROM subcontract_certificates WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No subcontract_certificates row with id %', NEW.source_record_id; END IF;
        IF c.status <> 'approved' THEN
            RAISE EXCEPTION 'subcontract_certificates % status "%" not postable.', c.id, c.status;
        END IF;
        IF c.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'subcontract_certificates % already posted.', c.id;
        END IF;
        -- DEC-012: subcontract cost = the certificate's gross (period value of the cumulative valuation).
        IF NEW.amount <> c.gross_work_done THEN
            RAISE EXCEPTION 'Posted amount (%) must equal the certificate gross (%) for certificate %.', NEW.amount, c.gross_work_done, c.id;
        END IF;
        IF NEW.project_id <> c.project_id THEN
            RAISE EXCEPTION 'project_id mismatch for certificate %.', c.id;
        END IF;
        SELECT * INTO s FROM subcontracts WHERE id = c.subcontract_id;
        IF NEW.currency_id <> s.currency_id THEN
            RAISE EXCEPTION 'currency_id mismatch for certificate %.', c.id;
        END IF;
        -- ★ الإصلاح الجديد: تحقق cost_code_id لو subcontracts فيه واحد محدد
        IF s.cost_code_id IS NOT NULL AND NEW.cost_code_id IS DISTINCT FROM s.cost_code_id THEN
            RAISE EXCEPTION 'cost_code_id (%) must match subcontracts.cost_code_id (%) for certificate %.',
                NEW.cost_code_id, s.cost_code_id, c.id;
        END IF;
        IF NEW.transaction_type <> 'actual' THEN
            RAISE EXCEPTION 'subcontract postings must be transaction_type = ''actual''.';
        END IF;
        RETURN NEW;

    ELSIF NEW.source_module = 'hr_payroll' THEN
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        -- CC-094 (F-68): a share of a payroll line allocated by approved timesheet hours (migration 099) is posted with
        -- its allocation as the source and must equal it exactly.
        IF NEW.source_table = 'payroll_line_allocations' THEN
            SELECT * INTO pa FROM payroll_line_allocations WHERE id = NEW.source_record_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'No payroll_line_allocations row with id %', NEW.source_record_id; END IF;
            IF pa.cost_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'payroll_line_allocations % already posted.', pa.id; END IF;
            SELECT * INTO pl FROM payroll_lines WHERE id = pa.payroll_line_id;
            IF NEW.amount <> pa.amount OR NEW.project_id <> pa.project_id OR NEW.cost_code_id IS DISTINCT FROM pa.cost_code_id OR NEW.currency_id <> pl.currency_id THEN
                RAISE EXCEPTION 'The posting must equal payroll allocation % (amount, project, cost code, currency).', pa.id;
            END IF;
            IF NEW.transaction_type <> 'actual' THEN RAISE EXCEPTION 'payroll postings must be transaction_type = ''actual''.'; END IF;
            RETURN NEW;
        END IF;
        IF NEW.source_table <> 'payroll_lines' THEN
            RAISE EXCEPTION 'hr_payroll rows must have source_table = ''payroll_lines'' or ''payroll_line_allocations''.';
        END IF;
        SELECT * INTO pl FROM payroll_lines WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No payroll_lines row with id %', NEW.source_record_id; END IF;
        IF pl.project_id IS NULL THEN
            RAISE EXCEPTION 'payroll_lines % has no project_id — overhead payroll posts to GL directly, not to cost_transactions.', pl.id;
        END IF;
        SELECT * INTO pr FROM payroll_runs WHERE id = pl.payroll_run_id;
        IF pr.status <> 'approved' THEN
            RAISE EXCEPTION 'payroll_runs % status "%" not postable.', pr.id, pr.status;
        END IF;
        IF pl.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'payroll_lines % already posted.', pl.id;
        END IF;
        -- DEC-013 (owner decision 2026-10-09): project labour cost = gross pay; deductions are a liability, not a cost reduction.
        IF NEW.amount <> pl.basic + pl.overtime + pl.allowances THEN
            RAISE EXCEPTION 'Posted amount (%) must equal the gross pay (%) for line %.', NEW.amount, pl.basic + pl.overtime + pl.allowances, pl.id;
        END IF;
        IF NEW.project_id <> pl.project_id THEN
            RAISE EXCEPTION 'project_id mismatch for payroll_lines %.', pl.id;
        END IF;
        IF NEW.currency_id <> pl.currency_id THEN
            RAISE EXCEPTION 'currency_id mismatch for payroll_lines %.', pl.id;
        END IF;
        -- ★ الإصلاح الجديد
        IF NEW.cost_code_id IS DISTINCT FROM pl.cost_code_id THEN
            RAISE EXCEPTION 'cost_code_id mismatch for payroll_lines %.', pl.id;
        END IF;
        IF NEW.transaction_type <> 'actual' THEN
            RAISE EXCEPTION 'payroll postings must be transaction_type = ''actual''.';
        END IF;
        RETURN NEW;

    ELSIF NEW.source_module = 'equipment' THEN
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        IF NEW.source_table <> 'equipment_usage' THEN
            RAISE EXCEPTION 'equipment rows must have source_table = ''equipment_usage''.';
        END IF;
        SELECT * INTO eu FROM equipment_usage WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No equipment_usage row with id %', NEW.source_record_id; END IF;
        IF eu.status <> 'approved' THEN
            RAISE EXCEPTION 'equipment_usage % status "%" not postable.', eu.id, eu.status;
        END IF;
        IF eu.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'equipment_usage % already posted.', eu.id;
        END IF;
        IF NEW.amount <> eu.cost_amount THEN
            RAISE EXCEPTION 'Posted amount (%) must equal cost_amount (%) for row %.', NEW.amount, eu.cost_amount, eu.id;
        END IF;
        IF NEW.project_id <> eu.project_id THEN
            RAISE EXCEPTION 'project_id mismatch for equipment_usage %.', eu.id;
        END IF;
        IF NEW.currency_id <> eu.currency_id THEN
            RAISE EXCEPTION 'currency_id mismatch for equipment_usage %.', eu.id;
        END IF;
        IF NEW.cost_code_id IS DISTINCT FROM eu.cost_code_id THEN
            RAISE EXCEPTION 'cost_code_id mismatch for equipment_usage %.', eu.id;
        END IF;
        IF NEW.transaction_type <> 'actual' THEN
            RAISE EXCEPTION 'equipment postings must be transaction_type = ''actual''.';
        END IF;
        RETURN NEW;

    ELSE
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        RETURN NEW;
    END IF;

END;
$function$;
