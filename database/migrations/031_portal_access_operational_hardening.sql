-- REV19 — Portal access operational and tenant-integrity hardening.

-- PostgreSQL UNIQUE treats NULL values as distinct. Prevent duplicate vendor-wide grants
-- where subcontract_id is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontractor_portal_vendor_wide_access
  ON subcontractor_portal_access(user_id, vendor_id)
  WHERE subcontract_id IS NULL;

CREATE OR REPLACE FUNCTION validate_portal_access_tenant() RETURNS TRIGGER AS $$
DECLARE p_org BIGINT; p_client BIGINT; v_org BIGINT; c_org BIGINT; u_org BIGINT; grantor_org BIGINT;
BEGIN
  SELECT org_id INTO u_org FROM users WHERE id=NEW.user_id;
  IF u_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'Portal user belongs to another organization';
  END IF;

  IF NEW.granted_by IS NOT NULL THEN
    SELECT org_id INTO grantor_org FROM users WHERE id=NEW.granted_by;
    IF grantor_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'Portal grantor belongs to another organization';
    END IF;
  END IF;

  IF TG_TABLE_NAME='client_portal_access' THEN
    SELECT org_id, client_id INTO p_org, p_client FROM projects WHERE id=NEW.project_id;
    SELECT org_id INTO c_org FROM clients WHERE id=NEW.client_id;
    IF p_org IS DISTINCT FROM NEW.org_id OR c_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'Client portal access crosses organization boundary';
    END IF;
    IF p_client IS NOT NULL AND p_client IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'Client portal access client does not own the selected project';
    END IF;
  ELSE
    SELECT org_id INTO v_org FROM vendors_subcontractors WHERE id=NEW.vendor_id;
    IF v_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'Subcontractor portal access crosses organization boundary';
    END IF;
    IF NEW.subcontract_id IS NOT NULL THEN
      PERFORM 1 FROM subcontracts s
       WHERE s.id=NEW.subcontract_id AND s.org_id=NEW.org_id AND s.vendor_id=NEW.vendor_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Subcontractor portal package does not belong to vendor/organization';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
