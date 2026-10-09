-- Stage 27 / DEC-014 (owner decision 2026-10-09): inventory valued at weighted (moving) average cost per store.
-- (transaction managed by migrator)
-- Before (E3 inventory.routes.ts @365f940): the carried cost of transfers and count adjustments was the average of all
-- inbound costs ever received ("average inbound cost", provisional), which ignores what was issued in between; and a
-- stock issue took whatever unit cost the user typed (or none).
-- Now every movement carries a unit cost and the store value is perpetual:
--  * receipts must carry their cost (purchase price);
--  * every outflow (issue, transfer out, negative adjustment) is valued by the database at the store's current moving
--    average for the item - a value supplied by the caller is replaced; with no valued stock the outflow is refused;
--  * a positive adjustment uses its stated cost, or the moving average when none is stated (refused when neither
--    exists); transfer receipts keep the cost carried from the dispatching store;
--  * moving average = sum(quantity x unit cost) / sum(quantity) over the store's valued movements, exact for a
--    perpetual average because each outflow is valued at the average of its moment; movements are serialised per
--    store and item.
-- Specific identification for serial/lot items needs lot tracking, which does not exist yet (F-43).
-- Rollback: DROP TRIGGER trg_inventory_valuation ON inventory_transactions; DROP FUNCTION inventory_moving_average.

CREATE OR REPLACE FUNCTION inventory_moving_average(p_warehouse BIGINT, p_item BIGINT) RETURNS NUMERIC AS $$
  SELECT CASE WHEN sum(quantity) > 0 THEN round(sum(quantity * unit_cost) / sum(quantity), 4) END
  FROM inventory_transactions WHERE warehouse_id = p_warehouse AND inventory_item_id = p_item AND unit_cost IS NOT NULL
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_inventory_valuation() RETURNS trigger AS $$
DECLARE avg_cost numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory_valuation:' || NEW.warehouse_id || ':' || NEW.inventory_item_id, 0));
  avg_cost := inventory_moving_average(NEW.warehouse_id, NEW.inventory_item_id);
  IF NEW.transaction_type = 'receipt' THEN
    IF NEW.unit_cost IS NULL OR NEW.unit_cost < 0 THEN RAISE EXCEPTION 'A receipt must carry its unit cost'; END IF;
  ELSIF NEW.quantity < 0 THEN
    IF avg_cost IS NULL THEN RAISE EXCEPTION 'No valued stock of item % in warehouse % to issue at average cost', NEW.inventory_item_id, NEW.warehouse_id; END IF;
    NEW.unit_cost := avg_cost;
  ELSIF NEW.transaction_type = 'adjustment' AND NEW.unit_cost IS NULL THEN
    IF avg_cost IS NULL THEN RAISE EXCEPTION 'A positive adjustment of an item with no valued stock needs a stated unit cost'; END IF;
    NEW.unit_cost := avg_cost;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_inventory_valuation ON inventory_transactions;
CREATE TRIGGER trg_inventory_valuation BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION guard_inventory_valuation();

-- Store valuation (information): quantity, moving average and value per store and item.
CREATE OR REPLACE FUNCTION inventory_valuation() RETURNS TABLE (warehouse_id BIGINT, inventory_item_id BIGINT, quantity NUMERIC, moving_average NUMERIC, value NUMERIC, unvalued_quantity NUMERIC) AS $$
  SELECT warehouse_id, inventory_item_id, sum(quantity),
         CASE WHEN sum(quantity) FILTER (WHERE unit_cost IS NOT NULL) > 0 THEN round(sum(quantity * unit_cost) FILTER (WHERE unit_cost IS NOT NULL) / sum(quantity) FILTER (WHERE unit_cost IS NOT NULL), 4) END,
         round(coalesce(sum(quantity * unit_cost) FILTER (WHERE unit_cost IS NOT NULL), 0), 2),
         coalesce(sum(quantity) FILTER (WHERE unit_cost IS NULL), 0)
  FROM inventory_transactions GROUP BY warehouse_id, inventory_item_id
$$ LANGUAGE sql STABLE;
