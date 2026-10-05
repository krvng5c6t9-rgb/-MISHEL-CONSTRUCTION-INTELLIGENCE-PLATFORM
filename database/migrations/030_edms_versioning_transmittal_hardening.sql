-- REV18 — EDMS operational closure: immutable version records, formal transmittal lifecycle,
-- maker/checker separation and project/tenant consistency.

CREATE TABLE IF NOT EXISTS document_versions (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id),
    document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    project_id BIGINT REFERENCES projects(id),
    version_no INT NOT NULL CHECK (version_no > 0),
    revision VARCHAR(20),
    file_name VARCHAR(255) NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type VARCHAR(150),
    file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    sha256 CHAR(64) CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-fA-F]{64}$'),
    uploaded_by BIGINT NOT NULL REFERENCES users(id),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_versions_one_current
  ON document_versions(document_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_document_versions_document_created
  ON document_versions(document_id, created_at DESC);

-- Backfill a version row for legacy documents. This is idempotent.
INSERT INTO document_versions(org_id, document_id, project_id, version_no, revision, file_name, storage_key, uploaded_by, is_current, created_at)
SELECT d.org_id, d.id, d.project_id, GREATEST(coalesce(d.version_no,1),1), d.revision, d.file_name, d.file_path, d.uploaded_by, true, d.created_at
FROM documents d
WHERE NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id=d.id);

ALTER TABLE document_transmittals ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE document_transmittals ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
ALTER TABLE document_transmittals ADD COLUMN IF NOT EXISTS issued_by BIGINT REFERENCES users(id);
ALTER TABLE document_transmittals ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
ALTER TABLE document_transmittals ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE document_transmittals DROP CONSTRAINT IF EXISTS chk_document_transmittal_status;
ALTER TABLE document_transmittals ADD CONSTRAINT chk_document_transmittal_status CHECK (status IN ('draft','issued','void'));
ALTER TABLE document_transmittals DROP CONSTRAINT IF EXISTS chk_document_transmittal_issue_fields;
ALTER TABLE document_transmittals ADD CONSTRAINT chk_document_transmittal_issue_fields CHECK (
  (status='draft' AND issued_by IS NULL AND issued_at IS NULL)
  OR (status='issued' AND issued_by IS NOT NULL AND issued_at IS NOT NULL)
  OR (status='void' AND void_reason IS NOT NULL AND length(trim(void_reason))>0)
);

ALTER TABLE transmittal_lines ADD COLUMN IF NOT EXISTS document_version_id BIGINT REFERENCES document_versions(id);
UPDATE transmittal_lines l
SET document_version_id = v.id
FROM document_versions v
WHERE l.document_id=v.document_id AND v.is_current=true AND l.document_version_id IS NULL;

CREATE OR REPLACE FUNCTION guard_document_version_parent() RETURNS TRIGGER AS $$
DECLARE d_org BIGINT; d_project BIGINT;
BEGIN
  SELECT org_id, project_id INTO d_org, d_project FROM documents WHERE id=NEW.document_id;
  IF d_org IS NULL THEN RAISE EXCEPTION 'Document % does not exist', NEW.document_id; END IF;
  IF NEW.org_id <> d_org THEN RAISE EXCEPTION 'Document version tenant mismatch'; END IF;
  IF NEW.project_id IS DISTINCT FROM d_project THEN RAISE EXCEPTION 'Document version project mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_document_version_parent ON document_versions;
CREATE TRIGGER trg_document_version_parent BEFORE INSERT OR UPDATE ON document_versions
FOR EACH ROW EXECUTE FUNCTION guard_document_version_parent();

CREATE OR REPLACE FUNCTION guard_transmittal_line_integrity() RETURNS TRIGGER AS $$
DECLARE t_org BIGINT; t_project BIGINT; t_status TEXT; d_org BIGINT; d_project BIGINT; v_doc BIGINT; v_revision TEXT;
BEGIN
  SELECT org_id, project_id, status INTO t_org, t_project, t_status FROM document_transmittals WHERE id=NEW.transmittal_id;
  IF t_org IS NULL THEN RAISE EXCEPTION 'Transmittal % does not exist', NEW.transmittal_id; END IF;
  IF TG_OP <> 'DELETE' AND t_status <> 'draft' THEN RAISE EXCEPTION 'Issued/void transmittal lines are immutable'; END IF;
  SELECT org_id, project_id INTO d_org, d_project FROM documents WHERE id=NEW.document_id;
  IF d_org IS NULL OR d_org <> t_org THEN RAISE EXCEPTION 'Transmittal document tenant mismatch'; END IF;
  IF d_project IS DISTINCT FROM t_project THEN RAISE EXCEPTION 'Transmittal document project mismatch'; END IF;
  IF NEW.document_version_id IS NULL THEN RAISE EXCEPTION 'A specific document version is required'; END IF;
  SELECT document_id, revision INTO v_doc, v_revision FROM document_versions WHERE id=NEW.document_version_id;
  IF v_doc IS NULL OR v_doc <> NEW.document_id THEN RAISE EXCEPTION 'Document version does not belong to document'; END IF;
  NEW.org_id := t_org;
  NEW.revision := coalesce(v_revision, NEW.revision);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_transmittal_document_tenant ON transmittal_lines;
DROP TRIGGER IF EXISTS trg_transmittal_line_document_org ON transmittal_lines;
DROP TRIGGER IF EXISTS trg_transmittal_line_integrity ON transmittal_lines;
CREATE TRIGGER trg_transmittal_line_integrity BEFORE INSERT OR UPDATE ON transmittal_lines
FOR EACH ROW EXECUTE FUNCTION guard_transmittal_line_integrity();

CREATE OR REPLACE FUNCTION guard_transmittal_line_delete() RETURNS TRIGGER AS $$
DECLARE s TEXT;
BEGIN
  SELECT status INTO s FROM document_transmittals WHERE id=OLD.transmittal_id;
  IF s <> 'draft' THEN RAISE EXCEPTION 'Issued/void transmittal lines are immutable'; END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_transmittal_line_delete ON transmittal_lines;
CREATE TRIGGER trg_transmittal_line_delete BEFORE DELETE ON transmittal_lines
FOR EACH ROW EXECUTE FUNCTION guard_transmittal_line_delete();

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_versions_tenant_select ON document_versions;
DROP POLICY IF EXISTS document_versions_tenant_write ON document_versions;
CREATE POLICY document_versions_tenant_select ON document_versions FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
CREATE POLICY document_versions_tenant_write ON document_versions FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
