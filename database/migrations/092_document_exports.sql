-- Stage 55 / CC-085 / R1.5 first part (MP-03 §1 and §5): document export log.
-- (transaction managed by migrator)
-- Before (E3 @CC-084): no document could be exported or printed and nothing recorded who took a copy of what.
-- Now every export (HTML print view or PDF) of a document is recorded once, at the moment it is produced: the
-- document type and record, the record's status and whether it was printed as a DRAFT, the language and format,
-- the SHA-256 and size of the exact bytes handed to the user, who and when. The export number is printed on the
-- document so a copy can be traced back to its entry (MP-03 "verification" and "audit"). Entries are never changed.
-- Rollback: drop table document_exports and function guard_document_export.

CREATE TABLE IF NOT EXISTS document_exports (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  doc_type VARCHAR(40) NOT NULL CHECK (doc_type IN ('ipc', 'subcontract_certificate')),
  record_id BIGINT NOT NULL,
  record_status VARCHAR(40) NOT NULL,
  is_draft BOOLEAN NOT NULL,
  format VARCHAR(8) NOT NULL CHECK (format IN ('html', 'pdf')),
  lang VARCHAR(2) NOT NULL CHECK (lang IN ('ar', 'en')),
  sha256 CHAR(64),
  size_bytes INT,
  exported_by BIGINT NOT NULL REFERENCES users(id),
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((sha256 IS NULL) = (size_bytes IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_document_exports_record ON document_exports(org_id, doc_type, record_id, exported_at DESC);
ALTER TABLE document_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_exports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON document_exports;
DROP POLICY IF EXISTS tenant_isolation_write ON document_exports;
CREATE POLICY tenant_isolation_select ON document_exports FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON document_exports FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_document_exports ON document_exports;
CREATE TRIGGER trg_audit_document_exports AFTER INSERT OR UPDATE OR DELETE ON document_exports FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

-- An entry is written in two steps inside one transaction (number first, so it can be printed; then the hash of the
-- produced bytes). After that it never changes and is never deleted.
CREATE OR REPLACE FUNCTION guard_document_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document export entries are permanent'; END IF;
  IF OLD.sha256 IS NOT NULL THEN RAISE EXCEPTION 'Document export entries are permanent'; END IF;
  IF (NEW.org_id, NEW.doc_type, NEW.record_id, NEW.record_status, NEW.is_draft, NEW.format, NEW.lang, NEW.exported_by, NEW.exported_at)
     IS DISTINCT FROM (OLD.org_id, OLD.doc_type, OLD.record_id, OLD.record_status, OLD.is_draft, OLD.format, OLD.lang, OLD.exported_by, OLD.exported_at)
     OR NEW.sha256 IS NULL THEN
    RAISE EXCEPTION 'Only the hash of the produced file is added to a document export entry';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_document_export ON document_exports;
CREATE TRIGGER trg_guard_document_export BEFORE UPDATE OR DELETE ON document_exports FOR EACH ROW EXECUTE FUNCTION guard_document_export();
