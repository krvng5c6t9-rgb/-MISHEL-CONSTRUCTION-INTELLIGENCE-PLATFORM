-- NDC-030 (Stage 10): inventory control workflows.
-- (transaction managed by migrator)
--  * Two-step transfer: dispatch (source leg posted, stock in transit) -> receipt confirmed by a DIFFERENT user at the
--    destination (destination leg = quantity actually received). A short receipt needs a reason and stays open until a
--    third person (procurement approver, not the dispatcher or receiver) accepts the shortage.
--    Before CC-039 a transfer moved stock into the destination instantly with no receipt (E1 sweep_inventory, CC-033).
--  * Physical stock count: count sheet (open) -> submitted (system quantity snapshotted, variance = counted - system,
--    every variance explained) -> approved by someone other than the counter (variance adjustments posted to the
--    ledger, refused if stock moved since submission) or rejected with a reason.
--  * Issues may carry the cost code they are consumed against (same organization). Cost posting of issues waits for
--    DEC-014 (valuation) - not done here.
--  * Carried cost on dispatch / count adjustments = source store average inbound cost: PROVISIONAL pending DEC-014.
-- Rollback: DROP TABLE stock_count_lines, stock_counts, stock_transfers; restore guard_inventory_movement and
--           check_transfer_paired from 056 (re-enables one-step transfers); ALTER TABLE inventory_transactions DROP COLUMN cost_code_id.

ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS cost_code_id BIGINT REFERENCES cost_codes(id);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  from_warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  project_id BIGINT REFERENCES projects(id),
  inventory_item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4),
  status VARCHAR(20) NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched','received','received_short','shortage_accepted')),
  dispatched_by BIGINT NOT NULL REFERENCES users(id),
  dispatched_on DATE NOT NULL DEFAULT current_date,
  received_by BIGINT REFERENCES users(id),
  received_on DATE,
  received_quantity NUMERIC(18,3),
  discrepancy_reason TEXT,
  shortage_accepted_by BIGINT REFERENCES users(id),
  shortage_accepted_at TIMESTAMPTZ,
  shortage_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_open ON stock_transfers(org_id, status);

CREATE OR REPLACE FUNCTION guard_stock_transfer() RETURNS trigger AS $$
DECLARE wf record; wt record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Stock transfers cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'dispatched' OR NEW.received_by IS NOT NULL OR NEW.received_quantity IS NOT NULL THEN RAISE EXCEPTION 'A transfer starts as dispatched'; END IF;
    IF NEW.dispatched_on > current_date THEN RAISE EXCEPTION 'Stock movements cannot be dated in the future'; END IF;
    SELECT id, org_id, project_id INTO wf FROM warehouses WHERE id = NEW.from_warehouse_id;
    SELECT id, org_id, project_id INTO wt FROM warehouses WHERE id = NEW.to_warehouse_id;
    IF wf.id IS NULL OR wt.id IS NULL OR wf.org_id <> NEW.org_id OR wt.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Warehouse not found in this organization'; END IF;
    IF wt.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM wt.project_id THEN RAISE EXCEPTION 'Transfer project must be the destination store project'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.from_warehouse_id, NEW.to_warehouse_id, NEW.project_id, NEW.inventory_item_id, NEW.quantity, NEW.unit_cost, NEW.dispatched_by, NEW.dispatched_on)
     IS DISTINCT FROM (OLD.org_id, OLD.from_warehouse_id, OLD.to_warehouse_id, OLD.project_id, OLD.inventory_item_id, OLD.quantity, OLD.unit_cost, OLD.dispatched_by, OLD.dispatched_on) THEN
    RAISE EXCEPTION 'Dispatch details of transfer % are immutable', OLD.id;
  END IF;
  IF OLD.status = 'dispatched' AND NEW.status IN ('received','received_short') THEN
    IF NEW.received_by IS NULL OR NEW.received_by = NEW.dispatched_by THEN RAISE EXCEPTION 'Receipt must be confirmed by someone other than the dispatcher'; END IF;
    IF NEW.received_on IS NULL OR NEW.received_on < NEW.dispatched_on OR NEW.received_on > current_date THEN RAISE EXCEPTION 'Receipt date must be between dispatch and today'; END IF;
    IF NEW.received_quantity IS NULL OR NEW.received_quantity < 0 OR NEW.received_quantity > NEW.quantity THEN RAISE EXCEPTION 'Received quantity must be between 0 and the dispatched quantity'; END IF;
    IF NEW.status = 'received' AND NEW.received_quantity <> NEW.quantity THEN RAISE EXCEPTION 'A short receipt must be recorded as received_short'; END IF;
    IF NEW.status = 'received_short' AND (NEW.received_quantity = NEW.quantity OR length(trim(coalesce(NEW.discrepancy_reason,''))) < 5) THEN
      RAISE EXCEPTION 'A short receipt needs a quantity below the dispatched quantity and a discrepancy reason';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'received_short' AND NEW.status = 'shortage_accepted' AND (NEW.received_by, NEW.received_on, NEW.received_quantity, NEW.discrepancy_reason) IS NOT DISTINCT FROM (OLD.received_by, OLD.received_on, OLD.received_quantity, OLD.discrepancy_reason) THEN
    IF NEW.shortage_accepted_by IS NULL OR NEW.shortage_accepted_by IN (NEW.dispatched_by, NEW.received_by) THEN RAISE EXCEPTION 'A transit shortage is accepted by someone other than the dispatcher and the receiver'; END IF;
    IF length(trim(coalesce(NEW.shortage_note,''))) < 5 THEN RAISE EXCEPTION 'Accepting a transit shortage needs a note'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid stock transfer change (% -> %)', OLD.status, NEW.status;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_transfer ON stock_transfers;
CREATE TRIGGER trg_stock_transfer BEFORE INSERT OR UPDATE OR DELETE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION guard_stock_transfer();

-- Ledger legs of a two-step transfer must match the transfer document; checked at commit.
CREATE OR REPLACE FUNCTION check_stock_transfer_legs() RETURNS trigger AS $$
DECLARE n_out int; n_in int; q_in numeric;
BEGIN
  SELECT count(*) FILTER (WHERE transaction_type = 'transfer_out'), count(*) FILTER (WHERE transaction_type = 'transfer_in'),
         coalesce(sum(quantity) FILTER (WHERE transaction_type = 'transfer_in'), 0)
    INTO n_out, n_in, q_in FROM inventory_transactions WHERE source_table = 'stock_transfer' AND source_record_id = NEW.id;
  IF n_out <> 1 THEN RAISE EXCEPTION 'Transfer % must have exactly one dispatch leg', NEW.id; END IF;
  IF NEW.status = 'dispatched' AND n_in <> 0 THEN RAISE EXCEPTION 'Transfer % is not received yet', NEW.id; END IF;
  IF NEW.status <> 'dispatched' AND (n_in > 1 OR q_in <> NEW.received_quantity OR (NEW.received_quantity > 0 AND n_in <> 1)) THEN
    RAISE EXCEPTION 'Transfer % receipt leg must equal the received quantity', NEW.id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_transfer_legs ON stock_transfers;
CREATE CONSTRAINT TRIGGER trg_stock_transfer_legs AFTER INSERT OR UPDATE ON stock_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_stock_transfer_legs();

-- Stock counts.
CREATE TABLE IF NOT EXISTS stock_counts (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  count_date DATE NOT NULL DEFAULT current_date,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved','rejected')),
  counted_by BIGINT NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  decided_by BIGINT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR length(trim(coalesce(rejection_reason,''))) >= 5),
  CHECK (status NOT IN ('approved','rejected') OR (decided_by IS NOT NULL AND decided_by <> counted_by))
);
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  stock_count_id BIGINT NOT NULL REFERENCES stock_counts(id),
  inventory_item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  counted_quantity NUMERIC(18,3) NOT NULL CHECK (counted_quantity >= 0),
  system_quantity NUMERIC(18,3),
  variance NUMERIC(18,3) GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED,
  variance_reason TEXT,
  unit_cost NUMERIC(18,4),
  UNIQUE (stock_count_id, inventory_item_id)
);
CREATE OR REPLACE FUNCTION guard_stock_count() RETURNS trigger AS $$
DECLARE w record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Stock counts cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT id, org_id INTO w FROM warehouses WHERE id = NEW.warehouse_id;
    IF w.id IS NULL OR w.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Warehouse not found in this organization'; END IF;
    IF NEW.status <> 'open' OR NEW.count_date > current_date THEN RAISE EXCEPTION 'A stock count starts open and cannot be future-dated'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.warehouse_id, NEW.count_date, NEW.counted_by) IS DISTINCT FROM (OLD.org_id, OLD.warehouse_id, OLD.count_date, OLD.counted_by) THEN
    RAISE EXCEPTION 'Stock count header is immutable';
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'submitted' THEN
    IF NOT EXISTS (SELECT 1 FROM stock_count_lines WHERE stock_count_id = NEW.id) THEN RAISE EXCEPTION 'A count sheet needs at least one line'; END IF;
    IF EXISTS (SELECT 1 FROM stock_count_lines WHERE stock_count_id = NEW.id AND (system_quantity IS NULL OR (variance <> 0 AND length(trim(coalesce(variance_reason,''))) < 5))) THEN
      RAISE EXCEPTION 'Every count line needs its system quantity and every variance an explanation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'submitted' AND NEW.status IN ('approved','rejected') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid stock count change (% -> %)', OLD.status, NEW.status;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_count ON stock_counts;
CREATE TRIGGER trg_stock_count BEFORE INSERT OR UPDATE OR DELETE ON stock_counts FOR EACH ROW EXECUTE FUNCTION guard_stock_count();

CREATE OR REPLACE FUNCTION guard_stock_count_line() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  SELECT id, org_id, status INTO c FROM stock_counts WHERE id = coalesce(NEW.stock_count_id, OLD.stock_count_id);
  IF TG_OP = 'DELETE' THEN
    IF c.status <> 'open' THEN RAISE EXCEPTION 'Lines of a submitted count are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Stock count not found in this organization'; END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'Lines of a submitted count are immutable'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_stock_count_line ON stock_count_lines;
CREATE TRIGGER trg_stock_count_line BEFORE INSERT OR UPDATE OR DELETE ON stock_count_lines FOR EACH ROW EXECUTE FUNCTION guard_stock_count_line();

-- Ledger guard: adds two-step transfer legs, count adjustments and issue cost codes to the 056 rules.
CREATE OR REPLACE FUNCTION guard_inventory_movement() RETURNS trigger AS $$
DECLARE t record; l record;
BEGIN
  IF NEW.transaction_date > current_date THEN RAISE EXCEPTION 'Stock movements cannot be dated in the future'; END IF;
  IF NEW.transaction_type = 'adjustment' AND length(trim(coalesce(NEW.reason,''))) < 5 THEN RAISE EXCEPTION 'A stock adjustment needs a reason'; END IF;
  IF NEW.transaction_type = 'issue' AND (NEW.quantity >= 0 OR NEW.project_id IS NULL) THEN RAISE EXCEPTION 'An issue is a negative movement to a project'; END IF;
  IF NEW.cost_code_id IS NOT NULL THEN
    IF NEW.transaction_type <> 'issue' THEN RAISE EXCEPTION 'Only issues carry a consumption cost code'; END IF;
    IF NOT EXISTS (SELECT 1 FROM cost_codes WHERE id = NEW.cost_code_id AND org_id = NEW.org_id AND is_active) THEN RAISE EXCEPTION 'Cost code % not found in this organization', NEW.cost_code_id; END IF;
  END IF;
  IF NEW.source_table = 'stock_transfer' THEN
    SELECT * INTO t FROM stock_transfers WHERE id = NEW.source_record_id;
    IF t.id IS NULL OR t.org_id <> NEW.org_id OR t.inventory_item_id <> NEW.inventory_item_id OR t.unit_cost IS DISTINCT FROM NEW.unit_cost
       OR NEW.project_id IS DISTINCT FROM t.project_id THEN
      RAISE EXCEPTION 'Transfer leg does not match transfer document %', NEW.source_record_id;
    END IF;
    IF NEW.transaction_type = 'transfer_out' AND (t.status <> 'dispatched' OR NEW.warehouse_id <> t.from_warehouse_id OR NEW.quantity <> -t.quantity) THEN
      RAISE EXCEPTION 'Dispatch leg must take the dispatched quantity from the source store';
    END IF;
    IF NEW.transaction_type = 'transfer_in' AND (t.status NOT IN ('received','received_short') OR NEW.warehouse_id <> t.to_warehouse_id OR NEW.quantity <> t.received_quantity) THEN
      RAISE EXCEPTION 'Receipt leg must put the received quantity into the destination store';
    END IF;
    IF NEW.transaction_type NOT IN ('transfer_out','transfer_in') THEN RAISE EXCEPTION 'Only transfer legs reference a transfer document'; END IF;
    IF EXISTS (SELECT 1 FROM inventory_transactions WHERE source_table = 'stock_transfer' AND source_record_id = NEW.source_record_id AND transaction_type = NEW.transaction_type) THEN
      RAISE EXCEPTION 'Transfer % already has its % leg', NEW.source_record_id, NEW.transaction_type;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_table = 'stock_count' THEN
    SELECT cl.*, sc.status AS count_status, sc.warehouse_id AS count_wh INTO l FROM stock_count_lines cl JOIN stock_counts sc ON sc.id = cl.stock_count_id WHERE cl.id = NEW.source_record_id;
    IF l.id IS NULL OR NEW.transaction_type <> 'adjustment' OR l.count_status <> 'approved' OR l.org_id <> NEW.org_id OR l.count_wh <> NEW.warehouse_id
       OR l.inventory_item_id <> NEW.inventory_item_id OR l.variance <> NEW.quantity THEN
      RAISE EXCEPTION 'Count adjustment must post the approved variance of its count line';
    END IF;
    IF EXISTS (SELECT 1 FROM inventory_transactions WHERE source_table = 'stock_count' AND source_record_id = NEW.source_record_id) THEN RAISE EXCEPTION 'Count line % is already posted', NEW.source_record_id; END IF;
    RETURN NEW;
  END IF;
  -- One-step (instant) transfers are retired: every transfer needs a dispatch and a separate receipt (NDC-030).
  IF NEW.transaction_type IN ('transfer_in','transfer_out') THEN
    RAISE EXCEPTION 'Transfers go through a dispatched transfer document and a separate receipt';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Legacy one-step pairing keeps checking any legacy 'warehouse_transfer' legs (none can be added now).
CREATE OR REPLACE FUNCTION check_transfer_paired() RETURNS trigger AS $$
BEGIN
  IF NEW.source_table = 'stock_transfer' THEN RETURN NULL; END IF;
  IF NEW.transaction_type = 'transfer_out' AND NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE transaction_type = 'transfer_in' AND source_record_id = NEW.id) THEN
    RAISE EXCEPTION 'Transfer issue % has no matching receipt', NEW.id;
  END IF;
  IF NEW.transaction_type = 'transfer_in' AND NEW.source_record_id IS NULL THEN RAISE EXCEPTION 'Unpaired transfer receipt'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stock_transfers','stock_counts','stock_count_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
