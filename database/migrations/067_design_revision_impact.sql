-- Stage 16 (GC-04 steps 1-3): design-revision impact. Previously ABSENT: no link between drawings and the objects built
-- from them (DFS-006), so a new revision changed nothing downstream and nobody was told what it touched.
-- (transaction managed by migrator)
--  * design_links: a drawing NUMBER (all its revisions) is linked to the BOQ items, schedule activities, PO lines and
--    inspections that rely on it, recording the revision each object was based on. Same project only.
--  * When a new revision becomes the current approved one (the earlier approved revision is superseded), the database
--    opens a design_revision_impact listing every linked object (with a readable label snapshot). Links based on an
--    older revision show as stale everywhere they are read.
--  * Each impacted object gets a human disposition: no_change or change_required, with a reason; dispositioning
--    re-bases the link on the new revision. The impact closes only when every object is dispositioned, and - if any
--    change is required - either a contract event is linked (the notice/time-bar engine of NDC-001 then applies) or a
--    reason why there is no entitlement is stated. The platform never decides entitlement.
-- Rollback: DROP TABLE design_impact_items, design_revision_impacts, design_links CASCADE;
--           DROP TRIGGER trg_drawing_revision_impact ON drawings.

CREATE TABLE IF NOT EXISTS design_links (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  drawing_no VARCHAR(100) NOT NULL,
  object_type VARCHAR(20) NOT NULL CHECK (object_type IN ('boq_item','activity','po_line','inspection')),
  object_id BIGINT NOT NULL,
  based_on_drawing_id BIGINT NOT NULL REFERENCES drawings(id),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, drawing_no, object_type, object_id)
);
CREATE TABLE IF NOT EXISTS design_revision_impacts (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  drawing_no VARCHAR(100) NOT NULL,
  new_drawing_id BIGINT NOT NULL UNIQUE REFERENCES drawings(id),
  superseded_drawing_id BIGINT NOT NULL REFERENCES drawings(id),
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  contract_event_id BIGINT REFERENCES contract_events(id),
  no_entitlement_reason TEXT,
  closed_by BIGINT REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS design_impact_items (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  impact_id BIGINT NOT NULL REFERENCES design_revision_impacts(id),
  link_id BIGINT NOT NULL REFERENCES design_links(id),
  object_type VARCHAR(20) NOT NULL,
  object_id BIGINT NOT NULL,
  object_label TEXT NOT NULL,
  based_on_revision VARCHAR(20),
  disposition VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (disposition IN ('pending','no_change','change_required')),
  reason TEXT,
  assessed_by BIGINT REFERENCES users(id),
  assessed_at TIMESTAMPTZ,
  UNIQUE (impact_id, link_id),
  CHECK (disposition = 'pending' OR (length(trim(coalesce(reason,''))) >= 5 AND assessed_by IS NOT NULL AND assessed_at IS NOT NULL))
);

-- Readable label of a linked object (same project), NULL when it does not exist there.
CREATE OR REPLACE FUNCTION design_object_label(p_type text, p_id bigint, p_project bigint) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE p_type
    WHEN 'boq_item' THEN (SELECT 'BOQ ' || item_no || ' ' || left(description, 80) FROM project_boq WHERE id = p_id AND project_id = p_project)
    WHEN 'activity' THEN (SELECT 'Activity ' || coalesce(activity_id_ext, id::text) || ' ' || left(activity_name, 80) FROM schedule_activities WHERE id = p_id AND project_id = p_project)
    WHEN 'po_line' THEN (SELECT 'PO ' || po.po_ref || ' line ' || pl.id || ' ' || left(pl.item_description, 60) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id WHERE pl.id = p_id AND po.project_id = p_project)
    WHEN 'inspection' THEN (SELECT 'Inspection ' || id || ' ' || coalesce(checklist_type, '') || ' ' || coalesce(activity_ref::text, '') FROM inspection_checklists WHERE id = p_id AND project_id = p_project)
  END
$$;

CREATE OR REPLACE FUNCTION guard_design_link() RETURNS trigger AS $$
DECLARE d record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM design_impact_items WHERE link_id = OLD.id) THEN RAISE EXCEPTION 'A link with impact history cannot be removed'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, project_id, drawing_no INTO d FROM drawings WHERE id = NEW.based_on_drawing_id;
  IF d.id IS NULL OR d.org_id <> NEW.org_id OR d.project_id <> NEW.project_id OR d.drawing_no <> NEW.drawing_no THEN
    RAISE EXCEPTION 'The link must be based on a revision of drawing % in the same project', NEW.drawing_no;
  END IF;
  IF design_object_label(NEW.object_type, NEW.object_id, NEW.project_id) IS NULL THEN
    RAISE EXCEPTION '% % not found in this project', NEW.object_type, NEW.object_id;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.project_id, NEW.drawing_no, NEW.object_type, NEW.object_id, NEW.org_id) IS DISTINCT FROM (OLD.project_id, OLD.drawing_no, OLD.object_type, OLD.object_id, OLD.org_id) THEN
    RAISE EXCEPTION 'A design link only moves to a newer revision of the same drawing';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_design_link ON design_links;
CREATE TRIGGER trg_design_link BEFORE INSERT OR UPDATE OR DELETE ON design_links FOR EACH ROW EXECUTE FUNCTION guard_design_link();

-- Opens the impact when a new revision becomes the current approved one. Runs after trg_drawing_decision (name order)
-- which supersedes the previous approved revision.
CREATE OR REPLACE FUNCTION open_design_revision_impact() RETURNS trigger AS $$
DECLARE prev bigint; imp bigint;
BEGIN
  IF NEW.status IN ('approved','approved_with_comments') AND OLD.status = 'for_review' THEN
    SELECT id INTO prev FROM drawings WHERE project_id = NEW.project_id AND drawing_no = NEW.drawing_no AND id <> NEW.id AND status = 'superseded'
     ORDER BY reviewed_at DESC NULLS LAST, id DESC LIMIT 1;
    IF prev IS NOT NULL THEN
      INSERT INTO design_revision_impacts(org_id, project_id, drawing_no, new_drawing_id, superseded_drawing_id)
      VALUES (NEW.org_id, NEW.project_id, NEW.drawing_no, NEW.id, prev) RETURNING id INTO imp;
      INSERT INTO design_impact_items(org_id, impact_id, link_id, object_type, object_id, object_label, based_on_revision)
      SELECT l.org_id, imp, l.id, l.object_type, l.object_id, coalesce(design_object_label(l.object_type, l.object_id, l.project_id), '(object no longer found)'), d.revision
        FROM design_links l JOIN drawings d ON d.id = l.based_on_drawing_id
       WHERE l.project_id = NEW.project_id AND l.drawing_no = NEW.drawing_no;
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_drawing_revision_impact ON drawings;
CREATE TRIGGER trg_drawing_revision_impact AFTER UPDATE OF status ON drawings FOR EACH ROW EXECUTE FUNCTION open_design_revision_impact();

CREATE OR REPLACE FUNCTION guard_design_impact_item() RETURNS trigger AS $$
DECLARE i record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Impact items are never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  SELECT status, new_drawing_id INTO i FROM design_revision_impacts WHERE id = OLD.impact_id;
  IF i.status = 'closed' THEN RAISE EXCEPTION 'Impact % is closed', OLD.impact_id; END IF;
  IF OLD.disposition <> 'pending' THEN RAISE EXCEPTION 'Impact item % is already dispositioned', OLD.id; END IF;
  IF (NEW.impact_id, NEW.link_id, NEW.object_type, NEW.object_id, NEW.object_label, NEW.based_on_revision, NEW.org_id)
     IS DISTINCT FROM (OLD.impact_id, OLD.link_id, OLD.object_type, OLD.object_id, OLD.object_label, OLD.based_on_revision, OLD.org_id) THEN
    RAISE EXCEPTION 'Impact item content is immutable';
  END IF;
  -- Re-base the link on the new revision once the object has been assessed against it.
  IF NEW.disposition <> 'pending' THEN
    UPDATE design_links SET based_on_drawing_id = i.new_drawing_id WHERE id = NEW.link_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_design_impact_item ON design_impact_items;
CREATE TRIGGER trg_design_impact_item BEFORE INSERT OR UPDATE OR DELETE ON design_impact_items FOR EACH ROW EXECUTE FUNCTION guard_design_impact_item();

CREATE OR REPLACE FUNCTION guard_design_impact() RETURNS trigger AS $$
DECLARE e record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Design revision impacts are never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'An impact starts open'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN RAISE EXCEPTION 'Impact % is closed', OLD.id; END IF;
  IF (NEW.project_id, NEW.drawing_no, NEW.new_drawing_id, NEW.superseded_drawing_id, NEW.org_id, NEW.created_at)
     IS DISTINCT FROM (OLD.project_id, OLD.drawing_no, OLD.new_drawing_id, OLD.superseded_drawing_id, OLD.org_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Impact identity is immutable';
  END IF;
  IF NEW.contract_event_id IS NOT NULL THEN
    SELECT ce.id, c.project_id INTO e FROM contract_events ce JOIN contracts c ON c.id = ce.contract_id WHERE ce.id = NEW.contract_event_id AND c.org_id = NEW.org_id;
    IF e.id IS NULL OR e.project_id <> NEW.project_id THEN RAISE EXCEPTION 'The contract event must belong to a contract of the same project'; END IF;
  END IF;
  IF NEW.status = 'closed' THEN
    IF EXISTS (SELECT 1 FROM design_impact_items WHERE impact_id = NEW.id AND disposition = 'pending') THEN
      RAISE EXCEPTION 'Every impacted object must be dispositioned before closing';
    END IF;
    IF EXISTS (SELECT 1 FROM design_impact_items WHERE impact_id = NEW.id AND disposition = 'change_required')
       AND NEW.contract_event_id IS NULL AND length(trim(coalesce(NEW.no_entitlement_reason,''))) < 10 THEN
      RAISE EXCEPTION 'Changes are required: link the contract event raised for them, or state why there is no entitlement';
    END IF;
    IF NEW.closed_by IS NULL OR NEW.closed_at IS NULL THEN RAISE EXCEPTION 'Closing records who and when'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_design_impact ON design_revision_impacts;
CREATE TRIGGER trg_design_impact BEFORE INSERT OR UPDATE OR DELETE ON design_revision_impacts FOR EACH ROW EXECUTE FUNCTION guard_design_impact();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['design_links','design_revision_impacts','design_impact_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
