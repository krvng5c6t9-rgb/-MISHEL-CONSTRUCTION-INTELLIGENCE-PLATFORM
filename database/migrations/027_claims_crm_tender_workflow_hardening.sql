BEGIN;

ALTER TABLE contract_claims
  ADD COLUMN IF NOT EXISTS determined_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS determined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_decided_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS final_decided_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION enforce_contract_claim_sod() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved','partially_approved','rejected') THEN
    IF NEW.created_by IS NULL OR NEW.final_decided_by IS NULL THEN
      RAISE EXCEPTION 'claim maker and final decision maker must be recorded';
    END IF;
    IF NEW.created_by = NEW.final_decided_by THEN
      RAISE EXCEPTION 'segregation of duties: claim creator cannot make final decision';
    END IF;
  END IF;
  IF NEW.status IN ('approved','partially_approved') THEN
    IF NEW.claim_type <> 'cost' AND NEW.approved_days IS NULL THEN
      RAISE EXCEPTION 'approved_days required for EOT/combined claim';
    END IF;
    IF NEW.claim_type <> 'eot' AND NEW.approved_amount IS NULL THEN
      RAISE EXCEPTION 'approved_amount required for cost/combined claim';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contract_claim_sod ON contract_claims;
CREATE TRIGGER trg_contract_claim_sod BEFORE INSERT OR UPDATE ON contract_claims
FOR EACH ROW EXECUTE FUNCTION enforce_contract_claim_sod();

COMMIT;
