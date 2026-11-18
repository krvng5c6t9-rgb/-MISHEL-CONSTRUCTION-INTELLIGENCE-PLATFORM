-- Stage 66 / CC-095 (A-006, MP-04 AG-04, MP-07 R3): AI layer v1 - the company's own model provider and the tender
-- study agent.
-- (transaction managed by migrator)
-- Before (E3 @CC-094): the AI registry (migration 033) recorded agents and runs, but no model was ever called.
-- Now:
--  * ai_provider_settings: each company enters its own provider key (stored encrypted by the API, AES-256-GCM; only the
--    last four characters are ever returned), chooses the model, and confirms that it accepts sending the documents
--    it submits to the provider (data_processing_accepted) - the AI cannot be enabled without that confirmation.
--  * tender_studies: a tender's documents (text as submitted, with its SHA-256) are studied by the tender study agent;
--    the structured result is a DRAFT until a person other than the requester approves or rejects it with a note;
--    each finding's quoted text is checked against the submitted documents by the API (unverified quotes are marked);
--    the run is also entered in ai_runs (waiting_approval while it awaits review, which raises AL-18).
--  * results, inputs and decisions are permanent (only the review fields are added once).
-- Rollback: drop tender_studies and ai_provider_settings.

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  org_id BIGINT PRIMARY KEY REFERENCES organizations(id),
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('anthropic')),
  model VARCHAR(80) NOT NULL CHECK (model ~ '^[a-z0-9][a-z0-9.-]{2,79}$'),
  api_key_enc TEXT NOT NULL,
  api_key_last4 CHAR(4) NOT NULL,
  data_processing_accepted BOOLEAN NOT NULL,
  enabled BOOLEAN NOT NULL,
  updated_by BIGINT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR data_processing_accepted)
);
ALTER TABLE ai_provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON ai_provider_settings;
DROP POLICY IF EXISTS tenant_isolation_write ON ai_provider_settings;
CREATE POLICY tenant_isolation_select ON ai_provider_settings FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON ai_provider_settings FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_ai_provider_settings ON ai_provider_settings;
CREATE TRIGGER trg_audit_ai_provider_settings AFTER INSERT OR UPDATE OR DELETE ON ai_provider_settings FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

CREATE TABLE IF NOT EXISTS tender_studies (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  tender_id BIGINT NOT NULL REFERENCES tenders(id),
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'refused', 'approved', 'rejected')),
  input_text TEXT NOT NULL CHECK (length(input_text) BETWEEN 50 AND 2000000),
  input_sha256 CHAR(64) NOT NULL,
  instructions TEXT CHECK (instructions IS NULL OR length(instructions) <= 4000),
  model VARCHAR(80),
  served_model VARCHAR(80),
  result JSONB,
  quotes_checked INT, quotes_verified INT,
  stop_reason VARCHAR(30),
  input_tokens INT, output_tokens INT,
  error TEXT,
  ai_run_id BIGINT REFERENCES ai_runs(id),
  requested_by BIGINT NOT NULL REFERENCES users(id),
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  reviewed_by BIGINT REFERENCES users(id), reviewed_at TIMESTAMPTZ, review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved', 'rejected') OR (reviewed_by IS NOT NULL AND reviewed_by <> requested_by AND reviewed_at IS NOT NULL AND length(btrim(coalesce(review_note, ''))) >= 5)),
  CHECK (status <> 'completed' OR result IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tender_studies_tender ON tender_studies(org_id, tender_id, created_at DESC);
ALTER TABLE tender_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_studies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON tender_studies;
DROP POLICY IF EXISTS tenant_isolation_write ON tender_studies;
CREATE POLICY tenant_isolation_select ON tender_studies FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON tender_studies FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_tender_studies ON tender_studies;
CREATE TRIGGER trg_audit_tender_studies AFTER INSERT OR UPDATE OR DELETE ON tender_studies FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

-- The documents and the request never change; a finished result never changes; a review is recorded once.
CREATE OR REPLACE FUNCTION guard_tender_study() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Tender studies are permanent'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM tenders WHERE id = NEW.tender_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Tender not found in this organization'; END IF;
    IF NEW.status <> 'queued' THEN RAISE EXCEPTION 'A tender study starts queued'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.tender_id, NEW.input_text, NEW.input_sha256, NEW.instructions, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM (OLD.org_id, OLD.tender_id, OLD.input_text, OLD.input_sha256, OLD.instructions, OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'The documents and request of a tender study never change';
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'failed', 'refused') THEN RAISE EXCEPTION 'A closed tender study never changes'; END IF;
  IF OLD.status = 'completed' AND (NEW.status NOT IN ('approved', 'rejected') OR NEW.result IS DISTINCT FROM OLD.result
     OR (NEW.quotes_checked, NEW.quotes_verified, NEW.model, NEW.served_model) IS DISTINCT FROM (OLD.quotes_checked, OLD.quotes_verified, OLD.model, OLD.served_model)) THEN
    RAISE EXCEPTION 'A completed study is only approved or rejected';
  END IF;
  IF OLD.status IN ('queued', 'running') AND NEW.status IN ('approved', 'rejected') THEN RAISE EXCEPTION 'A study is reviewed after it completes'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_tender_study ON tender_studies;
CREATE TRIGGER trg_guard_tender_study BEFORE INSERT OR UPDATE OR DELETE ON tender_studies FOR EACH ROW EXECUTE FUNCTION guard_tender_study();
