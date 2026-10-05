-- (transaction managed by migrator)

-- Fiscal periods must not overlap within one organization.
CREATE OR REPLACE FUNCTION guard_fiscal_period_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.end_date < NEW.start_date THEN RAISE EXCEPTION 'Fiscal period end_date precedes start_date'; END IF;
  IF EXISTS (
    SELECT 1 FROM fiscal_periods f
    WHERE f.org_id=NEW.org_id AND f.id<>COALESCE(NEW.id,0)
      AND daterange(f.start_date,f.end_date,'[]') && daterange(NEW.start_date,NEW.end_date,'[]')
  ) THEN RAISE EXCEPTION 'Fiscal period overlaps an existing period'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_fiscal_period_overlap ON fiscal_periods;
CREATE TRIGGER trg_guard_fiscal_period_overlap BEFORE INSERT OR UPDATE OF start_date,end_date,org_id ON fiscal_periods
FOR EACH ROW EXECUTE FUNCTION guard_fiscal_period_overlap();

-- Inventory ledger is append-only; corrections must be compensating transactions.
CREATE OR REPLACE FUNCTION block_inventory_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inventory ledger is append-only; post a compensating transaction'; END $$;
DROP TRIGGER IF EXISTS trg_inventory_no_update ON inventory_transactions;
DROP TRIGGER IF EXISTS trg_inventory_no_delete ON inventory_transactions;
CREATE TRIGGER trg_inventory_no_update BEFORE UPDATE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION block_inventory_ledger_mutation();
CREATE TRIGGER trg_inventory_no_delete BEFORE DELETE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION block_inventory_ledger_mutation();

-- Prevent stock from going negative under concurrent postings by serializing per warehouse/item.
CREATE OR REPLACE FUNCTION guard_inventory_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_qty numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text || ':' || NEW.warehouse_id::text || ':' || NEW.inventory_item_id::text, 0));
  SELECT COALESCE(SUM(quantity),0) INTO current_qty FROM inventory_transactions
   WHERE org_id=NEW.org_id AND warehouse_id=NEW.warehouse_id AND inventory_item_id=NEW.inventory_item_id;
  IF current_qty + NEW.quantity < 0 THEN RAISE EXCEPTION 'Insufficient stock: resulting balance would be negative'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inventory_balance_guard ON inventory_transactions;
CREATE TRIGGER trg_inventory_balance_guard BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION guard_inventory_balance();

-- DOA ranges at the same module/level/currency must not overlap once confirmed and active.
CREATE OR REPLACE FUNCTION guard_confirmed_doa_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.is_active AND NEW.is_confirmed AND EXISTS (
   SELECT 1 FROM delegation_of_authority d
   WHERE d.org_id=NEW.org_id AND d.module=NEW.module AND d.approval_level=NEW.approval_level
     AND d.id<>COALESCE(NEW.id,0) AND d.is_active AND d.is_confirmed
     AND COALESCE(d.currency_id,0)=COALESCE(NEW.currency_id,0)
     AND numrange(d.min_amount,COALESCE(d.max_amount,'Infinity'::numeric),'[]') &&
         numrange(NEW.min_amount,COALESCE(NEW.max_amount,'Infinity'::numeric),'[]')
 ) THEN RAISE EXCEPTION 'Confirmed DOA amount range overlaps another active rule'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_confirmed_doa_overlap ON delegation_of_authority;
CREATE TRIGGER trg_guard_confirmed_doa_overlap BEFORE INSERT OR UPDATE ON delegation_of_authority
FOR EACH ROW EXECUTE FUNCTION guard_confirmed_doa_overlap();

-- (transaction managed by migrator)
