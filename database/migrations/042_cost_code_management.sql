-- G-014: cost-code management. Codes are tenant data; nothing is seeded here.
-- (transaction managed by migrator)
--  * global codes (project_id NULL) are unique per tenant (the table UNIQUE treats NULLs as distinct);
--  * once a code carries cost (cost_transactions), its code and cost type are frozen so historical
--    reports keep their meaning; description, unit and active flag stay editable;
--  * parent must be in the same tenant and scope (global parent for global codes; global or same-project
--    parent for project codes) and the hierarchy must stay acyclic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_codes_global ON cost_codes(org_id, code) WHERE project_id IS NULL;

CREATE OR REPLACE FUNCTION guard_cost_code() RETURNS trigger AS $$
DECLARE p cost_codes%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.code IS DISTINCT FROM OLD.code OR NEW.cost_type IS DISTINCT FROM OLD.cost_type
       OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.project_id IS DISTINCT FROM OLD.project_id)
     AND EXISTS (SELECT 1 FROM cost_transactions WHERE cost_code_id = OLD.id) THEN
    RAISE EXCEPTION 'Cost code % already carries cost; code, type and scope are frozen', OLD.code;
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Cost code project must belong to the same organization';
  END IF;
  IF NEW.parent_code_id IS NOT NULL THEN
    SELECT * INTO p FROM cost_codes WHERE id = NEW.parent_code_id;
    IF NOT FOUND OR p.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Parent cost code must belong to the same organization'; END IF;
    IF p.project_id IS NOT NULL AND p.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'Parent cost code must be global or belong to the same project';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
      WITH RECURSIVE up(id, parent) AS (
        SELECT id, parent_code_id FROM cost_codes WHERE id = NEW.parent_code_id
        UNION ALL SELECT c.id, c.parent_code_id FROM cost_codes c JOIN up ON c.id = up.parent)
      SELECT 1 FROM up WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'Cost code hierarchy cannot contain a cycle';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_cost_code ON cost_codes;
CREATE TRIGGER trg_guard_cost_code BEFORE INSERT OR UPDATE ON cost_codes FOR EACH ROW EXECUTE FUNCTION guard_cost_code();
