-- Stage 47 / CC-077 / DEC-021 part 2a (owner decision): the general ledger in the base currency at the rate of the
-- transaction date.
-- (transaction managed by migrator)
-- Before (E3 @a075810): general_ledger kept debit / credit only in the line's own currency; a batch is one currency
-- (check_gl_batch_integrity), but any total across batches - a trial balance, an account balance - added currencies.
-- Now (EAS 13 principle, as DEC-021 part 1 for cost):
--  * every GL line freezes, when it is written, the rate of its currency to the organisation's base currency and stores
--    debit_base / credit_base. Rate: the rate of the cost transaction it posts (so the ledger and the cost record agree),
--    otherwise the latest exchange-register rate dated on or before the line's transaction date; the base currency is 1;
--    no rate -> the posting is refused (nothing is assumed). All lines of one batch use the batch's first rate.
--  * no rounding account is needed: within a batch each line's base amount is the converted running total minus the
--    base already given to the earlier lines of that side, so the base debits and credits of a balanced batch are each
--    round(total x rate) and therefore equal; every line stays within 0.01 of its own exact conversion. The deferred
--    batch check now also requires base debits = base credits.
--  * frozen values never change (GL lines are already immutable).
-- Not in this stage (F-54 part 2b): realised exchange differences when a foreign-currency receivable / payable is
-- settled at another rate, period-end revaluation of foreign-currency monetary items - both need the company's
-- exchange-gain / loss accounts in its posting rules - and the maximum age of a register rate (owner).
-- Rollback: drop trigger trg_zfx_gl_rates and function set_gl_fx, restore check_gl_batch_balance from its earlier
-- definition, drop the four columns.

ALTER TABLE general_ledger
  ADD COLUMN IF NOT EXISTS fx_rate_to_base NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS fx_rate_date DATE,
  ADD COLUMN IF NOT EXISTS debit_base NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS credit_base NUMERIC(18,2);

CREATE OR REPLACE FUNCTION set_gl_fx() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev record; r record; cur_code text; d_prev numeric; db_prev numeric; c_prev numeric; cb_prev numeric;
BEGIN
  SELECT fx_rate_to_base, fx_rate_date INTO prev FROM general_ledger
   WHERE journal_batch_id = NEW.journal_batch_id AND fx_rate_to_base IS NOT NULL ORDER BY id LIMIT 1;
  IF prev.fx_rate_to_base IS NOT NULL THEN
    NEW.fx_rate_to_base := prev.fx_rate_to_base; NEW.fx_rate_date := prev.fx_rate_date;
  ELSIF NEW.source_module = 'cost_transaction' THEN
    SELECT fx_rate_to_base, fx_rate_date INTO NEW.fx_rate_to_base, NEW.fx_rate_date FROM cost_transactions WHERE id = NEW.source_record_id;
  END IF;
  IF NEW.fx_rate_to_base IS NULL THEN
    SELECT * INTO r FROM fx_rate_to_base(NEW.org_id, NEW.currency_id, NEW.transaction_date);
    IF r.rate IS NULL THEN
      SELECT code INTO cur_code FROM currencies WHERE id = NEW.currency_id;
      RAISE EXCEPTION 'No exchange rate for % on or before % - record it in the exchange-rate register first', cur_code, NEW.transaction_date;
    END IF;
    NEW.fx_rate_to_base := r.rate; NEW.fx_rate_date := r.rate_date;
  END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(debit_base), 0), coalesce(sum(credit), 0), coalesce(sum(credit_base), 0)
    INTO d_prev, db_prev, c_prev, cb_prev FROM general_ledger WHERE journal_batch_id = NEW.journal_batch_id;
  NEW.debit_base := round((d_prev + coalesce(NEW.debit, 0)) * NEW.fx_rate_to_base, 2) - db_prev;
  NEW.credit_base := round((c_prev + coalesce(NEW.credit, 0)) * NEW.fx_rate_to_base, 2) - cb_prev;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_zfx_gl_rates ON general_ledger;
CREATE TRIGGER trg_zfx_gl_rates BEFORE INSERT ON general_ledger FOR EACH ROW EXECUTE FUNCTION set_gl_fx();

-- Existing lines: the same rule, batch by batch in id order (cost-transaction batches take that transaction's rate). A
-- line that cannot be converted stops the migration (record the rate, then re-run).
ALTER TABLE general_ledger DISABLE TRIGGER trg_block_update_general_ledger;
WITH first_line AS (
  SELECT DISTINCT ON (g.journal_batch_id) g.journal_batch_id, g.org_id, g.currency_id, g.transaction_date, g.source_module, g.source_record_id
    FROM general_ledger g WHERE g.fx_rate_to_base IS NULL ORDER BY g.journal_batch_id, g.id),
batch_rate AS (
  SELECT f.journal_batch_id,
         coalesce(CASE WHEN f.source_module = 'cost_transaction' THEN ct.fx_rate_to_base END, r.rate) AS rate,
         coalesce(CASE WHEN f.source_module = 'cost_transaction' THEN ct.fx_rate_date END, r.rate_date) AS rate_date
    FROM first_line f
    LEFT JOIN cost_transactions ct ON f.source_module = 'cost_transaction' AND ct.id = f.source_record_id
   CROSS JOIN LATERAL fx_rate_to_base(f.org_id, f.currency_id, f.transaction_date) r),
lines AS (
  SELECT g.id, b.rate, b.rate_date,
         round(sum(coalesce(g.debit, 0)) OVER w * b.rate, 2)
           - round(coalesce(sum(coalesce(g.debit, 0)) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) * b.rate, 2) AS debit_base,
         round(sum(coalesce(g.credit, 0)) OVER w * b.rate, 2)
           - round(coalesce(sum(coalesce(g.credit, 0)) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) * b.rate, 2) AS credit_base
    FROM general_ledger g JOIN batch_rate b ON b.journal_batch_id = g.journal_batch_id
  WINDOW w AS (PARTITION BY g.journal_batch_id ORDER BY g.id))
UPDATE general_ledger g SET fx_rate_to_base = l.rate, fx_rate_date = l.rate_date, debit_base = l.debit_base, credit_base = l.credit_base
  FROM lines l WHERE l.id = g.id;
ALTER TABLE general_ledger ENABLE TRIGGER trg_block_update_general_ledger;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM general_ledger WHERE fx_rate_to_base IS NULL OR debit_base IS NULL OR credit_base IS NULL) THEN
    RAISE EXCEPTION 'General-ledger lines without an exchange rate for their date exist - record the rates and re-run migration 086';
  END IF;
END $$;
ALTER TABLE general_ledger ALTER COLUMN fx_rate_to_base SET NOT NULL, ALTER COLUMN debit_base SET NOT NULL, ALTER COLUMN credit_base SET NOT NULL;

-- The deferred batch check also requires the base amounts to balance (defence in depth: guaranteed by the allocation).
CREATE OR REPLACE FUNCTION check_gl_batch_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bal NUMERIC(18,2); bal_base NUMERIC(18,2);
BEGIN
    SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0), COALESCE(SUM(debit_base),0) - COALESCE(SUM(credit_base),0) INTO bal, bal_base
    FROM general_ledger WHERE journal_batch_id = NEW.journal_batch_id;

    IF bal <> 0 THEN
        RAISE EXCEPTION 'general_ledger journal_batch_id % does not balance (debit - credit = %). Every posting event must be a balanced double-entry batch.',
            NEW.journal_batch_id, bal;
    END IF;
    IF bal_base <> 0 THEN
        RAISE EXCEPTION 'general_ledger journal_batch_id % does not balance in the base currency (debit - credit = %).', NEW.journal_batch_id, bal_base;
    END IF;
    RETURN NULL;
END $$;
