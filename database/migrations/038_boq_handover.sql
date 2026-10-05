-- G-001 / F-01: estimating BOQ (boq_master) -> execution BOQ (project_boq) handover.
-- (transaction managed by migrator)
-- Design (governance/decomposition GC-02 step 3):
--  * a handover record is append-only evidence of what was handed over, from which source,
--    and how the BOQ total reconciles with the contract value;
--  * a zero difference completes immediately; any difference needs acceptance by a different
--    user holding boq.approve (preparer != approver, frozen SoD pattern) with a reason;
--  * once a project has a pending/completed handover its source estimating rows are frozen,
--    and contract quantities/rates in project_boq can no longer be edited (only revised_* via variations).

CREATE TABLE IF NOT EXISTS boq_handovers (
    id                    BIGSERIAL PRIMARY KEY,
    org_id                BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    project_id            BIGINT NOT NULL REFERENCES projects(id),
    contract_id           BIGINT NOT NULL REFERENCES contracts(id),
    source_type           VARCHAR(10) NOT NULL CHECK (source_type IN ('project', 'tender')),
    source_tender_id      BIGINT REFERENCES tenders(id),
    item_count            INT NOT NULL CHECK (item_count > 0),
    boq_total             NUMERIC(18,2) NOT NULL,
    contract_value        NUMERIC(18,2) NOT NULL,
    difference            NUMERIC(18,2) NOT NULL,
    status                VARCHAR(30) NOT NULL CHECK (status IN ('pending_acceptance', 'completed', 'rejected')),
    difference_reason     TEXT,
    prepared_by           BIGINT NOT NULL REFERENCES users(id),
    accepted_by           BIGINT REFERENCES users(id),
    accepted_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (difference = contract_value - boq_total),
    CHECK (status <> 'completed' OR difference = 0 OR (accepted_by IS NOT NULL AND accepted_by <> prepared_by AND difference_reason IS NOT NULL)),
    CHECK ((source_type = 'tender') = (source_tender_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_boq_handover_active ON boq_handovers(project_id) WHERE status IN ('pending_acceptance', 'completed');
CREATE INDEX IF NOT EXISTS idx_boq_handovers_org ON boq_handovers(org_id);

ALTER TABLE project_boq ADD COLUMN IF NOT EXISTS handover_id BIGINT REFERENCES boq_handovers(id);

-- Handover records: only pending_acceptance -> completed/rejected transitions; no deletes.
CREATE OR REPLACE FUNCTION guard_boq_handover_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'boq_handovers is append-only'; END IF;
  IF OLD.status <> 'pending_acceptance' OR NEW.status NOT IN ('completed', 'rejected')
     OR (to_jsonb(NEW) - 'status' - 'accepted_by' - 'accepted_at' - 'difference_reason')
        <> (to_jsonb(OLD) - 'status' - 'accepted_by' - 'accepted_at' - 'difference_reason') THEN
    RAISE EXCEPTION 'boq_handovers: only pending_acceptance -> completed/rejected is permitted';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_boq_handover_guard ON boq_handovers;
CREATE TRIGGER trg_boq_handover_guard BEFORE UPDATE OR DELETE ON boq_handovers FOR EACH ROW EXECUTE FUNCTION guard_boq_handover_mutation();

-- Source estimating rows are frozen once handed over (or pending acceptance).
CREATE OR REPLACE FUNCTION guard_boq_master_after_handover() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM boq_handovers h
             WHERE h.status IN ('pending_acceptance', 'completed')
               AND ((h.source_type = 'project' AND h.project_id = OLD.project_id)
                 OR (h.source_type = 'tender' AND h.source_tender_id = OLD.tender_id))) THEN
    RAISE EXCEPTION 'BOQ item % is part of a handover to execution and cannot be changed', OLD.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_boq_master_handover_freeze ON boq_master;
CREATE TRIGGER trg_boq_master_handover_freeze BEFORE UPDATE OR DELETE ON boq_master FOR EACH ROW EXECUTE FUNCTION guard_boq_master_after_handover();

-- Same freeze for the rate build-up of frozen items.
CREATE OR REPLACE FUNCTION guard_rate_buildup_after_handover() RETURNS trigger AS $$
DECLARE m boq_master%ROWTYPE;
BEGIN
  SELECT * INTO m FROM boq_master WHERE id = COALESCE(NEW.boq_master_id, OLD.boq_master_id);
  IF EXISTS (SELECT 1 FROM boq_handovers h
             WHERE h.status IN ('pending_acceptance', 'completed')
               AND ((h.source_type = 'project' AND h.project_id = m.project_id)
                 OR (h.source_type = 'tender' AND h.source_tender_id = m.tender_id))) THEN
    RAISE EXCEPTION 'Rate build-up of BOQ item % is frozen by handover', m.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_rate_buildup_handover_freeze ON boq_rate_buildup;
CREATE TRIGGER trg_rate_buildup_handover_freeze BEFORE INSERT OR UPDATE OR DELETE ON boq_rate_buildup FOR EACH ROW EXECUTE FUNCTION guard_rate_buildup_after_handover();

-- Locked execution BOQ: contract baseline columns are immutable; only revised_* (variations) and
-- cost_code_id mapping may change. Locked rows cannot be deleted.
CREATE OR REPLACE FUNCTION guard_project_boq_locked() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_locked THEN RAISE EXCEPTION 'Locked execution BOQ item % cannot be deleted', OLD.id; END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_locked AND (
       NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.item_no IS DISTINCT FROM OLD.item_no OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.unit_of_measure IS DISTINCT FROM OLD.unit_of_measure
    OR NEW.contract_quantity IS DISTINCT FROM OLD.contract_quantity
    OR NEW.contract_unit_rate IS DISTINCT FROM OLD.contract_unit_rate
    OR NEW.boq_master_id IS DISTINCT FROM OLD.boq_master_id OR NEW.handover_id IS DISTINCT FROM OLD.handover_id
    OR NEW.is_locked IS DISTINCT FROM OLD.is_locked) THEN
    RAISE EXCEPTION 'Execution BOQ item % is locked; contract baseline changes only through approved variations', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_project_boq_locked ON project_boq;
CREATE TRIGGER trg_project_boq_locked BEFORE UPDATE OR DELETE ON project_boq FOR EACH ROW EXECUTE FUNCTION guard_project_boq_locked();

ALTER TABLE boq_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_handovers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON boq_handovers;
DROP POLICY IF EXISTS tenant_isolation_write ON boq_handovers;
CREATE POLICY tenant_isolation_select ON boq_handovers FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
CREATE POLICY tenant_isolation_write ON boq_handovers FOR ALL USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
