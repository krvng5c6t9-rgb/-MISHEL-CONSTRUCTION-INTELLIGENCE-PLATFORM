-- NDC-010: accepted-programme governance (RB-02 PM-C-06, P0-5).
-- (transaction managed by migrator)
--  * a programme submission freezes a snapshot of the project's activities and logic at the data date;
--  * the response deadline is computed from a confirmed contract obligation rule (response_due), never defaulted;
--  * the decision (accepted / rejected with reasons) is the Engineer's / PM's - recorded with its reference;
--  * accepting a newer revision supersedes the previously accepted one atomically;
--  * "accepted programme" = the single submission in status accepted per contract.
CREATE TABLE IF NOT EXISTS programme_submissions (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    contract_id         BIGINT NOT NULL REFERENCES contracts(id),
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    revision_no         VARCHAR(20) NOT NULL,
    data_date           DATE NOT NULL,
    submitted_on        DATE NOT NULL,
    submitted_by        BIGINT NOT NULL REFERENCES users(id),
    response_rule_id    BIGINT REFERENCES contract_obligation_rules(id),
    response_due        DATE,
    narrative           TEXT,
    status              VARCHAR(12) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','rejected','superseded')),
    decision_on         DATE,
    decision_reference  TEXT,
    rejection_reasons   TEXT,
    recorded_by         BIGINT REFERENCES users(id),
    snapshot_sealed     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, revision_no),
    CHECK (data_date <= submitted_on),
    CHECK (status = 'submitted' OR status = 'superseded' OR (decision_on IS NOT NULL AND decision_reference IS NOT NULL AND decision_on >= submitted_on)),
    CHECK (status <> 'rejected' OR length(trim(coalesce(rejection_reasons,''))) >= 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_accepted_programme ON programme_submissions(contract_id) WHERE status = 'accepted';

CREATE TABLE IF NOT EXISTS programme_submission_activities (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    submission_id       BIGINT NOT NULL REFERENCES programme_submissions(id),
    activity_id         BIGINT NOT NULL,
    activity_id_ext     VARCHAR(30),
    activity_name       VARCHAR(255) NOT NULL,
    planned_start       DATE,
    planned_finish      DATE,
    planned_duration_days INT,
    percent_complete    NUMERIC(5,2),
    predecessors        JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_prog_sub_acts ON programme_submission_activities(submission_id);

CREATE OR REPLACE FUNCTION guard_programme_submission() RETURNS trigger AS $$
DECLARE r contract_obligation_rules%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Programme submissions cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = NEW.contract_id AND c.org_id = NEW.org_id AND c.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'Contract/project not found in this organization';
    END IF;
    IF NEW.submitted_on > current_date THEN RAISE EXCEPTION 'Submission date cannot be in the future'; END IF;
    IF NEW.response_rule_id IS NOT NULL THEN
      SELECT * INTO r FROM contract_obligation_rules WHERE id = NEW.response_rule_id;
      IF r.status <> 'confirmed' OR r.contract_id <> NEW.contract_id OR r.obligation_type <> 'response_due' THEN
        RAISE EXCEPTION 'Response rule must be a confirmed response_due rule of the same contract';
      END IF;
      NEW.response_due := compute_notice_deadline(NEW.submitted_on, r.period_value, r.period_unit);
    ELSE
      NEW.response_due := NULL;
    END IF;
    NEW.status := 'submitted';
    NEW.snapshot_sealed := false;
    RETURN NEW;
  END IF;
  -- Sealing the snapshot is a one-way switch performed by the submit transaction.
  IF NEW.snapshot_sealed IS DISTINCT FROM OLD.snapshot_sealed THEN
    IF OLD.snapshot_sealed OR NOT EXISTS (SELECT 1 FROM programme_submission_activities WHERE submission_id = OLD.id) THEN
      RAISE EXCEPTION 'A programme snapshot is sealed once and must contain at least one activity';
    END IF;
    IF (to_jsonb(NEW) - 'snapshot_sealed') <> (to_jsonb(OLD) - 'snapshot_sealed') THEN RAISE EXCEPTION 'Sealing cannot change other fields'; END IF;
    RETURN NEW;
  END IF;
  IF NOT OLD.snapshot_sealed THEN RAISE EXCEPTION 'Programme submission snapshot is not sealed'; END IF;
  IF (NEW.contract_id, NEW.project_id, NEW.revision_no, NEW.data_date, NEW.submitted_on, NEW.submitted_by, NEW.response_rule_id, NEW.response_due, NEW.org_id)
     IS DISTINCT FROM (OLD.contract_id, OLD.project_id, OLD.revision_no, OLD.data_date, OLD.submitted_on, OLD.submitted_by, OLD.response_rule_id, OLD.response_due, OLD.org_id) THEN
    RAISE EXCEPTION 'Programme submission content is immutable';
  END IF;
  IF NOT ((OLD.status = 'submitted' AND NEW.status IN ('accepted','rejected')) OR (OLD.status = 'accepted' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'Invalid programme submission transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'accepted' AND (NEW.decision_on, NEW.decision_reference) IS DISTINCT FROM (OLD.decision_on, OLD.decision_reference) THEN
    RAISE EXCEPTION 'Recorded acceptance is immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_programme_submission_guard ON programme_submissions;
CREATE TRIGGER trg_programme_submission_guard BEFORE INSERT OR UPDATE OR DELETE ON programme_submissions FOR EACH ROW EXECUTE FUNCTION guard_programme_submission();

CREATE OR REPLACE FUNCTION guard_programme_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Programme snapshots are immutable'; END IF;
  IF coalesce((SELECT snapshot_sealed FROM programme_submissions WHERE id = NEW.submission_id), true) THEN
    RAISE EXCEPTION 'Programme snapshot is sealed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_programme_snapshot_guard ON programme_submission_activities;
CREATE TRIGGER trg_programme_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON programme_submission_activities FOR EACH ROW EXECUTE FUNCTION guard_programme_snapshot();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['programme_submissions','programme_submission_activities'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

-- F-15 (found by wave2_programme.mjs): a relationship that closes a logic loop was accepted and then made
-- the CPM endpoint fail with HTTP 500. Loops are now refused when the relationship is created.
CREATE OR REPLACE FUNCTION guard_schedule_relationship_cycle() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reach(id) AS (
      SELECT NEW.successor_activity_id
      UNION
      SELECT r.successor_activity_id FROM schedule_relationships r JOIN reach ON r.predecessor_activity_id = reach.id
    ) SELECT 1 FROM reach WHERE id = NEW.predecessor_activity_id) THEN
    RAISE EXCEPTION 'Relationship would create a logic loop in the schedule';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_schedule_relationship_cycle ON schedule_relationships;
CREATE TRIGGER trg_schedule_relationship_cycle BEFORE INSERT OR UPDATE OF predecessor_activity_id, successor_activity_id ON schedule_relationships FOR EACH ROW EXECUTE FUNCTION guard_schedule_relationship_cycle();
