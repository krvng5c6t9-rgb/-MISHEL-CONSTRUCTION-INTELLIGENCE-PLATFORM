-- CC-035 (NDC-011 remainder): reproducible EAC, derived accruals, approved budgets, corrected cost-control view.
-- CO1 v_cost_control_summary only listed project-specific cost codes (every global cost code - i.e. all costs in
--     practice - was invisible) and joined budgets and cost transactions on cost code only, mixing projects.
-- CO2 cost forecasts were free-typed ETC/EAC numbers with no stored inputs: EAC could not be recomputed.
-- CO3 no budget API / approval: budgets could only be set by direct SQL.
-- Definitions (NDC-011 data dictionary, engineering defaults; GL accrual posting stays an owner/accountant decision):
--   committed = sum of committed cost transactions; actual = sum of actual cost transactions (as of a date);
--   accrual   = value received (GRN accepted qty x PO rate, received on/before the date) not yet invoiced on that PO
--               (invoices dated on/before the date), never negative - a cost-control measure, not a GL posting;
--   ETC       = 'manual' (preparer's figure + basis) or 'budget_remaining' = max(current budget - actual - accrual, 0);
--   EAC       = actual + accrual + ETC. Snapshot inputs are captured by the server from the ledger, never typed.
-- (transaction managed by migrator)
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
CREATE OR REPLACE FUNCTION guard_budget() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_by IS NOT NULL THEN RAISE EXCEPTION 'Approved budgets cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.amount < 0 THEN RAISE EXCEPTION 'Budget cannot be negative'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.approved_by IS NOT NULL THEN RAISE EXCEPTION 'Approved budget % is immutable; use a revised budget', OLD.id; END IF;
  IF NEW.approved_by IS NOT NULL AND (NEW.created_by IS NULL OR NEW.approved_by = NEW.created_by) THEN RAISE EXCEPTION 'A budget is approved by someone other than its preparer'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_budget_guard ON budgets;
CREATE TRIGGER trg_budget_guard BEFORE INSERT OR UPDATE OR DELETE ON budgets FOR EACH ROW EXECUTE FUNCTION guard_budget();

CREATE OR REPLACE FUNCTION cost_accrual_as_of(p_project bigint, p_cost_code bigint, p_as_of date) RETURNS numeric AS $$
  SELECT coalesce(sum(greatest(rcv.v - coalesce(inv.v, 0), 0)), 0)::numeric(18,2)
  FROM purchase_orders po
  JOIN LATERAL (SELECT sum(gl.quantity_accepted * pl.unit_rate) v FROM goods_receipt_notes g JOIN grn_lines gl ON gl.grn_id = g.id JOIN po_lines pl ON pl.id = gl.po_line_id
                WHERE g.po_id = po.id AND g.received_date <= p_as_of) rcv ON true
  LEFT JOIN LATERAL (SELECT sum(vi.amount) v FROM vendor_invoices vi WHERE vi.po_id = po.id AND vi.invoice_date <= p_as_of AND vi.status IN ('approved','posted_to_gl','paid')) inv ON true
  WHERE po.project_id = p_project AND po.cost_code_id = p_cost_code AND rcv.v IS NOT NULL;
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS cost_forecast_snapshots (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  cost_code_id BIGINT NOT NULL REFERENCES cost_codes(id),
  as_of DATE NOT NULL,
  budget NUMERIC(18,2) NOT NULL, committed NUMERIC(18,2) NOT NULL, actual NUMERIC(18,2) NOT NULL, accrual NUMERIC(18,2) NOT NULL,
  etc_method VARCHAR(20) NOT NULL CHECK (etc_method IN ('manual','budget_remaining')),
  etc_amount NUMERIC(18,2) NOT NULL CHECK (etc_amount >= 0),
  etc_basis TEXT,
  eac NUMERIC(18,2) GENERATED ALWAYS AS (actual + accrual + etc_amount) STORED,
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id), approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (etc_method <> 'manual' OR length(trim(coalesce(etc_basis,''))) >= 10)
);
-- Inputs are captured from the ledger at insert; never typed. Immutable after approval; approver != preparer.
CREATE OR REPLACE FUNCTION guard_cost_snapshot() RETURNS trigger AS $$
DECLARE b numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cost snapshots cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.as_of > current_date THEN RAISE EXCEPTION 'Snapshot cannot be dated in the future'; END IF;
    SELECT coalesce((SELECT amount FROM budgets WHERE project_id = NEW.project_id AND cost_code_id = NEW.cost_code_id AND budget_type = 'revised' AND approved_by IS NOT NULL),
                    (SELECT amount FROM budgets WHERE project_id = NEW.project_id AND cost_code_id = NEW.cost_code_id AND budget_type = 'original' AND approved_by IS NOT NULL), 0) INTO b;
    NEW.budget := b;
    SELECT coalesce(sum(amount) FILTER (WHERE transaction_type = 'committed'), 0), coalesce(sum(amount) FILTER (WHERE transaction_type = 'actual'), 0)
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
DROP TRIGGER IF EXISTS trg_cost_snapshot_guard ON cost_forecast_snapshots;
CREATE TRIGGER trg_cost_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON cost_forecast_snapshots FOR EACH ROW EXECUTE FUNCTION guard_cost_snapshot();
ALTER TABLE cost_forecast_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_forecast_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON cost_forecast_snapshots;
DROP POLICY IF EXISTS tenant_isolation_write ON cost_forecast_snapshots;
CREATE POLICY tenant_isolation_select ON cost_forecast_snapshots FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON cost_forecast_snapshots FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);

-- CO1: per project x cost code, global and project-specific codes, approved budgets only, latest approved snapshot EAC.
CREATE OR REPLACE VIEW v_cost_control_summary AS
WITH pairs AS (
  SELECT project_id, cost_code_id FROM cost_transactions
  UNION SELECT project_id, cost_code_id FROM budgets WHERE approved_by IS NOT NULL
  UNION SELECT project_id, id FROM cost_codes WHERE project_id IS NOT NULL)
SELECT p.project_id, cc.id AS cost_code_id, cc.code, cc.description,
  coalesce((SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'revised' AND b.approved_by IS NOT NULL),
           (SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'original' AND b.approved_by IS NOT NULL), 0) AS budget,
  coalesce((SELECT sum(amount) FROM cost_transactions t WHERE t.project_id = p.project_id AND t.cost_code_id = cc.id AND t.transaction_type = 'committed'), 0) AS committed,
  coalesce((SELECT sum(amount) FROM cost_transactions t WHERE t.project_id = p.project_id AND t.cost_code_id = cc.id AND t.transaction_type = 'actual'), 0) AS actual,
  (SELECT s.eac FROM cost_forecast_snapshots s WHERE s.project_id = p.project_id AND s.cost_code_id = cc.id AND s.approved_by IS NOT NULL ORDER BY s.as_of DESC, s.id DESC LIMIT 1) AS estimate_at_completion,
  coalesce((SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'revised' AND b.approved_by IS NOT NULL),
           (SELECT amount FROM budgets b WHERE b.project_id = p.project_id AND b.cost_code_id = cc.id AND b.budget_type = 'original' AND b.approved_by IS NOT NULL), 0)
   - coalesce((SELECT s.eac FROM cost_forecast_snapshots s WHERE s.project_id = p.project_id AND s.cost_code_id = cc.id AND s.approved_by IS NOT NULL ORDER BY s.as_of DESC, s.id DESC LIMIT 1), 0) AS variance_at_completion
FROM pairs p JOIN cost_codes cc ON cc.id = p.cost_code_id;
ALTER VIEW v_cost_control_summary SET (security_invoker = true);
