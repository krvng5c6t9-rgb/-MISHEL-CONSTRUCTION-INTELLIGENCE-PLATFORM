-- Stage 15 (GC-20 steps 1-5): commissioning-to-handover - systems, staged test packs, punch categories, handover dossier,
-- taking-over with DLP register. Previously ABSENT except an unexecuted punch-list API (no category, anyone could close
-- any item with no record of who or why, nothing blocked handover).
-- (transaction managed by migrator)
--  * Systems are registered per project; test packs carry their acceptance criteria and a stage from the gate sequence
--    mechanical completion -> pre-commissioning -> energisation -> functional -> integrated -> performance. Which stages
--    apply to a system is the project's decision (the packs it registers); a stage can only be accepted after every
--    earlier-stage pack of the same system is accepted.
--  * Test runs are append-only. A passed run counts only once verified by someone other than the executor; packs that
--    require a client witness need the witness name and reference on the run.
--  * Punch items get a category (A blocks handover); closing records who, when and why; an A item is closed by someone
--    other than the person who raised it.
--  * Handover dossier: required documents per system, each satisfied only by an approved EDMS document of the project.
--  * Taking-over certificate per system: refused unless every test pack is accepted, no category-A item is open and the
--    dossier is complete. The DLP end date comes from the signed contract's defects liability period - never assumed.
--    Retention release and the final account are financial/contract decisions (DEC-009/DEC-012) and are not automated.
-- Rollback: DROP TABLE handover_certificates, handover_dossier_items, commissioning_test_runs, commissioning_test_packs,
--           commissioning_systems CASCADE; ALTER TABLE punch_lists DROP COLUMN category, system_id, closed_by, closure_note.

CREATE TABLE IF NOT EXISTS commissioning_systems (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  system_code VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, system_code)
);
CREATE TABLE IF NOT EXISTS commissioning_test_packs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  system_id BIGINT NOT NULL REFERENCES commissioning_systems(id),
  pack_no VARCHAR(40) NOT NULL,
  stage VARCHAR(25) NOT NULL CHECK (stage IN ('mechanical_completion','pre_commissioning','energisation','functional','integrated','performance')),
  stage_order SMALLINT GENERATED ALWAYS AS (CASE stage WHEN 'mechanical_completion' THEN 1 WHEN 'pre_commissioning' THEN 2 WHEN 'energisation' THEN 3
                                                    WHEN 'functional' THEN 4 WHEN 'integrated' THEN 5 ELSE 6 END) STORED,
  acceptance_criteria TEXT NOT NULL CHECK (length(trim(acceptance_criteria)) >= 10),
  witness_required BOOLEAN NOT NULL DEFAULT false,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (system_id, pack_no)
);
CREATE TABLE IF NOT EXISTS commissioning_test_runs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  test_pack_id BIGINT NOT NULL REFERENCES commissioning_test_packs(id),
  result VARCHAR(10) NOT NULL CHECK (result IN ('passed','failed')),
  executed_on DATE NOT NULL,
  executed_by BIGINT NOT NULL REFERENCES users(id),
  results_notes TEXT NOT NULL CHECK (length(trim(results_notes)) >= 5),
  witness_name VARCHAR(200),
  witness_reference VARCHAR(200),
  verified_by BIGINT REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (verified_by IS NULL OR (verified_by <> executed_by AND result = 'passed' AND verified_at IS NOT NULL))
);

ALTER TABLE punch_lists ADD COLUMN IF NOT EXISTS category CHAR(1) NOT NULL DEFAULT 'B' CHECK (category IN ('A','B','C'));
ALTER TABLE punch_lists ADD COLUMN IF NOT EXISTS system_id BIGINT REFERENCES commissioning_systems(id);
ALTER TABLE punch_lists ADD COLUMN IF NOT EXISTS closed_by BIGINT REFERENCES users(id);
ALTER TABLE punch_lists ADD COLUMN IF NOT EXISTS closure_note TEXT;

CREATE TABLE IF NOT EXISTS handover_dossier_items (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  system_id BIGINT NOT NULL REFERENCES commissioning_systems(id),
  requirement VARCHAR(200) NOT NULL,
  document_id BIGINT REFERENCES documents(id),
  linked_by BIGINT REFERENCES users(id),
  linked_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id),
  UNIQUE (system_id, requirement)
);
CREATE TABLE IF NOT EXISTS handover_certificates (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  system_id BIGINT NOT NULL UNIQUE REFERENCES commissioning_systems(id),
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  certificate_no VARCHAR(60) NOT NULL,
  taking_over_date DATE NOT NULL,
  dlp_end_date DATE NOT NULL,
  client_reference TEXT NOT NULL CHECK (length(trim(client_reference)) >= 3),
  recorded_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Readiness of one system, used by the guard and the status route (SECURITY INVOKER; RLS applies).
CREATE OR REPLACE FUNCTION commissioning_readiness(p_system bigint)
RETURNS TABLE (test_packs int, packs_accepted int, open_category_a int, open_category_b int, open_category_c int,
               dossier_required int, dossier_satisfied int, ready boolean)
LANGUAGE sql STABLE AS $$
  WITH packs AS (
    SELECT p.id, EXISTS (SELECT 1 FROM commissioning_test_runs r WHERE r.test_pack_id = p.id AND r.result = 'passed' AND r.verified_by IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM commissioning_test_runs f WHERE f.test_pack_id = p.id AND f.id > r.id AND f.result = 'failed')) AS accepted
    FROM commissioning_test_packs p WHERE p.system_id = p_system),
  punch AS (SELECT category, count(*)::int n FROM punch_lists WHERE system_id = p_system AND status <> 'closed' GROUP BY category),
  dossier AS (SELECT count(*)::int req, count(*) FILTER (WHERE document_id IS NOT NULL)::int sat FROM handover_dossier_items WHERE system_id = p_system)
  SELECT (SELECT count(*)::int FROM packs), (SELECT count(*) FILTER (WHERE accepted)::int FROM packs),
         coalesce((SELECT n FROM punch WHERE category = 'A'), 0), coalesce((SELECT n FROM punch WHERE category = 'B'), 0), coalesce((SELECT n FROM punch WHERE category = 'C'), 0),
         dossier.req, dossier.sat,
         (SELECT count(*) FROM packs) > 0 AND NOT EXISTS (SELECT 1 FROM packs WHERE NOT accepted)
           AND coalesce((SELECT n FROM punch WHERE category = 'A'), 0) = 0 AND dossier.req > 0 AND dossier.req = dossier.sat
  FROM dossier
$$;

CREATE OR REPLACE FUNCTION guard_commissioning_system() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Commissioning systems are not deleted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Project not found in this organization'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.project_id, NEW.system_code, NEW.org_id) IS DISTINCT FROM (OLD.project_id, OLD.system_code, OLD.org_id) THEN RAISE EXCEPTION 'System identity is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM handover_certificates WHERE system_id = OLD.id) THEN RAISE EXCEPTION 'System % is handed over', OLD.id; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_commissioning_system ON commissioning_systems;
CREATE TRIGGER trg_commissioning_system BEFORE INSERT OR UPDATE OR DELETE ON commissioning_systems FOR EACH ROW EXECUTE FUNCTION guard_commissioning_system();

CREATE OR REPLACE FUNCTION guard_commissioning_test_pack() RETURNS trigger AS $$
DECLARE s record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM commissioning_test_runs WHERE test_pack_id = OLD.id) THEN RAISE EXCEPTION 'A test pack with runs cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id INTO s FROM commissioning_systems WHERE id = NEW.system_id;
  IF s.id IS NULL OR s.org_id <> NEW.org_id THEN RAISE EXCEPTION 'System not found in this organization'; END IF;
  IF EXISTS (SELECT 1 FROM handover_certificates WHERE system_id = NEW.system_id) THEN RAISE EXCEPTION 'System % is handed over', NEW.system_id; END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM commissioning_test_runs WHERE test_pack_id = OLD.id) THEN RAISE EXCEPTION 'A test pack with runs is frozen'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_commissioning_test_pack ON commissioning_test_packs;
CREATE TRIGGER trg_commissioning_test_pack BEFORE INSERT OR UPDATE OR DELETE ON commissioning_test_packs FOR EACH ROW EXECUTE FUNCTION guard_commissioning_test_pack();

CREATE OR REPLACE FUNCTION guard_commissioning_test_run() RETURNS trigger AS $$
DECLARE p record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Test runs are append-only'; END IF;
  SELECT tp.*, s.org_id AS s_org INTO p FROM commissioning_test_packs tp JOIN commissioning_systems s ON s.id = tp.system_id WHERE tp.id = NEW.test_pack_id;
  IF p.id IS NULL OR p.s_org <> NEW.org_id THEN RAISE EXCEPTION 'Test pack not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM handover_certificates WHERE system_id = p.system_id) THEN RAISE EXCEPTION 'System % is handed over', p.system_id; END IF;
    IF NEW.executed_on > current_date THEN RAISE EXCEPTION 'A test run cannot be dated in the future'; END IF;
    IF NEW.verified_by IS NOT NULL THEN RAISE EXCEPTION 'A run is verified after it is recorded, by someone else'; END IF;
    IF p.witness_required AND (length(trim(coalesce(NEW.witness_name,''))) < 2 OR length(trim(coalesce(NEW.witness_reference,''))) < 3) THEN
      RAISE EXCEPTION 'Test pack % requires a client witness: record the witness name and reference', p.pack_no;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the verification of a passed run may be added, once, and only in stage order.
  IF (NEW.test_pack_id, NEW.result, NEW.executed_on, NEW.executed_by, NEW.results_notes, NEW.witness_name, NEW.witness_reference, NEW.org_id, NEW.created_at)
     IS DISTINCT FROM (OLD.test_pack_id, OLD.result, OLD.executed_on, OLD.executed_by, OLD.results_notes, OLD.witness_name, OLD.witness_reference, OLD.org_id, OLD.created_at)
     OR OLD.verified_by IS NOT NULL OR NEW.verified_by IS NULL THEN
    RAISE EXCEPTION 'Test runs are append-only; only a passed run may be verified once';
  END IF;
  IF EXISTS (SELECT 1 FROM commissioning_test_runs f WHERE f.test_pack_id = NEW.test_pack_id AND f.id > NEW.id) THEN
    RAISE EXCEPTION 'A later run exists for this pack; verify the latest run';
  END IF;
  IF EXISTS (SELECT 1 FROM commissioning_test_packs e WHERE e.system_id = p.system_id AND e.stage_order < p.stage_order
             AND NOT EXISTS (SELECT 1 FROM commissioning_test_runs r WHERE r.test_pack_id = e.id AND r.result = 'passed' AND r.verified_by IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM commissioning_test_runs f WHERE f.test_pack_id = e.id AND f.id > r.id AND f.result = 'failed'))) THEN
    RAISE EXCEPTION 'Stage % cannot be accepted before every earlier-stage pack of the system is accepted', p.stage;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_commissioning_test_run ON commissioning_test_runs;
CREATE TRIGGER trg_commissioning_test_run BEFORE INSERT OR UPDATE OR DELETE ON commissioning_test_runs FOR EACH ROW EXECUTE FUNCTION guard_commissioning_test_run();

CREATE OR REPLACE FUNCTION guard_punch_item() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Punch items are closed, never deleted'; END IF;
  IF NEW.system_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM commissioning_systems s WHERE s.id = NEW.system_id AND s.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Punch item system must belong to the same project';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'closed' THEN RAISE EXCEPTION 'Punch item % is closed', OLD.id; END IF;
    IF (NEW.project_id, NEW.description, NEW.raised_by, NEW.category, NEW.org_id) IS DISTINCT FROM (OLD.project_id, OLD.description, OLD.raised_by, OLD.category, OLD.org_id) THEN
      RAISE EXCEPTION 'Punch item content and category are immutable';
    END IF;
    IF NEW.status = 'closed' THEN
      IF NEW.closed_by IS NULL OR length(trim(coalesce(NEW.closure_note,''))) < 5 THEN RAISE EXCEPTION 'Closing a punch item records who closed it and how it was resolved'; END IF;
      IF NEW.category = 'A' AND NEW.closed_by = NEW.raised_by THEN RAISE EXCEPTION 'A category-A item is closed by someone other than the person who raised it'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_punch_item_guard ON punch_lists;
CREATE TRIGGER trg_punch_item_guard BEFORE INSERT OR UPDATE OR DELETE ON punch_lists FOR EACH ROW EXECUTE FUNCTION guard_punch_item();

CREATE OR REPLACE FUNCTION guard_dossier_item() RETURNS trigger AS $$
DECLARE s record; d record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.document_id IS NOT NULL THEN RAISE EXCEPTION 'A satisfied dossier requirement cannot be removed'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, project_id INTO s FROM commissioning_systems WHERE id = NEW.system_id;
  IF s.id IS NULL OR s.org_id <> NEW.org_id THEN RAISE EXCEPTION 'System not found in this organization'; END IF;
  IF EXISTS (SELECT 1 FROM handover_certificates WHERE system_id = NEW.system_id) THEN RAISE EXCEPTION 'System % is handed over; its dossier is frozen', NEW.system_id; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.system_id, NEW.requirement, NEW.created_by) IS DISTINCT FROM (OLD.system_id, OLD.requirement, OLD.created_by) THEN RAISE EXCEPTION 'Dossier requirement is immutable'; END IF;
    IF OLD.document_id IS NOT NULL AND NEW.document_id IS DISTINCT FROM OLD.document_id THEN RAISE EXCEPTION 'A satisfied requirement keeps its document'; END IF;
  END IF;
  IF NEW.document_id IS NOT NULL THEN
    SELECT id, project_id, status INTO d FROM documents WHERE id = NEW.document_id AND org_id = NEW.org_id;
    IF d.id IS NULL OR d.project_id IS DISTINCT FROM s.project_id OR d.status <> 'approved' THEN
      RAISE EXCEPTION 'A dossier requirement is satisfied only by an approved document of the same project';
    END IF;
    IF NEW.linked_by IS NULL OR NEW.linked_at IS NULL THEN RAISE EXCEPTION 'Linking a document records who and when'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dossier_item ON handover_dossier_items;
CREATE TRIGGER trg_dossier_item BEFORE INSERT OR UPDATE OR DELETE ON handover_dossier_items FOR EACH ROW EXECUTE FUNCTION guard_dossier_item();

CREATE OR REPLACE FUNCTION guard_handover_certificate() RETURNS trigger AS $$
DECLARE s record; c record; r record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Taking-over certificates are immutable records'; END IF;
  SELECT id, org_id, project_id INTO s FROM commissioning_systems WHERE id = NEW.system_id FOR UPDATE;
  IF s.id IS NULL OR s.org_id <> NEW.org_id THEN RAISE EXCEPTION 'System not found in this organization'; END IF;
  SELECT id, project_id, contract_status, defects_liability_months INTO c FROM contracts WHERE id = NEW.contract_id AND org_id = NEW.org_id;
  IF c.id IS NULL OR c.project_id <> s.project_id OR c.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'Taking-over needs the signed contract of the project'; END IF;
  IF c.defects_liability_months IS NULL THEN RAISE EXCEPTION 'The contract has no defects liability period recorded; record it before taking-over'; END IF;
  IF NEW.taking_over_date > current_date THEN RAISE EXCEPTION 'Taking-over cannot be dated in the future'; END IF;
  SELECT * INTO r FROM commissioning_readiness(NEW.system_id);
  IF NOT r.ready THEN
    RAISE EXCEPTION 'System not ready for taking-over: test packs accepted %/%, open category-A items %, dossier %/%',
      r.packs_accepted, r.test_packs, r.open_category_a, r.dossier_satisfied, r.dossier_required;
  END IF;
  NEW.dlp_end_date := (NEW.taking_over_date + make_interval(months => c.defects_liability_months))::date;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_handover_certificate ON handover_certificates;
CREATE TRIGGER trg_handover_certificate BEFORE INSERT OR UPDATE OR DELETE ON handover_certificates FOR EACH ROW EXECUTE FUNCTION guard_handover_certificate();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commissioning_systems','commissioning_test_packs','commissioning_test_runs','handover_dossier_items','handover_certificates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
