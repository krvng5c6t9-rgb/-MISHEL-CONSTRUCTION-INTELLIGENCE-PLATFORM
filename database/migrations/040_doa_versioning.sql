-- G-004 / F-04: DOA management with versioning and segregation of duties.
-- (transaction managed by migrator)
-- Rules (constitution: DOA configurable, versioned, auditable; no invented thresholds):
--  * a rule is a DRAFT until confirmed; drafts may be edited;
--  * confirmation must be done by a user other than the creator and the last editor;
--  * a confirmed rule is immutable: the only permitted change is retirement (is_active true->false
--    and/or setting effective_to), with a reason. Changes are made by a new draft that supersedes it;
--  * rules are never deleted (approval history references them);
--  * the approver role must belong to the same tenant.

ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS last_edited_by BIGINT REFERENCES users(id);
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS supersedes_id BIGINT REFERENCES delegation_of_authority(id);
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS retired_by BIGINT REFERENCES users(id);
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS retired_reason TEXT;
ALTER TABLE delegation_of_authority ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION guard_doa_lifecycle() RETURNS trigger AS $$
DECLARE role_org bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DOA rules cannot be deleted; retire them instead'; END IF;
  SELECT org_id INTO role_org FROM roles WHERE id = NEW.approver_role_id;
  IF role_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'DOA approver role must belong to the same organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_confirmed THEN RAISE EXCEPTION 'DOA rules are created as drafts and confirmed separately'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.is_confirmed THEN
    -- Retirement only.
    IF (to_jsonb(NEW) - 'is_active' - 'effective_to' - 'retired_by' - 'retired_at' - 'retired_reason' - 'updated_at')
       <> (to_jsonb(OLD) - 'is_active' - 'effective_to' - 'retired_by' - 'retired_at' - 'retired_reason' - 'updated_at')
       OR (NEW.is_active AND NOT OLD.is_active)
       OR NEW.retired_by IS NULL OR NEW.retired_reason IS NULL THEN
      RAISE EXCEPTION 'Confirmed DOA rule % is immutable; retire it with a reason and create a superseding draft', OLD.id;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_confirmed THEN
    IF NEW.confirmed_by IS NULL OR NEW.confirmed_by = NEW.created_by OR NEW.confirmed_by = NEW.last_edited_by THEN
      RAISE EXCEPTION 'DOA rule must be confirmed by a user other than its creator and last editor';
    END IF;
    IF NOT NEW.is_active THEN RAISE EXCEPTION 'Only an active draft can be confirmed'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_doa_lifecycle ON delegation_of_authority;
CREATE TRIGGER trg_doa_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON delegation_of_authority FOR EACH ROW EXECUTE FUNCTION guard_doa_lifecycle();
