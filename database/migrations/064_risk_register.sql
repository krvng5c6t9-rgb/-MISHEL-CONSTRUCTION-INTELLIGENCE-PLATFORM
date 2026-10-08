-- Stage 12 (GC-26 steps 1-3, GC-01 step 8): risk & opportunity register - previously ABSENT (no table, no route; R13).
-- (transaction managed by migrator)
--  * A risk belongs to a tender (pre-award assessment) and/or a project; a tender risk can be carried to the project
--    once (project set from NULL only).
--  * Qualitative assessment on a 1-5 probability x 1-5 impact scale (score = product, ranking only - the platform does
--    not classify low/medium/high: rating bands and escalation thresholds are the company's risk policy).
--    Optional quantitative view: probability % x cost impact = expected value (information for contingency, not a
--    posting); time impact in days.
--  * Every change of an assessment is appended to risk_assessments by the database (history cannot be skipped).
--  * Responses are strategy-checked against the kind (threat: avoid/mitigate/transfer/accept; opportunity:
--    exploit/enhance/share/accept), owned and dated.
--  * Escalation is a human act with a named recipient and reason; closing needs a reason and a lesson learned, no open
--    responses, and someone other than the person who raised the risk (or a different approver) - SoD on closing.
--    A materialised threat may point at the contract event it became.
-- Rollback: DROP TABLE risk_responses, risk_assessments, risks CASCADE.

CREATE TABLE IF NOT EXISTS risks (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  risk_no VARCHAR(30) NOT NULL,
  tender_id BIGINT REFERENCES tenders(id),
  project_id BIGINT REFERENCES projects(id),
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('threat','opportunity')),
  title VARCHAR(200) NOT NULL,
  cause TEXT NOT NULL CHECK (length(trim(cause)) >= 5),
  effect TEXT NOT NULL CHECK (length(trim(effect)) >= 5),
  category VARCHAR(60),
  owner_user_id BIGINT NOT NULL REFERENCES users(id),
  probability_level SMALLINT NOT NULL CHECK (probability_level BETWEEN 1 AND 5),
  impact_level SMALLINT NOT NULL CHECK (impact_level BETWEEN 1 AND 5),
  score SMALLINT GENERATED ALWAYS AS (probability_level * impact_level) STORED,
  probability_pct NUMERIC(5,2) CHECK (probability_pct >= 0 AND probability_pct <= 100),
  cost_impact NUMERIC(18,2) CHECK (cost_impact >= 0),
  expected_value NUMERIC(18,2) GENERATED ALWAYS AS (round(probability_pct * cost_impact / 100, 2)) STORED,
  time_impact_days INT CHECK (time_impact_days >= 0),
  trigger_description TEXT,
  review_due DATE,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','closed')),
  escalated_to BIGINT REFERENCES users(id),
  escalation_reason TEXT,
  escalated_at TIMESTAMPTZ,
  closure_type VARCHAR(20) CHECK (closure_type IN ('expired','mitigated','occurred','realised','not_realised')),
  closure_reason TEXT,
  lesson_learned TEXT,
  materialised_event_id BIGINT REFERENCES contract_events(id),
  closed_by BIGINT REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, risk_no),
  CHECK (tender_id IS NOT NULL OR project_id IS NOT NULL),
  CHECK (status <> 'escalated' OR (escalated_to IS NOT NULL AND length(trim(coalesce(escalation_reason,''))) >= 5)),
  CHECK (status <> 'closed' OR (closure_type IS NOT NULL AND length(trim(coalesce(closure_reason,''))) >= 5
                                AND length(trim(coalesce(lesson_learned,''))) >= 10 AND closed_by IS NOT NULL AND closed_by <> created_by)),
  CHECK (closure_type IS NULL OR (kind = 'threat' AND closure_type IN ('expired','mitigated','occurred')) OR (kind = 'opportunity' AND closure_type IN ('expired','realised','not_realised'))),
  CHECK (materialised_event_id IS NULL OR closure_type = 'occurred')
);
CREATE INDEX IF NOT EXISTS idx_risks_project ON risks(org_id, project_id, status);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  risk_id BIGINT NOT NULL REFERENCES risks(id),
  probability_level SMALLINT NOT NULL,
  impact_level SMALLINT NOT NULL,
  probability_pct NUMERIC(5,2),
  cost_impact NUMERIC(18,2),
  time_impact_days INT,
  assessed_by BIGINT REFERENCES users(id),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS risk_responses (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  risk_id BIGINT NOT NULL REFERENCES risks(id),
  strategy VARCHAR(12) NOT NULL CHECK (strategy IN ('avoid','mitigate','transfer','accept','exploit','enhance','share')),
  action TEXT NOT NULL CHECK (length(trim(action)) >= 5),
  owner_user_id BIGINT NOT NULL REFERENCES users(id),
  due_date DATE NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  outcome TEXT,
  completed_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (completed_at IS NOT NULL AND length(trim(coalesce(outcome,''))) >= 5))
);

CREATE OR REPLACE FUNCTION guard_risk() RETURNS trigger AS $$
DECLARE ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Risks are never deleted; close them with a reason'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'closed' THEN RAISE EXCEPTION 'Risk % is closed and immutable', OLD.id; END IF;
    IF (NEW.org_id, NEW.risk_no, NEW.kind, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.risk_no, OLD.kind, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'Risk identity is immutable';
    END IF;
    IF OLD.tender_id IS NOT NULL AND NEW.tender_id IS DISTINCT FROM OLD.tender_id THEN RAISE EXCEPTION 'Tender link is immutable'; END IF;
    IF OLD.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN RAISE EXCEPTION 'Project link is immutable once set'; END IF;
    IF NEW.status = 'closed' AND EXISTS (SELECT 1 FROM risk_responses WHERE risk_id = NEW.id AND status = 'open') THEN
      RAISE EXCEPTION 'Close or cancel the open responses of risk % first', NEW.id;
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.status = 'open' AND TG_OP = 'INSERT' AND (NEW.escalated_to IS NOT NULL OR NEW.closed_by IS NOT NULL) THEN RAISE EXCEPTION 'A risk starts open'; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'open' THEN RAISE EXCEPTION 'A risk starts open'; END IF;
  IF NEW.tender_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenders WHERE id = NEW.tender_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Tender not found in this organization'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Project not found in this organization'; END IF;
  SELECT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_user_id AND org_id = NEW.org_id AND is_active) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'Risk owner must be an active user of this organization'; END IF;
  IF NEW.escalated_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.escalated_to AND org_id = NEW.org_id AND is_active) THEN
    RAISE EXCEPTION 'Escalation recipient must be an active user of this organization';
  END IF;
  IF NEW.materialised_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contract_events e JOIN contracts c ON c.id = e.contract_id
       WHERE e.id = NEW.materialised_event_id AND c.org_id = NEW.org_id AND (NEW.project_id IS NULL OR c.project_id = NEW.project_id)) THEN
    RAISE EXCEPTION 'Materialised event must be a contract event of the same project';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_risk_guard ON risks;
CREATE TRIGGER trg_risk_guard BEFORE INSERT OR UPDATE OR DELETE ON risks FOR EACH ROW EXECUTE FUNCTION guard_risk();

-- Assessment history written by the database on insert and on every change of the assessed values.
CREATE OR REPLACE FUNCTION risk_assessment_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (NEW.probability_level, NEW.impact_level, NEW.probability_pct, NEW.cost_impact, NEW.time_impact_days)
     IS DISTINCT FROM (OLD.probability_level, OLD.impact_level, OLD.probability_pct, OLD.cost_impact, OLD.time_impact_days) THEN
    INSERT INTO risk_assessments(org_id, risk_id, probability_level, impact_level, probability_pct, cost_impact, time_impact_days, assessed_by)
    VALUES (NEW.org_id, NEW.id, NEW.probability_level, NEW.impact_level, NEW.probability_pct, NEW.cost_impact, NEW.time_impact_days,
            coalesce(NULLIF(current_setting('app.user_id', true), '')::bigint, NEW.created_by));
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_risk_assessment_history ON risks;
CREATE TRIGGER trg_risk_assessment_history AFTER INSERT OR UPDATE ON risks FOR EACH ROW EXECUTE FUNCTION risk_assessment_history();

CREATE OR REPLACE FUNCTION guard_risk_assessments() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Risk assessment history is append-only'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_risk_assessments_append_only ON risk_assessments;
CREATE TRIGGER trg_risk_assessments_append_only BEFORE UPDATE OR DELETE ON risk_assessments FOR EACH ROW EXECUTE FUNCTION guard_risk_assessments();

CREATE OR REPLACE FUNCTION guard_risk_response() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Risk responses are never deleted; cancel them with an outcome'; END IF;
  SELECT id, org_id, kind, status INTO r FROM risks WHERE id = NEW.risk_id;
  IF r.id IS NULL OR r.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Risk not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF r.status = 'closed' THEN RAISE EXCEPTION 'Risk % is closed', r.id; END IF;
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'A response starts open'; END IF;
    IF (r.kind = 'threat' AND NEW.strategy NOT IN ('avoid','mitigate','transfer','accept'))
       OR (r.kind = 'opportunity' AND NEW.strategy NOT IN ('exploit','enhance','share','accept')) THEN
      RAISE EXCEPTION 'Strategy % does not apply to a %', NEW.strategy, r.kind;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_user_id AND org_id = NEW.org_id AND is_active) THEN RAISE EXCEPTION 'Response owner must be an active user of this organization'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN RAISE EXCEPTION 'Response % is finished and immutable', OLD.id; END IF;
  IF (NEW.risk_id, NEW.org_id, NEW.strategy, NEW.action, NEW.owner_user_id, NEW.due_date, NEW.created_by) IS DISTINCT FROM
     (OLD.risk_id, OLD.org_id, OLD.strategy, OLD.action, OLD.owner_user_id, OLD.due_date, OLD.created_by) THEN
    RAISE EXCEPTION 'Response details are immutable; cancel it and add a new one';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_risk_response_guard ON risk_responses;
CREATE TRIGGER trg_risk_response_guard BEFORE INSERT OR UPDATE OR DELETE ON risk_responses FOR EACH ROW EXECUTE FUNCTION guard_risk_response();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['risks','risk_assessments','risk_responses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
