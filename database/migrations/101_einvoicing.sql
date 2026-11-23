-- Stage 67 / CC-096 (A-006; OVD-002 A3; owner note 2026-11-23 "global, not local"): electronic invoicing framework with
-- Egypt (ETA) as the first scheme.
-- (transaction managed by migrator)
-- Before (E3 @CC-095): tax invoices existed only as IPCs with output tax computed by the tax engine (074); nothing was
-- reported to any tax authority.
-- Now (scheme-neutral core; one adapter per country scheme):
--  * einvoice_profiles: per company and scheme ('eg_eta' now; the check lists the schemes the code implements) - test
--    or production environment, credentials (secret stored encrypted by the API), issuer data and defaults as the scheme
--    needs them (JSON, validated by the adapter), the company's signing service (URL) where the scheme requires a
--    signature; nothing is assumed: a document is refused while a required value is missing.
--  * tax_codes.einvoice_tax_type / einvoice_sub_type: the company maps each of its tax codes to the scheme's codes.
--  * clients.einvoice_party_type / einvoice_address: the receiver data a scheme needs (business, person, foreign;
--    structured address).
--  * einvoice_documents: one document per source record and scheme while not rejected / invalid / cancelled; the
--    payload, its canonical form and SHA-256 are fixed when prepared; the life cycle prepared -> submitted ->
--    valid / invalid / rejected (or failed before submission, cancelled after) is enforced; documents are never deleted.
-- Rollback: drop einvoice_documents, einvoice_profiles and the added columns.

CREATE TABLE IF NOT EXISTS einvoice_profiles (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  scheme VARCHAR(20) NOT NULL CHECK (scheme IN ('eg_eta')),
  environment VARCHAR(12) NOT NULL CHECK (environment IN ('test', 'production')),
  client_id VARCHAR(200),
  client_secret_enc TEXT,
  secret_last4 VARCHAR(4),
  issuer JSONB NOT NULL DEFAULT '{}'::jsonb,
  defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
  signer_url VARCHAR(500) CHECK (signer_url IS NULL OR signer_url ~ '^https?://'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by BIGINT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, scheme)
);
ALTER TABLE einvoice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE einvoice_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON einvoice_profiles;
DROP POLICY IF EXISTS tenant_isolation_write ON einvoice_profiles;
CREATE POLICY tenant_isolation_select ON einvoice_profiles FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON einvoice_profiles FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_einvoice_profiles ON einvoice_profiles;
CREATE TRIGGER trg_audit_einvoice_profiles AFTER INSERT OR UPDATE OR DELETE ON einvoice_profiles FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

ALTER TABLE tax_codes ADD COLUMN IF NOT EXISTS einvoice_tax_type VARCHAR(10) CHECK (einvoice_tax_type IS NULL OR einvoice_tax_type ~ '^[A-Z0-9]{1,10}$');
ALTER TABLE tax_codes ADD COLUMN IF NOT EXISTS einvoice_sub_type VARCHAR(10) CHECK (einvoice_sub_type IS NULL OR einvoice_sub_type ~ '^[A-Z0-9]{1,10}$');
ALTER TABLE clients ADD COLUMN IF NOT EXISTS einvoice_party_type VARCHAR(10) CHECK (einvoice_party_type IS NULL OR einvoice_party_type IN ('business', 'person', 'foreign'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS einvoice_address JSONB;

CREATE TABLE IF NOT EXISTS einvoice_documents (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  scheme VARCHAR(20) NOT NULL CHECK (scheme IN ('eg_eta')),
  environment VARCHAR(12) NOT NULL CHECK (environment IN ('test', 'production')),
  source_table VARCHAR(30) NOT NULL CHECK (source_table IN ('ipcs')),
  source_id BIGINT NOT NULL,
  internal_id VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL,
  document_json TEXT NOT NULL, -- the exact document text whose canonical form is signed and submitted (JSONB reorders keys)
  canonical TEXT NOT NULL,
  canonical_sha256 CHAR(64) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'submitted', 'valid', 'invalid', 'rejected', 'failed', 'cancelled')),
  signature TEXT,
  submission_id VARCHAR(100), provider_uuid VARCHAR(100), provider_long_id VARCHAR(200),
  last_response JSONB, last_error TEXT,
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  submitted_by BIGINT REFERENCES users(id), submitted_at TIMESTAMPTZ,
  status_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('submitted', 'valid', 'invalid') OR (submission_id IS NOT NULL AND submitted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_einvoice_active_source ON einvoice_documents(org_id, scheme, source_table, source_id)
  WHERE status NOT IN ('invalid', 'rejected', 'failed', 'cancelled');
ALTER TABLE einvoice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE einvoice_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON einvoice_documents;
DROP POLICY IF EXISTS tenant_isolation_write ON einvoice_documents;
CREATE POLICY tenant_isolation_select ON einvoice_documents FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON einvoice_documents FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_einvoice_documents ON einvoice_documents;
CREATE TRIGGER trg_audit_einvoice_documents AFTER INSERT OR UPDATE OR DELETE ON einvoice_documents FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

CREATE OR REPLACE FUNCTION guard_einvoice_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Electronic invoice documents are permanent'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'prepared' THEN RAISE EXCEPTION 'An electronic invoice is prepared first'; END IF;
    IF NEW.canonical_sha256 <> encode(sha256(convert_to(NEW.canonical, 'UTF8')), 'hex') THEN RAISE EXCEPTION 'The canonical fingerprint does not match'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.scheme, NEW.environment, NEW.source_table, NEW.source_id, NEW.internal_id, NEW.payload, NEW.document_json, NEW.canonical, NEW.canonical_sha256, NEW.prepared_by, NEW.created_at)
     IS DISTINCT FROM (OLD.org_id, OLD.scheme, OLD.environment, OLD.source_table, OLD.source_id, OLD.internal_id, OLD.payload, OLD.document_json, OLD.canonical, OLD.canonical_sha256, OLD.prepared_by, OLD.created_at) THEN
    RAISE EXCEPTION 'A prepared electronic invoice never changes; prepare a new one';
  END IF;
  IF OLD.status IN ('invalid', 'rejected', 'failed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'A closed electronic invoice never changes'; END IF;
  IF NOT (NEW.status = OLD.status
       OR (OLD.status = 'prepared' AND NEW.status IN ('submitted', 'rejected', 'failed'))
       OR (OLD.status = 'submitted' AND NEW.status IN ('valid', 'invalid'))
       OR (OLD.status = 'valid' AND NEW.status = 'cancelled')) THEN
    RAISE EXCEPTION 'Electronic invoice status cannot move from % to %', OLD.status, NEW.status;
  END IF;
  IF OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN RAISE EXCEPTION 'The signature of an electronic invoice never changes'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_einvoice_document ON einvoice_documents;
CREATE TRIGGER trg_guard_einvoice_document BEFORE INSERT OR UPDATE OR DELETE ON einvoice_documents FOR EACH ROW EXECUTE FUNCTION guard_einvoice_document();
