-- GC-15 runtime defects (sweep_variations.mjs, first execution):
--  VA1 variations accepted on an unsigned contract;  VA2 cost impact not reconciled with lines;
--  VA3 lines added after submission;  VA4 no client-agreement path - internal approval was the end state, so an
--  approved variation never reached the execution BOQ or contract value;  VA5 omission (negative) variations
--  could not be routed through DOA at all (fixed in the route: DOA routes on the absolute value).
-- (transaction managed by migrator)
-- STEP09 truth: instruction != internal approval != client-agreed valuation. Only an agreed valuation changes
-- the execution BOQ (revised_* columns) and the project's current contract value.
ALTER TABLE variations ADD COLUMN IF NOT EXISTS client_status VARCHAR(15) NOT NULL DEFAULT 'not_submitted' CHECK (client_status IN ('not_submitted','submitted','agreed','rejected'));
ALTER TABLE variations ADD COLUMN IF NOT EXISTS client_submitted_on DATE;
ALTER TABLE variations ADD COLUMN IF NOT EXISTS client_submission_reference TEXT;
ALTER TABLE variations ADD COLUMN IF NOT EXISTS client_decided_on DATE;
ALTER TABLE variations ADD COLUMN IF NOT EXISTS client_decision_reference TEXT;
ALTER TABLE variations ADD COLUMN IF NOT EXISTS agreed_amount NUMERIC(18,2);
ALTER TABLE variations ADD COLUMN IF NOT EXISTS agreed_time_days INT;
ALTER TABLE variations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
ALTER TABLE project_boq ADD COLUMN IF NOT EXISTS source_variation_id BIGINT REFERENCES variations(id);

CREATE OR REPLACE FUNCTION guard_variation() RETURNS trigger AS $$
DECLARE line_total numeric; line_count int; bad record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'proposed' THEN RAISE EXCEPTION 'Only proposed variations can be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.project_id = NEW.project_id AND c.org_id = NEW.org_id AND c.contract_status IN ('signed','active')) THEN
      RAISE EXCEPTION 'Variations can only be raised on a signed or active contract of the same project';
    END IF;
    IF NEW.status <> 'proposed' OR NEW.client_status <> 'not_submitted' THEN RAISE EXCEPTION 'Variations start as proposed'; END IF;
    RETURN NEW;
  END IF;
  -- Valuation is frozen once submitted.
  IF OLD.status <> 'proposed' AND (NEW.cost_impact, NEW.time_impact_days, NEW.contract_id, NEW.project_id, NEW.variation_no) IS DISTINCT FROM (OLD.cost_impact, OLD.time_impact_days, OLD.contract_id, OLD.project_id, OLD.variation_no) THEN
    RAISE EXCEPTION 'Variation valuation is frozen after submission';
  END IF;
  IF OLD.status = 'proposed' AND NEW.status = 'under_review' THEN
    SELECT coalesce(sum(CASE WHEN action = 'omit' THEN -amount ELSE amount END), 0), count(*) INTO line_total, line_count FROM variation_boq_lines WHERE variation_id = NEW.id;
    IF line_count > 0 AND line_total <> NEW.cost_impact THEN
      RAISE EXCEPTION 'Variation cost impact % does not equal its lines %', NEW.cost_impact, line_total;
    END IF;
    FOR bad IN
      SELECT b.item_no, coalesce(b.revised_quantity, b.contract_quantity) + sum(CASE WHEN l.action = 'omit' THEN -l.quantity ELSE l.quantity END) AS resulting
      FROM variation_boq_lines l JOIN project_boq b ON b.id = l.project_boq_item_id
      WHERE l.variation_id = NEW.id GROUP BY b.id, b.item_no, b.revised_quantity, b.contract_quantity
      HAVING coalesce(b.revised_quantity, b.contract_quantity) + sum(CASE WHEN l.action = 'omit' THEN -l.quantity ELSE l.quantity END) < 0
    LOOP
      RAISE EXCEPTION 'Variation would make BOQ item % negative (%)', bad.item_no, bad.resulting;
    END LOOP;
    IF EXISTS (SELECT 1 FROM variation_boq_lines l JOIN project_boq b ON b.id = l.project_boq_item_id WHERE l.variation_id = NEW.id AND b.project_id <> NEW.project_id) THEN
      RAISE EXCEPTION 'Variation lines must reference execution BOQ items of the same project';
    END IF;
    IF EXISTS (SELECT 1 FROM variation_boq_lines WHERE variation_id = NEW.id AND project_boq_item_id IS NULL AND action <> 'add') THEN
      RAISE EXCEPTION 'Omit/amend lines must reference an execution BOQ item';
    END IF;
  END IF;
  -- Client path: only after internal approval; one-way; agreed valuation must match the lines.
  IF NEW.client_status IS DISTINCT FROM OLD.client_status THEN
    IF NEW.status <> 'approved' THEN RAISE EXCEPTION 'Only internally approved variations go to the client'; END IF;
    IF NOT ((OLD.client_status = 'not_submitted' AND NEW.client_status = 'submitted') OR (OLD.client_status = 'submitted' AND NEW.client_status IN ('agreed','rejected'))) THEN
      RAISE EXCEPTION 'Invalid client status transition % -> %', OLD.client_status, NEW.client_status;
    END IF;
    IF NEW.client_status = 'submitted' AND (NEW.client_submitted_on IS NULL OR NEW.client_submission_reference IS NULL) THEN RAISE EXCEPTION 'Client submission needs date and reference'; END IF;
    IF NEW.client_status IN ('agreed','rejected') AND (NEW.client_decided_on IS NULL OR NEW.client_decision_reference IS NULL OR NEW.client_decided_on < NEW.client_submitted_on) THEN
      RAISE EXCEPTION 'Client decision needs a reference and a date not before submission';
    END IF;
    IF NEW.client_status = 'agreed' THEN
      IF NEW.agreed_amount IS NULL THEN RAISE EXCEPTION 'Agreed amount is required'; END IF;
      IF EXISTS (SELECT 1 FROM variation_boq_lines WHERE variation_id = NEW.id) AND NEW.agreed_amount <> NEW.cost_impact THEN
        RAISE EXCEPTION 'Agreed amount % differs from the variation lines %; raise a revised variation', NEW.agreed_amount, NEW.cost_impact;
      END IF;
    END IF;
  ELSIF OLD.client_status IN ('agreed','rejected') AND (NEW.agreed_amount, NEW.agreed_time_days, NEW.client_decided_on, NEW.client_decision_reference) IS DISTINCT FROM (OLD.agreed_amount, OLD.agreed_time_days, OLD.client_decided_on, OLD.client_decision_reference) THEN
    RAISE EXCEPTION 'Client decision is immutable';
  END IF;
  IF OLD.applied_at IS NOT NULL AND NEW.applied_at IS DISTINCT FROM OLD.applied_at THEN RAISE EXCEPTION 'Variation already applied'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_variation_guard ON variations;
CREATE TRIGGER trg_variation_guard BEFORE INSERT OR UPDATE OR DELETE ON variations FOR EACH ROW EXECUTE FUNCTION guard_variation();

CREATE OR REPLACE FUNCTION guard_variation_lines() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM variations WHERE id = COALESCE(NEW.variation_id, OLD.variation_id);
  IF st IS DISTINCT FROM 'proposed' THEN RAISE EXCEPTION 'Variation lines can only change while the variation is proposed (status %)', st; END IF;
  IF TG_OP <> 'DELETE' AND NEW.quantity <= 0 THEN RAISE EXCEPTION 'Line quantity must be positive; use action omit to reduce'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_variation_lines_guard ON variation_boq_lines;
CREATE TRIGGER trg_variation_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON variation_boq_lines FOR EACH ROW EXECUTE FUNCTION guard_variation_lines();
