-- Wave 2: NDC-014 structured daily record + NDC-002 separated notice / RFI / change / claim paths.
-- (transaction managed by migrator)
-- NDC-014: a site diary is draft until signed by someone other than its preparer; signing requires the core
--   fields; once signed the diary and its manpower/equipment rows are immutable (corrections are appended as
--   amendments). The existing POST /site/diaries upsert silently overwrote a day's diary - now blocked once signed.
-- NDC-002: change events are the hub; RFIs, site instructions, variations, claims and early warnings are linked
--   to events but none closes or converts another automatically. An early-warning register is added
--   (NEC clause 15 style, usable as best practice under any form).

ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS work_fronts TEXT;
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS constraints_noted TEXT;
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS instructions_received TEXT;
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS parties_present TEXT;
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS impact_flag BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS impact_description TEXT;
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed'));
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS signed_by BIGINT REFERENCES users(id);
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
ALTER TABLE site_diary ADD COLUMN IF NOT EXISTS impact_event_id BIGINT REFERENCES contract_events(id);
ALTER TABLE site_diary DROP CONSTRAINT IF EXISTS site_diary_impact_requires_description;
ALTER TABLE site_diary ADD CONSTRAINT site_diary_impact_requires_description CHECK (NOT impact_flag OR length(trim(coalesce(impact_description,''))) >= 5);

CREATE TABLE IF NOT EXISTS site_diary_amendments (
    id          BIGSERIAL PRIMARY KEY,
    org_id      BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    diary_id    BIGINT NOT NULL REFERENCES site_diary(id),
    note        TEXT NOT NULL CHECK (length(trim(note)) >= 5),
    author_id   BIGINT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION guard_site_diary() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN RAISE EXCEPTION 'Signed site diaries cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Site diaries are created as drafts'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'signed' THEN
    -- Only the impact-event link may be set after signing (by the impact workflow), nothing else.
    IF (to_jsonb(NEW) - 'impact_event_id' - 'updated_at') <> (to_jsonb(OLD) - 'impact_event_id' - 'updated_at')
       OR (OLD.impact_event_id IS NOT NULL AND NEW.impact_event_id IS DISTINCT FROM OLD.impact_event_id) THEN
      RAISE EXCEPTION 'Signed site diary % is immutable; record an amendment instead', OLD.id;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'signed' THEN
    IF NEW.signed_by IS NULL OR NEW.signed_by = NEW.prepared_by THEN
      RAISE EXCEPTION 'A site diary must be signed by someone other than its preparer';
    END IF;
    IF coalesce(trim(NEW.weather),'') = '' OR coalesce(trim(NEW.work_performed),'') = '' THEN
      RAISE EXCEPTION 'Weather and work performed are required before signing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM diary_manpower WHERE diary_id = NEW.id) THEN
      RAISE EXCEPTION 'At least one manpower entry is required before signing';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_site_diary_guard ON site_diary;
CREATE TRIGGER trg_site_diary_guard BEFORE INSERT OR UPDATE OR DELETE ON site_diary FOR EACH ROW EXECUTE FUNCTION guard_site_diary();

CREATE OR REPLACE FUNCTION guard_site_diary_children() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM site_diary WHERE id = COALESCE(NEW.diary_id, OLD.diary_id);
  IF st = 'signed' THEN RAISE EXCEPTION 'Entries of a signed site diary are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['diary_manpower','diary_equipment'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_site_diary_children ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_site_diary_children BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_site_diary_children()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_mutation_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_diary_amendments_append_only ON site_diary_amendments;
CREATE TRIGGER trg_diary_amendments_append_only BEFORE UPDATE OR DELETE ON site_diary_amendments FOR EACH ROW EXECUTE FUNCTION prevent_mutation_append_only();

-- NDC-002: links between a change event and the records that arise from it.
CREATE TABLE IF NOT EXISTS early_warnings (
    id                      BIGSERIAL PRIMARY KEY,
    org_id                  BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    contract_id             BIGINT NOT NULL REFERENCES contracts(id),
    ew_no                   VARCHAR(30) NOT NULL,
    raised_by_party         VARCHAR(20) NOT NULL CHECK (raised_by_party IN ('contractor','employer','project_manager','engineer','subcontractor')),
    raised_on               DATE NOT NULL,
    matter                  TEXT NOT NULL,
    may_increase_price      BOOLEAN NOT NULL,
    may_delay_completion    BOOLEAN NOT NULL,
    may_impair_performance  BOOLEAN NOT NULL,
    risk_reduction_meeting_on DATE,
    actions_agreed          TEXT,
    status                  VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closure_note            TEXT,
    closed_by               BIGINT REFERENCES users(id),
    closed_at               TIMESTAMPTZ,
    created_by              BIGINT NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, ew_no),
    CHECK (status = 'open' OR (closure_note IS NOT NULL AND closed_by IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS contract_event_links (
    id          BIGSERIAL PRIMARY KEY,
    org_id      BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    event_id    BIGINT NOT NULL REFERENCES contract_events(id),
    link_type   VARCHAR(20) NOT NULL CHECK (link_type IN ('rfi','site_instruction','variation','claim','early_warning','site_diary')),
    linked_id   BIGINT NOT NULL,
    created_by  BIGINT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, link_type, linked_id)
);

CREATE OR REPLACE FUNCTION guard_contract_event_link() RETURNS trigger AS $$
DECLARE ev contract_events%ROWTYPE; ok boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Event links are append-only'; END IF;
  SELECT * INTO ev FROM contract_events WHERE id = NEW.event_id;
  IF NOT FOUND OR ev.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Event not found in this organization'; END IF;
  ok := CASE NEW.link_type
    WHEN 'rfi' THEN EXISTS (SELECT 1 FROM rfis r JOIN contracts c ON c.project_id = r.project_id WHERE r.id = NEW.linked_id AND c.id = ev.contract_id AND r.org_id = NEW.org_id)
    WHEN 'site_instruction' THEN EXISTS (SELECT 1 FROM site_instructions s JOIN contracts c ON c.project_id = s.project_id WHERE s.id = NEW.linked_id AND c.id = ev.contract_id AND s.org_id = NEW.org_id)
    WHEN 'variation' THEN EXISTS (SELECT 1 FROM variations v WHERE v.id = NEW.linked_id AND v.contract_id = ev.contract_id AND v.org_id = NEW.org_id)
    WHEN 'claim' THEN EXISTS (SELECT 1 FROM contract_claims k WHERE k.id = NEW.linked_id AND k.contract_id = ev.contract_id AND k.org_id = NEW.org_id)
    WHEN 'early_warning' THEN EXISTS (SELECT 1 FROM early_warnings w WHERE w.id = NEW.linked_id AND w.contract_id = ev.contract_id AND w.org_id = NEW.org_id)
    WHEN 'site_diary' THEN EXISTS (SELECT 1 FROM site_diary d JOIN contracts c ON c.project_id = d.project_id WHERE d.id = NEW.linked_id AND c.id = ev.contract_id AND d.org_id = NEW.org_id)
  END;
  IF NOT ok THEN RAISE EXCEPTION 'Linked % % not found on the same contract/project in this organization', NEW.link_type, NEW.linked_id; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_event_link_guard ON contract_event_links;
CREATE TRIGGER trg_contract_event_link_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_event_links FOR EACH ROW EXECUTE FUNCTION guard_contract_event_link();

CREATE OR REPLACE FUNCTION guard_early_warning() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Early warnings cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.org_id = NEW.org_id) THEN RAISE EXCEPTION 'Contract not found in this organization'; END IF;
    IF NEW.raised_on > current_date THEN RAISE EXCEPTION 'Early warning date cannot be in the future'; END IF;
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'Early warnings are created open'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN RAISE EXCEPTION 'Closed early warning % is immutable', OLD.id; END IF;
  IF (NEW.contract_id, NEW.ew_no, NEW.raised_by_party, NEW.raised_on, NEW.matter, NEW.org_id, NEW.created_by)
     IS DISTINCT FROM (OLD.contract_id, OLD.ew_no, OLD.raised_by_party, OLD.raised_on, OLD.matter, OLD.org_id, OLD.created_by) THEN
    RAISE EXCEPTION 'The original early warning is immutable; record meeting outcomes and actions instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_early_warning_guard ON early_warnings;
CREATE TRIGGER trg_early_warning_guard BEFORE INSERT OR UPDATE OR DELETE ON early_warnings FOR EACH ROW EXECUTE FUNCTION guard_early_warning();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['site_diary_amendments','early_warnings','contract_event_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
