-- G-002 / F-02: governed vendor / subcontractor master.
-- (transaction managed by migrator)
-- Controls (STEP09 bank-master constitution, STEP15 SoD, research board RB-04 §4/§6-6/§6-11):
--  * status, prequalification, blacklist and bank details change only through governed API paths
--    (transaction-local GUC app.vendor_governed='on'), each leaving an append-only event;
--  * bank details change only via a change request decided by someone other than the requester,
--    with an independent verification method recorded; an account already used by another vendor is refused;
--  * a vendor that is inactive, blacklisted or not prequalified cannot be put on an RFQ, quoted,
--    ordered (PO) or subcontracted (DB triggers, so every code path is covered);
--  * tax id unique per tenant (duplicate-vendor control).

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_tax_id_per_org ON vendors_subcontractors(org_id, tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS vendor_status_events (
    id          BIGSERIAL PRIMARY KEY,
    org_id      BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    vendor_id   BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    event       VARCHAR(30) NOT NULL CHECK (event IN ('created','details_changed','prequalification_approved','prequalification_rejected','prequalification_expired','blacklisted','unblacklisted','deactivated','reactivated','bank_details_changed')),
    reason      TEXT,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id    BIGINT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_events_vendor ON vendor_status_events(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_bank_change_requests (
    id                      BIGSERIAL PRIMARY KEY,
    org_id                  BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
    vendor_id               BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    new_bank_name           VARCHAR(150) NOT NULL,
    new_bank_account_no     VARCHAR(50) NOT NULL,
    reason                  TEXT NOT NULL,
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    requested_by            BIGINT NOT NULL REFERENCES users(id),
    decided_by              BIGINT REFERENCES users(id),
    decided_at              TIMESTAMPTZ,
    verification_method     VARCHAR(40) CHECK (verification_method IN ('callback_to_known_contact','in_person_verification','signed_bank_letter_verified','other_documented')),
    verification_reference  TEXT,
    decision_note           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (decided_by IS NULL OR decided_by <> requested_by),
    CHECK (status <> 'approved' OR (verification_method IS NOT NULL AND verification_reference IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_bank_change_pending ON vendor_bank_change_requests(vendor_id) WHERE status = 'pending';

-- Append-only event log.
CREATE OR REPLACE FUNCTION prevent_vendor_event_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'vendor_status_events is append-only'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_vendor_events_append_only ON vendor_status_events;
CREATE TRIGGER trg_vendor_events_append_only BEFORE UPDATE OR DELETE ON vendor_status_events FOR EACH ROW EXECUTE FUNCTION prevent_vendor_event_mutation();

-- Bank change requests: only pending -> approved/rejected; payload immutable; no deletes.
CREATE OR REPLACE FUNCTION guard_vendor_bank_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'vendor_bank_change_requests cannot be deleted'; END IF;
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved','rejected')
     OR (to_jsonb(NEW) - 'status' - 'decided_by' - 'decided_at' - 'verification_method' - 'verification_reference' - 'decision_note')
        <> (to_jsonb(OLD) - 'status' - 'decided_by' - 'decided_at' - 'verification_method' - 'verification_reference' - 'decision_note') THEN
    RAISE EXCEPTION 'vendor bank change request: only pending -> approved/rejected is permitted';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_vendor_bank_change_guard ON vendor_bank_change_requests;
CREATE TRIGGER trg_vendor_bank_change_guard BEFORE UPDATE OR DELETE ON vendor_bank_change_requests FOR EACH ROW EXECUTE FUNCTION guard_vendor_bank_change();

-- Governed columns on the vendor master.
CREATE OR REPLACE FUNCTION guard_vendor_governed_columns() RETURNS trigger AS $$
DECLARE governed boolean := coalesce(current_setting('app.vendor_governed', true), '') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Vendors cannot be deleted; deactivate instead'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT governed AND (NEW.prequalification_status <> 'pending' OR NEW.is_blacklisted OR NOT NEW.is_active
                         OR NEW.bank_name IS NOT NULL OR NEW.bank_account_no IS NOT NULL) THEN
      RAISE EXCEPTION 'New vendors start pending prequalification, active, not blacklisted and without bank details';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT governed AND (NEW.prequalification_status IS DISTINCT FROM OLD.prequalification_status
       OR NEW.is_blacklisted IS DISTINCT FROM OLD.is_blacklisted OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.bank_name IS DISTINCT FROM OLD.bank_name OR NEW.bank_account_no IS DISTINCT FROM OLD.bank_account_no
       OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    RAISE EXCEPTION 'Vendor status, prequalification, blacklist and bank details change only through governed workflows';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_vendor_governed_columns ON vendors_subcontractors;
CREATE TRIGGER trg_vendor_governed_columns BEFORE INSERT OR UPDATE OR DELETE ON vendors_subcontractors FOR EACH ROW EXECUTE FUNCTION guard_vendor_governed_columns();

-- Eligibility for new commercial engagements.
CREATE OR REPLACE FUNCTION enforce_vendor_eligibility() RETURNS trigger AS $$
DECLARE v vendors_subcontractors%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.vendor_id IS NOT DISTINCT FROM OLD.vendor_id THEN RETURN NEW; END IF;
  SELECT * INTO v FROM vendors_subcontractors WHERE id = NEW.vendor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vendor % not found', NEW.vendor_id; END IF;
  IF NOT v.is_active OR v.is_blacklisted OR v.prequalification_status <> 'approved' THEN
    RAISE EXCEPTION 'Vendor % is not eligible (active=%, blacklisted=%, prequalification=%)', v.id, v.is_active, v.is_blacklisted, v.prequalification_status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['rfq_vendors','vendor_quotations','purchase_orders','subcontracts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_vendor_eligibility ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_vendor_eligibility BEFORE INSERT OR UPDATE OF vendor_id ON %I FOR EACH ROW EXECUTE FUNCTION enforce_vendor_eligibility()', t);
  END LOOP;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['vendor_status_events','vendor_bank_change_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

-- vendors.* permissions for the System Admin role (same pattern as migration 010).
INSERT INTO permissions (role_id, module, action, scope)
SELECT r.id, x.module, x.action, 'all' FROM roles r
CROSS JOIN (VALUES ('vendors','view'), ('vendors','create'), ('vendors','edit'), ('vendors','approve')) AS x(module, action)
WHERE r.role_name = 'System Admin'
ON CONFLICT (role_id, module, action) DO NOTHING;
