-- CC-033 (RK-003 / inventory): first runtime execution (sweep_inventory.mjs).
-- IN0 every warehouse transfer failed (42725 "operator is not unique: - unknown" -> HTTP 500): transfers never worked
--     (fixed in the route).
-- IN1 any user with procurement.edit could post stock adjustments (create or destroy stock) with no reason.
-- IN2 transfers accepted a user-typed unit cost (revaluing stock on the move), future dates, and a project tag
--     different from the destination store's project; issues accepted no project.
-- IN3 the ledger accepted an unpaired transfer leg (stock created from nothing at DB level).
-- Valuation basis of a transfer (source store's average inbound cost, carried unchanged to both legs) is a
-- PROVISIONAL engineering default pending DEC-014 (inventory valuation method), not an accounting policy.
-- (transaction managed by migrator)
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE OR REPLACE FUNCTION guard_inventory_movement() RETURNS trigger AS $$
DECLARE o record; wp bigint;
BEGIN
  IF NEW.transaction_date > current_date THEN RAISE EXCEPTION 'Stock movements cannot be dated in the future'; END IF;
  IF NEW.transaction_type = 'adjustment' AND length(trim(coalesce(NEW.reason,''))) < 5 THEN RAISE EXCEPTION 'A stock adjustment needs a reason'; END IF;
  IF NEW.transaction_type = 'issue' AND (NEW.quantity >= 0 OR NEW.project_id IS NULL) THEN RAISE EXCEPTION 'An issue is a negative movement to a project'; END IF;
  IF NEW.transaction_type = 'transfer_in' THEN
    SELECT * INTO o FROM inventory_transactions WHERE id = NEW.source_record_id;
    IF o.id IS NULL OR o.transaction_type <> 'transfer_out' OR o.inventory_item_id <> NEW.inventory_item_id OR o.quantity <> -NEW.quantity
       OR o.org_id <> NEW.org_id OR o.warehouse_id = NEW.warehouse_id OR o.unit_cost IS DISTINCT FROM NEW.unit_cost THEN
      RAISE EXCEPTION 'A transfer receipt must mirror exactly one transfer issue (item, quantity, cost)';
    END IF;
    IF EXISTS (SELECT 1 FROM inventory_transactions WHERE transaction_type = 'transfer_in' AND source_record_id = NEW.source_record_id) THEN
      RAISE EXCEPTION 'Transfer issue % is already received', NEW.source_record_id;
    END IF;
    SELECT project_id INTO wp FROM warehouses WHERE id = NEW.warehouse_id;
    IF wp IS NOT NULL AND NEW.project_id IS DISTINCT FROM wp THEN RAISE EXCEPTION 'Transfer project must be the destination store project'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_inventory_movement ON inventory_transactions;
CREATE TRIGGER trg_inventory_movement BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION guard_inventory_movement();

-- A transfer issue must be received in the same transaction (checked at commit).
CREATE OR REPLACE FUNCTION check_transfer_paired() RETURNS trigger AS $$
BEGIN
  IF NEW.transaction_type = 'transfer_out' AND NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE transaction_type = 'transfer_in' AND source_record_id = NEW.id) THEN
    RAISE EXCEPTION 'Transfer issue % has no matching receipt', NEW.id;
  END IF;
  IF NEW.transaction_type = 'transfer_in' AND NEW.source_record_id IS NULL THEN RAISE EXCEPTION 'Unpaired transfer receipt'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_transfer_paired ON inventory_transactions;
CREATE CONSTRAINT TRIGGER trg_transfer_paired AFTER INSERT ON inventory_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transfer_paired();
