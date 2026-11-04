-- Stage 59 / CC-089 / F-64 remainder (MP-03 §1 and §5): confidentiality class and QR code on printed documents.
-- (transaction managed by migrator)
-- Before (E3 @CC-088): printed documents carried no confidentiality class (MP-03 names none per document type) and no
-- machine-readable verification mark; a copy could be traced only by typing its printed export number.
-- Now:
--  * a company may give each printed document type a confidentiality class from a fixed list of four levels
--    (public / internal / confidential / restricted). Nothing is assumed: a type without a class is printed without one.
--  * every export entry records the class printed on the copy and the exact text encoded in the copy's QR code
--    (export number, company, document type, record, document number, status, draft mark, key amount and currency).
--    Both are written with the entry, before the file is produced, and never change (guard of migration 092 extended);
--    the SHA-256 is still the only value added afterwards. Entries made before this migration have neither.
-- Rollback: drop table document_classifications; alter table document_exports drop column classification, drop column
-- qr_payload; restore guard_document_export of migration 092.

CREATE TABLE IF NOT EXISTS document_classifications (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  doc_type VARCHAR(40) NOT NULL CHECK (doc_type IN ('ipc', 'subcontract_certificate', 'purchase_order', 'goods_receipt', 'payment', 'manual_journal', 'site_diary')),
  classification VARCHAR(16) NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  updated_by BIGINT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_type)
);
ALTER TABLE document_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_classifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON document_classifications;
DROP POLICY IF EXISTS tenant_isolation_write ON document_classifications;
CREATE POLICY tenant_isolation_select ON document_classifications FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON document_classifications FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_document_classifications ON document_classifications;
CREATE TRIGGER trg_audit_document_classifications AFTER INSERT OR UPDATE OR DELETE ON document_classifications FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

ALTER TABLE document_exports ADD COLUMN IF NOT EXISTS classification VARCHAR(16)
  CHECK (classification IS NULL OR classification IN ('public', 'internal', 'confidential', 'restricted'));
ALTER TABLE document_exports ADD COLUMN IF NOT EXISTS qr_payload TEXT CHECK (qr_payload IS NULL OR (qr_payload LIKE 'MARC-DOC/1?%' AND length(qr_payload) <= 600));

CREATE OR REPLACE FUNCTION guard_document_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document export entries are permanent'; END IF;
  IF OLD.sha256 IS NOT NULL THEN RAISE EXCEPTION 'Document export entries are permanent'; END IF;
  IF (NEW.org_id, NEW.doc_type, NEW.record_id, NEW.record_status, NEW.is_draft, NEW.format, NEW.lang, NEW.exported_by, NEW.exported_at, NEW.classification, NEW.qr_payload)
     IS DISTINCT FROM (OLD.org_id, OLD.doc_type, OLD.record_id, OLD.record_status, OLD.is_draft, OLD.format, OLD.lang, OLD.exported_by, OLD.exported_at, OLD.classification, OLD.qr_payload)
     OR NEW.sha256 IS NULL THEN
    RAISE EXCEPTION 'Only the hash of the produced file is added to a document export entry';
  END IF;
  RETURN NEW;
END $$;
