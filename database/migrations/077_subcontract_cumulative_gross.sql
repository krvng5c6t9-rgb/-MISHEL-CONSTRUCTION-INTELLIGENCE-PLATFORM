-- Stage 28 / DEC-012 (owner decision 2026-10-09; analysis governance/decisions/DEC-009_DEC-012_PROFESSIONAL_ANALYSIS.md):
-- subcontract certificates under cumulative valuation, cost at gross, a payable to the subcontractor, retention as a
-- liability. (transaction managed by migrator)
-- Before (E3 approval.service.ts @1f4a023, F-42): approving a certificate posted the NET amount as project cost (the DB
-- rule from migration 009 required it) and created no payable, so the subcontractor could not be paid through the
-- system and retention, advance recovery and back-charges disappeared from cost and from the ledger.
-- Now:
--  * cumulative valuation: each certificate's gross is the period value = cumulative gross to date - cumulative gross of
--    the earlier certificates; where measured lines exist, sum(cumulative quantity x rate) - previous cumulative must
--    equal the period gross; the certificate stores both cumulative figures; "less previous" is implicit and must be 0;
--  * cost = gross (validate_cost_transaction_insert updated); the payable = net amount due; retention withheld is
--    recorded as a liability per certificate (subcontract_retentions) and released by a reasoned decision into its own
--    payable; GL posting splits the credit: payable (net), retention payable, advance recovered (asset), back-charges
--    recovered (cost recovery) - each by its own GL rule.
-- Supplier tax (input tax, withholding) and the GL of subcontract advance payments land in Stage 29 (F-33).
-- Rollback: drop subcontract_retentions and the two certificate columns; restore the 070 integrity guard and the
-- 076 cost validation; restore the AP source_type check.

ALTER TABLE subcontract_certificates ADD COLUMN IF NOT EXISTS previous_cumulative_gross NUMERIC(18,2);
ALTER TABLE subcontract_certificates ADD COLUMN IF NOT EXISTS cumulative_gross_to_date NUMERIC(18,2);

-- Latent defect found by this stage (22001 at runtime): source_type was VARCHAR(20) while its own CHECK (migration 006)
-- allowed 'subcontract_certificate' (23 characters) - a subcontract payable could never have been stored.
ALTER TABLE accounts_payable ALTER COLUMN source_type TYPE VARCHAR(30);
ALTER TABLE accounts_payable DROP CONSTRAINT IF EXISTS accounts_payable_source_type_check;
ALTER TABLE accounts_payable ADD CONSTRAINT accounts_payable_source_type_check
  CHECK (source_type IN ('vendor_invoice','subcontract_certificate','subcontract_retention','subcontract_advance'));

CREATE TABLE IF NOT EXISTS subcontract_retentions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  subcontract_id BIGINT NOT NULL REFERENCES subcontracts(id),
  certificate_id BIGINT NOT NULL UNIQUE REFERENCES subcontract_certificates(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  status VARCHAR(10) NOT NULL DEFAULT 'held' CHECK (status IN ('held','released')),
  release_reason TEXT,
  release_reference TEXT,
  released_by BIGINT REFERENCES users(id),
  released_at TIMESTAMPTZ,
  release_payable_id BIGINT REFERENCES accounts_payable(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'held' OR (released_by IS NOT NULL AND released_at IS NOT NULL AND release_payable_id IS NOT NULL
         AND length(trim(coalesce(release_reason,''))) >= 10 AND length(trim(coalesce(release_reference,''))) >= 3))
);
CREATE OR REPLACE FUNCTION guard_subcontract_retention() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Subcontract retention records are never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT id, org_id, subcontract_id, less_retention, status INTO c FROM subcontract_certificates WHERE id = NEW.certificate_id;
    IF c.id IS NULL OR c.org_id <> NEW.org_id OR c.subcontract_id <> NEW.subcontract_id THEN RAISE EXCEPTION 'Certificate not found for this subcontract'; END IF;
    IF NEW.amount <> c.less_retention THEN RAISE EXCEPTION 'Retention held % must equal the retention on the certificate %', NEW.amount, c.less_retention; END IF;
    IF NEW.status <> 'held' THEN RAISE EXCEPTION 'Retention starts held'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'released' THEN RAISE EXCEPTION 'Retention % is released and immutable', OLD.id; END IF;
  IF (NEW.org_id, NEW.subcontract_id, NEW.certificate_id, NEW.amount, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.subcontract_id, OLD.certificate_id, OLD.amount, OLD.created_at) THEN
    RAISE EXCEPTION 'Retention record identity and amount are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_retention ON subcontract_retentions;
CREATE TRIGGER trg_subcontract_retention BEFORE INSERT OR UPDATE OR DELETE ON subcontract_retentions FOR EACH ROW EXECUTE FUNCTION guard_subcontract_retention();
ALTER TABLE subcontract_retentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontract_retentions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON subcontract_retentions;
DROP POLICY IF EXISTS tenant_isolation_write ON subcontract_retentions;
CREATE POLICY tenant_isolation_select ON subcontract_retentions FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON subcontract_retentions FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);

CREATE OR REPLACE FUNCTION public.guard_subcontract_certificate_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE s subcontracts%ROWTYPE; line_total numeric; line_count int;
        paid_adv numeric; recovered numeric; outstanding numeric; rate_part numeric; rated int; expected numeric;
        bc_total numeric; prev_net numeric; prev_cum numeric; cum_lines numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft subcontract certificates can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO s FROM subcontracts WHERE id = NEW.subcontract_id;
  IF TG_OP = 'INSERT' THEN
    IF s.status <> 'active' THEN RAISE EXCEPTION 'Certificates can only be raised against an active (approved) subcontract; subcontract % is %', s.id, s.status; END IF;
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Certificates start as draft'; END IF;
    RETURN NEW;
  END IF;
  -- Valuation fields are frozen once the certificate leaves draft.
  IF OLD.status <> 'draft' AND (NEW.gross_work_done, NEW.less_retention, NEW.less_advance_recovery, NEW.less_previous_paid, NEW.penalties_deductions, NEW.subcontract_id, NEW.project_id, NEW.period_from, NEW.period_to)
       IS DISTINCT FROM (OLD.gross_work_done, OLD.less_retention, OLD.less_advance_recovery, OLD.less_previous_paid, OLD.penalties_deductions, OLD.subcontract_id, OLD.project_id, OLD.period_from, OLD.period_to) THEN
    RAISE EXCEPTION 'Subcontract certificate valuation is frozen after draft';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'site_verified' THEN
    -- Serialise deduction checks per subcontract (two certificates must not recover the same advance).
    PERFORM 1 FROM subcontracts WHERE id = NEW.subcontract_id FOR UPDATE;
    SELECT coalesce(sum(amount), 0), count(*) INTO line_total, line_count FROM subcontract_certificate_lines WHERE certificate_id = NEW.id;
    IF line_count > 0 AND line_total <> NEW.gross_work_done THEN
      RAISE EXCEPTION 'Certificate gross % does not equal the sum of its lines %', NEW.gross_work_done, line_total;
    END IF;
    IF s.retention_percent IS NOT NULL AND NEW.less_retention > round(NEW.gross_work_done * s.retention_percent / 100, 2) THEN
      RAISE EXCEPTION 'Retention % exceeds % percent of gross %', NEW.less_retention, s.retention_percent, NEW.gross_work_done;
    END IF;
    -- Advance recovery: only of paid advances, never above the outstanding balance, at the recorded rate when one exists.
    SELECT coalesce(sum(amount), 0), coalesce(sum(round(NEW.gross_work_done * recovery_percent / 100, 2)), 0), count(recovery_percent)
      INTO paid_adv, rate_part, rated FROM subcontract_advances WHERE subcontract_id = NEW.subcontract_id AND status = 'paid';
    SELECT coalesce(sum(less_advance_recovery), 0) INTO recovered FROM subcontract_certificates
      WHERE subcontract_id = NEW.subcontract_id AND id <> NEW.id AND status <> 'draft';
    outstanding := paid_adv - recovered;
    IF NEW.less_advance_recovery > outstanding THEN
      RAISE EXCEPTION 'Advance recovery % exceeds the outstanding paid advance % (paid %, already recovered %)', NEW.less_advance_recovery, outstanding, paid_adv, recovered;
    END IF;
    IF rated > 0 THEN
      expected := least(rate_part, outstanding);
      IF NEW.less_advance_recovery <> expected THEN
        RAISE EXCEPTION 'Advance recovery % differs from the recovery due % (recorded rate on gross %, capped at outstanding %)', NEW.less_advance_recovery, expected, NEW.gross_work_done, outstanding;
      END IF;
    END IF;
    -- Back-charges: the deduction is exactly the approved back-charges applied to this certificate.
    SELECT coalesce(sum(amount), 0) INTO bc_total FROM subcontract_backcharges WHERE certificate_id = NEW.id AND status = 'applied';
    IF NEW.penalties_deductions <> bc_total THEN
      RAISE EXCEPTION 'Deductions % must equal the back-charges applied to this certificate %', NEW.penalties_deductions, bc_total;
    END IF;
    -- Defect (043): the generated net_amount_due of the new row is not yet computed in a BEFORE trigger (NULL), so the
    -- "never negative" check never fired. The net is computed here from its parts.
    IF NEW.gross_work_done - NEW.less_retention - NEW.less_advance_recovery - NEW.less_previous_paid - NEW.penalties_deductions < 0 THEN
      RAISE EXCEPTION 'Net amount due % cannot be negative; use a separate credit process', NEW.gross_work_done - NEW.less_retention - NEW.less_advance_recovery - NEW.less_previous_paid - NEW.penalties_deductions;
    END IF;
    IF NEW.period_to < NEW.period_from THEN RAISE EXCEPTION 'Certificate period end precedes start'; END IF;
    -- DEC-012: cumulative valuation. "Less previous" is implicit (the period gross is already the difference of the
    -- cumulative values) and must be 0; the period gross must equal the cumulative measure less the earlier cumulative.
    IF NEW.less_previous_paid <> 0 THEN
      RAISE EXCEPTION 'Less previous must be 0 under cumulative valuation (the period gross is cumulative to date less previous cumulative); got %', NEW.less_previous_paid;
    END IF;
    SELECT coalesce(sum(gross_work_done), 0) INTO prev_cum FROM subcontract_certificates
      WHERE subcontract_id = NEW.subcontract_id AND id <> NEW.id AND status NOT IN ('draft','rejected');
    IF line_count > 0 THEN
      SELECT coalesce(sum(cumulative_quantity * unit_rate), 0) INTO cum_lines FROM subcontract_certificate_lines WHERE certificate_id = NEW.id;
      IF cum_lines - prev_cum <> NEW.gross_work_done THEN
        RAISE EXCEPTION 'Cumulative measure % less previous cumulative % = % does not equal the period gross %', cum_lines, prev_cum, cum_lines - prev_cum, NEW.gross_work_done;
      END IF;
    END IF;
    NEW.previous_cumulative_gross := prev_cum;
    NEW.cumulative_gross_to_date := prev_cum + NEW.gross_work_done;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.validate_cost_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
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
        IF NEW.source_table <> 'payroll_lines' THEN
            RAISE EXCEPTION 'hr_payroll rows must have source_table = ''payroll_lines''.';
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
