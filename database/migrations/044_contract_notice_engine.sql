-- NDC-001 (Wave 2): Contract Data Pack obligation rules + event register + notice/time-bar engine.
-- (transaction managed by migrator)
-- Principles (R10/R13; research board RB-02 P0-1/2/4; constitution):
--  * clause periods, addressees and conditions-precedent flags are entered from the signed contract by the
--    tenant (with a source reference) and confirmed by a second person; the system never defaults a period;
--  * a notice deadline is computed by the database from the confirmed rule and the "became aware" date and
--    is immutable once computed;
--  * issuing a notice is NOT subject to internal approval (internal DOA must never delay a contractual notice),
--    but requires delivery method and proof reference; late issue is recorded, never hidden;
--  * whether a late notice forfeits entitlement is a human legal judgement, not computed here.

CREATE TABLE IF NOT EXISTS contract_obligation_rules (
    id                      BIGSERIAL PRIMARY KEY,
    org_id                  BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    contract_id             BIGINT NOT NULL REFERENCES contracts(id),
    clause_ref              VARCHAR(60) NOT NULL,
    obligation_type         VARCHAR(30) NOT NULL CHECK (obligation_type IN ('notice_of_claim','notice_of_delay','early_warning','variation_notice','notice_of_dispute','response_due','particulars_due','other')),
    responsible_party       VARCHAR(20) NOT NULL CHECK (responsible_party IN ('contractor','employer','engineer','project_manager','subcontractor')),
    trigger_description     TEXT NOT NULL,
    period_value            INT NOT NULL CHECK (period_value > 0),
    period_unit             VARCHAR(15) NOT NULL CHECK (period_unit IN ('calendar_days','weeks','months')),
    addressee               VARCHAR(200) NOT NULL,
    delivery_requirements   TEXT,
    is_condition_precedent  BOOLEAN NOT NULL,
    source_reference        TEXT NOT NULL,
    status                  VARCHAR(15) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','retired')),
    created_by              BIGINT NOT NULL REFERENCES users(id),
    confirmed_by            BIGINT REFERENCES users(id),
    confirmed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status = 'draft' OR (confirmed_by IS NOT NULL AND confirmed_by <> created_by)),
    CHECK (length(trim(source_reference)) >= 3)
);
CREATE INDEX IF NOT EXISTS idx_obligation_rules_contract ON contract_obligation_rules(contract_id);

CREATE TABLE IF NOT EXISTS contract_events (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    contract_id         BIGINT NOT NULL REFERENCES contracts(id),
    title               VARCHAR(250) NOT NULL,
    description         TEXT NOT NULL,
    occurred_on         DATE NOT NULL,
    became_aware_on     DATE NOT NULL,
    source_type         VARCHAR(30) CHECK (source_type IN ('site_instruction','rfi','correspondence','site_diary','design_revision','meeting','other')),
    source_reference    TEXT,
    recorded_by         BIGINT NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (became_aware_on >= occurred_on)
);
CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events(contract_id);

CREATE TABLE IF NOT EXISTS contract_notices (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    contract_id         BIGINT NOT NULL REFERENCES contracts(id),
    event_id            BIGINT NOT NULL REFERENCES contract_events(id),
    rule_id             BIGINT NOT NULL REFERENCES contract_obligation_rules(id),
    deadline            DATE NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','issued','acknowledged','not_required')),
    issued_at           TIMESTAMPTZ,
    issued_by           BIGINT REFERENCES users(id),
    issued_late         BOOLEAN,
    delivery_method     VARCHAR(30) CHECK (delivery_method IN ('hand_delivery','courier','registered_mail','email','contract_portal','other')),
    delivery_reference  TEXT,
    acknowledged_at     TIMESTAMPTZ,
    acknowledgement_reference TEXT,
    not_required_reason TEXT,
    decided_by          BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, rule_id),
    CHECK (status <> 'issued' OR (issued_at IS NOT NULL AND issued_by IS NOT NULL AND delivery_method IS NOT NULL AND delivery_reference IS NOT NULL AND issued_late IS NOT NULL)),
    CHECK (status <> 'not_required' OR (not_required_reason IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_contract_notices_open ON contract_notices(org_id, status, deadline);

-- Deadline arithmetic in one place.
CREATE OR REPLACE FUNCTION compute_notice_deadline(p_aware date, p_value int, p_unit text) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_unit
    WHEN 'calendar_days' THEN p_aware + p_value
    WHEN 'weeks' THEN p_aware + 7 * p_value
    WHEN 'months' THEN (p_aware + make_interval(months => p_value))::date
  END
$$;

-- Rules: same-tenant contract; confirmed rules immutable except retirement.
CREATE OR REPLACE FUNCTION guard_obligation_rule() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Confirmed obligation rules cannot be deleted; retire them'; END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Contract not found in this organization';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'Obligation rules are created as drafts'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    IF NOT (OLD.status = 'confirmed' AND NEW.status = 'retired'
            AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at')) THEN
      RAISE EXCEPTION 'Confirmed obligation rule % is immutable (only retirement is allowed)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_obligation_rule_guard ON contract_obligation_rules;
CREATE TRIGGER trg_obligation_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_obligation_rules FOR EACH ROW EXECUTE FUNCTION guard_obligation_rule();

-- Events are evidence: append-only, same-tenant contract, awareness date not in the future.
CREATE OR REPLACE FUNCTION guard_contract_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Contract events are append-only; record a new event to correct'; END IF;
  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Contract not found in this organization';
  END IF;
  IF NEW.became_aware_on > current_date THEN RAISE EXCEPTION 'Awareness date cannot be in the future'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_event_guard ON contract_events;
CREATE TRIGGER trg_contract_event_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_events FOR EACH ROW EXECUTE FUNCTION guard_contract_event();

-- Notices: deadline computed by the database from a confirmed rule; lifecycle open -> issued -> acknowledged,
-- or open -> not_required (human decision with reason). Deadline and links immutable.
CREATE OR REPLACE FUNCTION guard_contract_notice() RETURNS trigger AS $$
DECLARE r contract_obligation_rules%ROWTYPE; e contract_events%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract notices cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO r FROM contract_obligation_rules WHERE id = NEW.rule_id;
    SELECT * INTO e FROM contract_events WHERE id = NEW.event_id;
    IF r.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed obligation rules generate notices'; END IF;
    IF r.contract_id <> e.contract_id OR NEW.contract_id <> e.contract_id OR r.org_id <> NEW.org_id OR e.org_id <> NEW.org_id THEN
      RAISE EXCEPTION 'Notice, event and rule must belong to the same contract and organization';
    END IF;
    NEW.deadline := compute_notice_deadline(e.became_aware_on, r.period_value, r.period_unit);
    NEW.status := 'open';
    RETURN NEW;
  END IF;
  IF (NEW.deadline, NEW.rule_id, NEW.event_id, NEW.contract_id, NEW.org_id) IS DISTINCT FROM (OLD.deadline, OLD.rule_id, OLD.event_id, OLD.contract_id, OLD.org_id) THEN
    RAISE EXCEPTION 'Notice deadline and links are immutable';
  END IF;
  IF NOT ((OLD.status = 'open' AND NEW.status IN ('issued','not_required')) OR (OLD.status = 'issued' AND NEW.status = 'acknowledged')) THEN
    RAISE EXCEPTION 'Invalid notice transition % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'issued' THEN NEW.issued_late := (NEW.issued_at::date > NEW.deadline); END IF;
  IF OLD.status = 'issued' AND (NEW.issued_at, NEW.issued_by, NEW.issued_late, NEW.delivery_method, NEW.delivery_reference)
       IS DISTINCT FROM (OLD.issued_at, OLD.issued_by, OLD.issued_late, OLD.delivery_method, OLD.delivery_reference) THEN
    RAISE EXCEPTION 'Issued notice details are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_notice_guard ON contract_notices;
CREATE TRIGGER trg_contract_notice_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_notices FOR EACH ROW EXECUTE FUNCTION guard_contract_notice();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['contract_obligation_rules','contract_events','contract_notices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
