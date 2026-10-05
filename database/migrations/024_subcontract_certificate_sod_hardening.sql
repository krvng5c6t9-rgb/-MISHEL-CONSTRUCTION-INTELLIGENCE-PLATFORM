BEGIN;

-- REV12 — Subcontract certificate maker/site-verifier/QS-certifier segregation.
ALTER TABLE subcontract_certificates
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS site_verified_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS site_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qs_certified_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS qs_certified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subcontract_certificates_created_by ON subcontract_certificates(created_by);
CREATE INDEX IF NOT EXISTS idx_subcontract_certificates_site_verified_by ON subcontract_certificates(site_verified_by);
CREATE INDEX IF NOT EXISTS idx_subcontract_certificates_qs_certified_by ON subcontract_certificates(qs_certified_by);

-- Legacy rows may have certified_by populated at creation time in older releases.
-- Do not guess maker identity for existing rows. New workflow fails closed if maker is missing.

CREATE OR REPLACE FUNCTION guard_subcontract_certificate_sod()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'site_verified' AND OLD.status IS DISTINCT FROM 'site_verified' THEN
    IF NEW.created_by IS NULL OR NEW.site_verified_by IS NULL THEN
      RAISE EXCEPTION 'Subcontract certificate site verification requires maker and verifier identity';
    END IF;
    IF NEW.created_by = NEW.site_verified_by THEN
      RAISE EXCEPTION 'Segregation of duties violation: maker cannot site-verify own subcontract certificate';
    END IF;
    IF NEW.site_verified_at IS NULL THEN
      RAISE EXCEPTION 'Subcontract certificate site verification requires site_verified_at';
    END IF;
  END IF;

  IF NEW.status = 'qs_certified' AND OLD.status IS DISTINCT FROM 'qs_certified' THEN
    IF NEW.created_by IS NULL OR NEW.site_verified_by IS NULL OR NEW.qs_certified_by IS NULL THEN
      RAISE EXCEPTION 'Subcontract certificate QS certification requires maker, site verifier and QS certifier identity';
    END IF;
    IF NEW.created_by = NEW.qs_certified_by THEN
      RAISE EXCEPTION 'Segregation of duties violation: maker cannot QS-certify own subcontract certificate';
    END IF;
    IF NEW.site_verified_by = NEW.qs_certified_by THEN
      RAISE EXCEPTION 'Segregation of duties violation: site verifier cannot QS-certify the same subcontract certificate';
    END IF;
    IF NEW.qs_certified_at IS NULL THEN
      RAISE EXCEPTION 'Subcontract certificate QS certification requires qs_certified_at';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subcontract_certificate_sod ON subcontract_certificates;
CREATE TRIGGER trg_subcontract_certificate_sod
BEFORE UPDATE OF status, created_by, site_verified_by, qs_certified_by ON subcontract_certificates
FOR EACH ROW EXECUTE FUNCTION guard_subcontract_certificate_sod();

COMMIT;
