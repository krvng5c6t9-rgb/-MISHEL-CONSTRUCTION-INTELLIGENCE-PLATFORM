-- Stage 27 / DEC-013 (owner decision 2026-10-09): payroll cost at gross pay. (transaction managed by migrator)
-- Before (E1 sweep_hr_payroll: 'posted payroll cost recorded (basis: net pay)' = 10,000 for gross 11,500): the cost
-- transaction for a project payroll line had to equal net pay (validate_cost_transaction_insert, migration 009), so
-- employee deductions reduced the project's labour cost. Now it must equal the gross pay (basic + overtime +
-- allowances); the GL posting credits net pay payable and deductions payable separately (glPosting/phase5Posting
-- services), and the payroll run is approved on its gross total. Only the payroll branch of the function changes;
-- the rest is the live definition, re-created unchanged.
-- Rollback: re-apply the migration 009 definition of validate_cost_transaction_insert.

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
        IF NEW.amount <> c.net_amount_due THEN
            RAISE EXCEPTION 'Posted amount (%) must equal net_amount_due (%) for certificate %.', NEW.amount, c.net_amount_due, c.id;
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
