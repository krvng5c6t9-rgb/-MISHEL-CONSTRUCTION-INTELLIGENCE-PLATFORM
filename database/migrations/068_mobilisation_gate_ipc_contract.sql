-- Stage 17: (1) defect - client IPCs were accepted on unsigned contracts; (2) GC-02 step 9 mobilisation readiness gate.
-- (transaction managed by migrator)
-- (1) E1 `SW-IPC_unsigned_contract_BEFORE_fix_di3.txt`: the chain's IPC was created, client-approved and posted to
--     AR/GL (2 GL rows) against a contract still in DRAFT. An interim payment certificate bills the client under the
--     contract, so the contract must be signed or active and belong to the same project and organization.
-- (2) Mobilisation readiness gate (previously ABSENT): a gate per project lists readiness items (permits, insurances,
--     bonds, key staff, other) chosen by the project - the platform does not invent a mandatory list. Each item is
--     closed with evidence (an approved EDMS document of the project, or a written note) or, if mandatory and not
--     closable, risk-accepted against an open entry of the risk register with a reason. The gate is submitted by its
--     preparer and decided go / no-go by someone else; GO requires every mandatory item closed or risk-accepted;
--     no-go needs a reason. One live gate per project (a no-go gate can be followed by a new one).
-- Rollback: DROP TABLE mobilisation_gate_items, mobilisation_gates; DROP TRIGGER trg_ipc_contract_signed ON ipcs.

CREATE OR REPLACE FUNCTION guard_ipc_contract_signed() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contract_id IS NOT DISTINCT FROM OLD.contract_id AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NEW; END IF;
  SELECT id, org_id, project_id, contract_status INTO c FROM contracts WHERE id = NEW.contract_id;
  IF c.id IS NULL OR c.org_id <> NEW.org_id OR c.project_id <> NEW.project_id THEN RAISE EXCEPTION 'IPC contract must be a contract of the same project'; END IF;
  IF c.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'An IPC is issued only under a signed or active contract (contract % is %)', c.id, c.contract_status; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ipc_contract_signed ON ipcs;
CREATE TRIGGER trg_ipc_contract_signed BEFORE INSERT OR UPDATE OF contract_id, project_id ON ipcs FOR EACH ROW EXECUTE FUNCTION guard_ipc_contract_signed();

CREATE TABLE IF NOT EXISTS mobilisation_gates (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','go','no_go')),
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  decided_by BIGINT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('go','no_go') OR (decided_by IS NOT NULL AND decided_by <> prepared_by AND decided_at IS NOT NULL)),
  CHECK (status <> 'no_go' OR length(trim(coalesce(decision_note,''))) >= 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mobilisation_gate_live ON mobilisation_gates(project_id) WHERE status <> 'no_go';

CREATE TABLE IF NOT EXISTS mobilisation_gate_items (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  gate_id BIGINT NOT NULL REFERENCES mobilisation_gates(id),
  category VARCHAR(12) NOT NULL CHECK (category IN ('permit','insurance','bond','staff','other')),
  item TEXT NOT NULL CHECK (length(trim(item)) >= 3),
  mandatory BOOLEAN NOT NULL,
  status VARCHAR(14) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','risk_accepted')),
  evidence_document_id BIGINT REFERENCES documents(id),
  note TEXT,
  risk_id BIGINT REFERENCES risks(id),
  resolved_by BIGINT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id),
  UNIQUE (gate_id, item),
  CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK (status <> 'closed' OR evidence_document_id IS NOT NULL OR length(trim(coalesce(note,''))) >= 5),
  CHECK (status <> 'risk_accepted' OR (risk_id IS NOT NULL AND length(trim(coalesce(note,''))) >= 10))
);

CREATE OR REPLACE FUNCTION guard_mobilisation_gate() RETURNS trigger AS $$
DECLARE open_mandatory int;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Mobilisation gates are never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Project not found in this organization'; END IF;
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A gate starts as draft'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.project_id, NEW.prepared_by, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.project_id, OLD.prepared_by, OLD.created_at) THEN RAISE EXCEPTION 'Gate identity is immutable'; END IF;
  IF OLD.status IN ('go','no_go') THEN RAISE EXCEPTION 'Gate % is decided and immutable', OLD.id; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
    IF NOT EXISTS (SELECT 1 FROM mobilisation_gate_items WHERE gate_id = NEW.id) THEN RAISE EXCEPTION 'A gate needs at least one readiness item'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'submitted' AND NEW.status IN ('go','no_go') THEN
    SELECT count(*) INTO open_mandatory FROM mobilisation_gate_items WHERE gate_id = NEW.id AND mandatory AND status = 'open';
    IF NEW.status = 'go' AND open_mandatory > 0 THEN
      RAISE EXCEPTION 'GO refused: % mandatory item(s) neither closed nor risk-accepted', open_mandatory;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Invalid gate transition % -> %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_mobilisation_gate ON mobilisation_gates;
CREATE TRIGGER trg_mobilisation_gate BEFORE INSERT OR UPDATE OR DELETE ON mobilisation_gates FOR EACH ROW EXECUTE FUNCTION guard_mobilisation_gate();

CREATE OR REPLACE FUNCTION guard_mobilisation_item() RETURNS trigger AS $$
DECLARE g record; d record; r record;
BEGIN
  SELECT id, org_id, project_id, status INTO g FROM mobilisation_gates WHERE id = coalesce(NEW.gate_id, OLD.gate_id);
  IF TG_OP = 'DELETE' THEN
    IF g.status <> 'draft' OR OLD.status <> 'open' THEN RAISE EXCEPTION 'Only open items of a draft gate can be removed'; END IF;
    RETURN OLD;
  END IF;
  IF g.id IS NULL OR g.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Gate not found in this organization'; END IF;
  IF g.status IN ('go','no_go') THEN RAISE EXCEPTION 'Gate % is decided; its items are frozen', g.id; END IF;
  IF TG_OP = 'INSERT' THEN
    IF g.status <> 'draft' THEN RAISE EXCEPTION 'Items are added while the gate is draft'; END IF;
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'An item starts open'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.gate_id, NEW.category, NEW.item, NEW.mandatory, NEW.created_by, NEW.org_id) IS DISTINCT FROM (OLD.gate_id, OLD.category, OLD.item, OLD.mandatory, OLD.created_by, OLD.org_id) THEN
    RAISE EXCEPTION 'Readiness item definition is immutable';
  END IF;
  IF OLD.status <> 'open' THEN RAISE EXCEPTION 'Item % is already resolved', OLD.id; END IF;
  IF NEW.evidence_document_id IS NOT NULL THEN
    SELECT id, project_id, status INTO d FROM documents WHERE id = NEW.evidence_document_id AND org_id = NEW.org_id;
    IF d.id IS NULL OR d.project_id IS DISTINCT FROM g.project_id OR d.status <> 'approved' THEN RAISE EXCEPTION 'Evidence must be an approved document of the same project'; END IF;
  END IF;
  IF NEW.status = 'risk_accepted' THEN
    IF NOT NEW.mandatory THEN RAISE EXCEPTION 'Only mandatory items are risk-accepted; close optional items with a note'; END IF;
    SELECT id, project_id, status, kind INTO r FROM risks WHERE id = NEW.risk_id AND org_id = NEW.org_id;
    IF r.id IS NULL OR r.project_id IS DISTINCT FROM g.project_id OR r.status = 'closed' OR r.kind <> 'threat' THEN
      RAISE EXCEPTION 'Risk acceptance must reference an open threat in this project''s risk register';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_mobilisation_item ON mobilisation_gate_items;
CREATE TRIGGER trg_mobilisation_item BEFORE INSERT OR UPDATE OR DELETE ON mobilisation_gate_items FOR EACH ROW EXECUTE FUNCTION guard_mobilisation_item();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mobilisation_gates','mobilisation_gate_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
