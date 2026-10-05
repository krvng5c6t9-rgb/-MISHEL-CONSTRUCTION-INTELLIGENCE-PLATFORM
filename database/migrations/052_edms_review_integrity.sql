-- CC-029 (RK-003 / GC-03): EDMS review and transmittal integrity - first runtime execution (sweep_edms.mjs).
-- ED1 every business refusal in the EDMS routes was a plain Error -> HTTP 500 (fixed in edms.routes.ts).
-- ED2 rejection without a reason accepted; the approval recorded neither reviewer nor the reviewed revision, so
--     "who approved which revision" was unanswerable once a new revision was uploaded.
-- ED3 duplicate document numbers in one project accepted.
-- ED4 version content (storage key / hash) could be swapped or deleted after approval.
-- ED5 a transmittal "for construction" could carry unapproved or superseded revisions.
-- ED6 an issued transmittal's header (recipient, date, purpose) could be rewritten.
-- (transaction managed by migrator)

CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_project_doc_number ON documents(project_id, doc_number) WHERE doc_number IS NOT NULL;

ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS review_status VARCHAR(10) CHECK (review_status IN ('approved','rejected'));
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id);
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS chk_document_version_review;
ALTER TABLE document_versions ADD CONSTRAINT chk_document_version_review CHECK (
  (review_status IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
  OR (review_status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  OR (review_status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(coalesce(review_comment,''))) >= 5));

-- Version content is immutable; the review decision is written once; versions are never deleted. Only is_current moves.
CREATE OR REPLACE FUNCTION guard_document_version_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document versions are retained and cannot be deleted'; END IF;
  IF (NEW.document_id, NEW.project_id, NEW.org_id, NEW.version_no, NEW.revision, NEW.file_name, NEW.storage_key, NEW.mime_type, NEW.file_size_bytes, NEW.sha256, NEW.uploaded_by)
     IS DISTINCT FROM (OLD.document_id, OLD.project_id, OLD.org_id, OLD.version_no, OLD.revision, OLD.file_name, OLD.storage_key, OLD.mime_type, OLD.file_size_bytes, OLD.sha256, OLD.uploaded_by) THEN
    RAISE EXCEPTION 'Document version % content is immutable; upload a new revision', OLD.id;
  END IF;
  IF OLD.review_status IS NOT NULL AND (NEW.review_status, NEW.reviewed_by, NEW.reviewed_at, NEW.review_comment) IS DISTINCT FROM (OLD.review_status, OLD.reviewed_by, OLD.reviewed_at, OLD.review_comment) THEN
    RAISE EXCEPTION 'Review decision on document version % is final', OLD.id;
  END IF;
  IF NEW.review_status IS NOT NULL AND OLD.review_status IS NULL AND NEW.reviewed_by = NEW.uploaded_by THEN
    RAISE EXCEPTION 'The uploader of a revision cannot review it';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_document_version_immutable ON document_versions;
CREATE TRIGGER trg_document_version_immutable BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION guard_document_version_immutable();

-- Issue rules and header immutability.
CREATE OR REPLACE FUNCTION guard_transmittal_issue() RETURNS trigger AS $$
DECLARE bad record;
BEGIN
  IF OLD.status <> 'draft' AND (NEW.project_id, NEW.transmittal_no, NEW.from_party, NEW.to_party, NEW.issue_date, NEW.purpose, NEW.created_by, NEW.issued_by, NEW.issued_at)
       IS DISTINCT FROM (OLD.project_id, OLD.transmittal_no, OLD.from_party, OLD.to_party, OLD.issue_date, OLD.purpose, OLD.created_by, OLD.issued_by, OLD.issued_at) THEN
    RAISE EXCEPTION 'Issued transmittal % is immutable; void it and issue a new one', OLD.id;
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN RAISE EXCEPTION 'A void transmittal cannot be reinstated'; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
    IF NOT EXISTS (SELECT 1 FROM transmittal_lines WHERE transmittal_id = NEW.id) THEN RAISE EXCEPTION 'Cannot issue an empty transmittal'; END IF;
    IF NEW.issued_by = NEW.created_by THEN RAISE EXCEPTION 'The maker of a transmittal cannot issue it'; END IF;
    IF NEW.purpose = 'for_construction' THEN
      FOR bad IN
        SELECT d.doc_number, v.version_no, v.revision, v.review_status, v.is_current
        FROM transmittal_lines l JOIN document_versions v ON v.id = l.document_version_id JOIN documents d ON d.id = l.document_id
        WHERE l.transmittal_id = NEW.id AND (v.review_status IS DISTINCT FROM 'approved' OR NOT v.is_current)
      LOOP
        RAISE EXCEPTION 'Document % version % (rev %) is not an approved current revision and cannot be issued for construction', bad.doc_number, bad.version_no, coalesce(bad.revision, '-');
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_transmittal_issue ON document_transmittals;
CREATE TRIGGER trg_transmittal_issue BEFORE UPDATE ON document_transmittals FOR EACH ROW EXECUTE FUNCTION guard_transmittal_issue();
