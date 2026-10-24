-- Stage 52 / CC-082 / DEC-023 (owner, 2026-10-24): the side of the Central Bank of Egypt rate follows the direction of
-- the exchange.
-- (transaction managed by migrator)
-- Before (E3 @CC-081): the register held one rate per currency and date (rate_to_base) and every conversion used it.
-- Now the register holds the buy and the sell rate of the date (sell >= buy), and each conversion takes the side of the
-- exchange the amount implies:
--  * amounts the company will receive in a foreign currency - client certificates (IPCs), revenue recognised, client
--    retention released, incoming payments - at the BUY rate (the company will sell that currency);
--  * amounts it will pay - cost transactions (and the payables they create), payroll overhead, outgoing payments - at
--    the SELL rate (the company will buy that currency);
--  * a manual journal in a foreign currency states its side (the accountant chooses; none is assumed);
--  * period-end revaluation: monetary asset accounts at the closing BUY rate, liability accounts at the closing SELL rate.
-- EAS 13 requires the spot rate of the date; it does not name a side - the side is the company's policy (DEC-023).
-- A rate recorded as one figure (rate_to_base) serves as both sides. The side used is stored with the frozen rate
-- (cost_transactions.fx_rate_side, general_ledger.fx_rate_side, fx_revaluation_lines.rate_side). Rows written before
-- this migration used the single register rate (both sides equal after the backfill) and keep a null side.
-- Rollback: restore fx_rate_to_base(bigint, bigint, date) from 087, set_cost_transaction_fx (085), set_gl_fx (086);
-- drop gl_fx_side, normalise_exchange_rate and the added columns; restore NOT NULL on exchange_rates.rate_to_base.

ALTER TABLE exchange_rates
  ADD COLUMN IF NOT EXISTS buy_rate NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS sell_rate NUMERIC(20,8);
UPDATE exchange_rates SET buy_rate = rate_to_base, sell_rate = rate_to_base WHERE buy_rate IS NULL OR sell_rate IS NULL;
ALTER TABLE exchange_rates ALTER COLUMN buy_rate SET NOT NULL, ALTER COLUMN sell_rate SET NOT NULL, ALTER COLUMN rate_to_base DROP NOT NULL;
ALTER TABLE exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_sides_check;
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_sides_check CHECK (buy_rate > 0 AND sell_rate >= buy_rate);

-- One figure given: it is both sides. Two given: rate_to_base keeps a value only when they are equal.
CREATE OR REPLACE FUNCTION normalise_exchange_rate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.buy_rate IS NULL AND NEW.sell_rate IS NULL THEN NEW.buy_rate := NEW.rate_to_base; NEW.sell_rate := NEW.rate_to_base; END IF;
  NEW.rate_to_base := CASE WHEN NEW.buy_rate = NEW.sell_rate THEN NEW.buy_rate END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_normalise_exchange_rate ON exchange_rates;
CREATE TRIGGER trg_normalise_exchange_rate BEFORE INSERT OR UPDATE ON exchange_rates FOR EACH ROW EXECUTE FUNCTION normalise_exchange_rate();

ALTER TABLE cost_transactions ADD COLUMN IF NOT EXISTS fx_rate_side VARCHAR(4) CHECK (fx_rate_side IN ('buy', 'sell'));
ALTER TABLE general_ledger ADD COLUMN IF NOT EXISTS fx_rate_side VARCHAR(4) CHECK (fx_rate_side IN ('buy', 'sell'));
ALTER TABLE fx_revaluation_lines ADD COLUMN IF NOT EXISTS rate_side VARCHAR(4) CHECK (rate_side IN ('buy', 'sell'));
ALTER TABLE manual_journal_entries ADD COLUMN IF NOT EXISTS fx_side VARCHAR(4) CHECK (fx_side IN ('buy', 'sell'));

-- The rate rule of 087 with the side named by the caller; the three-argument form is removed so no caller can use a
-- rate without naming its side.
DROP FUNCTION IF EXISTS fx_rate_to_base(bigint, bigint, date);
CREATE OR REPLACE FUNCTION fx_rate_to_base(p_org bigint, p_currency bigint, p_date date, p_side text, OUT rate numeric, OUT rate_date date)
LANGUAGE plpgsql STABLE AS $$
DECLARE base bigint; max_age int; cur_code text;
BEGIN
  IF p_side IS NULL OR p_side NOT IN ('buy', 'sell') THEN RAISE EXCEPTION 'The exchange-rate side must be buy or sell'; END IF;
  SELECT base_currency_id, fx_max_rate_age_days INTO base, max_age FROM organizations WHERE id = p_org;
  IF base IS NULL THEN RAISE EXCEPTION 'Organization % has no base currency', p_org; END IF;
  IF p_currency = base THEN rate := 1; rate_date := p_date; RETURN; END IF;
  SELECT CASE WHEN p_side = 'buy' THEN e.buy_rate ELSE e.sell_rate END, e.rate_date INTO rate, rate_date FROM exchange_rates e
   WHERE e.org_id = p_org AND e.currency_id = p_currency AND e.rate_date <= p_date ORDER BY e.rate_date DESC LIMIT 1;
  IF rate IS NOT NULL AND p_date - rate_date > max_age THEN
    SELECT code INTO cur_code FROM currencies WHERE id = p_currency;
    RAISE EXCEPTION 'The latest exchange rate for % is dated %, more than % days before % - record a current rate first', cur_code, rate_date, max_age, p_date;
  END IF;
END $$;

-- Cost: the company pays, so the SELL rate (085 otherwise unchanged; a reversal keeps the original's rates and side).
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
      NEW.fx_rate_side := o.fx_rate_side;
      NEW.base_amount := round(NEW.amount * NEW.fx_rate_to_base, 2);
      NEW.project_amount := CASE WHEN NEW.currency_id = pcur THEN NEW.amount ELSE round(NEW.amount * NEW.fx_rate_to_base / NEW.project_fx_rate_to_base, 2) END;
      RETURN NEW;
    END IF;
  END IF;
  SELECT * INTO r FROM fx_rate_to_base(NEW.org_id, NEW.currency_id, NEW.transaction_date, 'sell');
  IF r.rate IS NULL THEN
    SELECT code INTO cur_code FROM currencies WHERE id = NEW.currency_id;
    RAISE EXCEPTION 'No exchange rate for % on or before % - record it in the exchange-rate register first', cur_code, NEW.transaction_date;
  END IF;
  SELECT * INTO pr FROM fx_rate_to_base(NEW.org_id, pcur, NEW.transaction_date, 'sell');
  IF pr.rate IS NULL THEN
    SELECT code INTO cur_code FROM currencies WHERE id = pcur;
    RAISE EXCEPTION 'No exchange rate for the project currency % on or before % - record it in the exchange-rate register first', cur_code, NEW.transaction_date;
  END IF;
  NEW.fx_rate_to_base := r.rate; NEW.fx_rate_date := r.rate_date; NEW.project_fx_rate_to_base := pr.rate;
  NEW.fx_rate_side := CASE WHEN NEW.currency_id = NEW.base_currency_id AND pcur = NEW.base_currency_id THEN NULL ELSE 'sell' END;
  NEW.base_amount := round(NEW.amount * r.rate, 2);
  NEW.project_amount := CASE WHEN NEW.currency_id = pcur THEN NEW.amount ELSE round(NEW.amount * r.rate / pr.rate, 2) END;
  RETURN NEW;
END $$;

-- The side a GL batch takes from its source document (null when the source does not imply one).
CREATE OR REPLACE FUNCTION gl_fx_side(p_source_module text, p_source_record_id bigint) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE s text;
BEGIN
  IF p_source_module IN ('ipc', 'revenue_recognition', 'retention_release') THEN RETURN 'buy'; END IF;
  IF p_source_module IN ('cost_transaction', 'payroll_overhead') THEN RETURN 'sell'; END IF;
  IF p_source_module = 'payment' THEN
    SELECT CASE payment_type WHEN 'incoming' THEN 'buy' WHEN 'outgoing' THEN 'sell' END INTO s FROM payments WHERE id = p_source_record_id;
    RETURN s;
  END IF;
  IF p_source_module = 'manual_journal' THEN
    SELECT fx_side INTO s FROM manual_journal_entries WHERE id = p_source_record_id;
    RETURN s;
  END IF;
  RETURN NULL;
END $$;

-- GL (086 otherwise unchanged): a batch shares one rate; a cost-transaction batch takes that transaction's frozen rate
-- and side; otherwise the side comes from the source and a foreign-currency line without one is refused.
CREATE OR REPLACE FUNCTION set_gl_fx() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev record; r record; cur_code text; side text; base bigint; d_prev numeric; db_prev numeric; c_prev numeric; cb_prev numeric;
BEGIN
  SELECT fx_rate_to_base, fx_rate_date, fx_rate_side INTO prev FROM general_ledger
   WHERE journal_batch_id = NEW.journal_batch_id AND fx_rate_to_base IS NOT NULL ORDER BY id LIMIT 1;
  IF prev.fx_rate_to_base IS NOT NULL THEN
    NEW.fx_rate_to_base := prev.fx_rate_to_base; NEW.fx_rate_date := prev.fx_rate_date; NEW.fx_rate_side := prev.fx_rate_side;
  ELSIF NEW.source_module = 'cost_transaction' THEN
    SELECT fx_rate_to_base, fx_rate_date, fx_rate_side INTO NEW.fx_rate_to_base, NEW.fx_rate_date, NEW.fx_rate_side FROM cost_transactions WHERE id = NEW.source_record_id;
  END IF;
  IF NEW.fx_rate_to_base IS NULL THEN
    SELECT base_currency_id INTO base FROM organizations WHERE id = NEW.org_id;
    IF NEW.currency_id = base THEN
      side := NULL; NEW.fx_rate_to_base := 1; NEW.fx_rate_date := NEW.transaction_date;
    ELSE
      side := gl_fx_side(NEW.source_module, NEW.source_record_id);
      SELECT code INTO cur_code FROM currencies WHERE id = NEW.currency_id;
      IF side IS NULL THEN
        RAISE EXCEPTION 'The exchange-rate side (buy or sell) of this % entry is not known - a manual journal in a foreign currency must state it', cur_code;
      END IF;
      SELECT * INTO r FROM fx_rate_to_base(NEW.org_id, NEW.currency_id, NEW.transaction_date, side);
      IF r.rate IS NULL THEN
        RAISE EXCEPTION 'No exchange rate for % on or before % - record it in the exchange-rate register first', cur_code, NEW.transaction_date;
      END IF;
      NEW.fx_rate_to_base := r.rate; NEW.fx_rate_date := r.rate_date; NEW.fx_rate_side := side;
    END IF;
  END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(debit_base), 0), coalesce(sum(credit), 0), coalesce(sum(credit_base), 0)
    INTO d_prev, db_prev, c_prev, cb_prev FROM general_ledger WHERE journal_batch_id = NEW.journal_batch_id;
  NEW.debit_base := round((d_prev + coalesce(NEW.debit, 0)) * NEW.fx_rate_to_base, 2) - db_prev;
  NEW.credit_base := round((c_prev + coalesce(NEW.credit, 0)) * NEW.fx_rate_to_base, 2) - cb_prev;
  RETURN NEW;
END $$;
