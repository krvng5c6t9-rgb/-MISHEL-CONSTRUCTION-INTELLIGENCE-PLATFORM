-- CC-030 (RK-003 / GC-16): claim / EOT lifecycle integrity - first runtime execution (sweep_claims.mjs).
-- CL1 claims accepted with no contract, on unsigned contracts, with a notice dated before the event, and with a
--     notice belonging to another event; claims had no link to the contract event / notice (NDC-002 separation).
-- CL2 submission with no claimed entitlement or basis; CL3 determination above the claim, by the claim's author,
--     with no reason; "approved" with a determination below the claim; final decision and withdrawal with no reason.
-- CL4 decided claims mutable and deletable at DB level; claimed entitlement editable after submission (STEP09:
--     a determination never rewrites the original entitlement).
-- (transaction managed by migrator)
ALTER TABLE contract_claims ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES contract_events(id);
ALTER TABLE contract_claims ADD COLUMN IF NOT EXISTS notice_id BIGINT REFERENCES contract_notices(id);
ALTER TABLE contract_claims ADD COLUMN IF NOT EXISTS determination_reason TEXT;
ALTER TABLE contract_claims ADD COLUMN IF NOT EXISTS decision_reason TEXT;

CREATE OR REPLACE FUNCTION guard_contract_claim() RETURNS trigger AS $$
DECLARE c record; e record; n record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft claims can be deleted; withdraw it instead'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved','partially_approved','rejected','withdrawn') THEN
    RAISE EXCEPTION 'Claim % is decided (%) and immutable', OLD.id, OLD.status;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Claims start as draft'; END IF;
    IF NEW.contract_id IS NULL THEN RAISE EXCEPTION 'A claim must be raised under a contract'; END IF;
  END IF;
  IF TG_OP = 'INSERT' OR (NEW.contract_id, NEW.project_id, NEW.event_id, NEW.notice_id) IS DISTINCT FROM (OLD.contract_id, OLD.project_id, OLD.event_id, OLD.notice_id) THEN
    SELECT id, org_id, project_id, contract_status INTO c FROM contracts WHERE id = NEW.contract_id;
    IF c.id IS NULL OR c.org_id <> NEW.org_id OR c.project_id <> NEW.project_id THEN RAISE EXCEPTION 'Claim contract must belong to the same organization and project'; END IF;
    IF c.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'Claims can only be raised under a signed or active contract (status %)', c.contract_status; END IF;
    IF NEW.event_id IS NOT NULL THEN
      SELECT id, contract_id INTO e FROM contract_events WHERE id = NEW.event_id;
      IF e.id IS NULL OR e.contract_id <> NEW.contract_id THEN RAISE EXCEPTION 'Claim event must belong to the claim contract'; END IF;
    END IF;
    IF NEW.notice_id IS NOT NULL THEN
      SELECT id, event_id, contract_id INTO n FROM contract_notices WHERE id = NEW.notice_id;
      IF n.id IS NULL OR n.contract_id <> NEW.contract_id OR NEW.event_id IS NULL OR n.event_id <> NEW.event_id THEN
        RAISE EXCEPTION 'Claim notice must be a notice of the claim event';
      END IF;
    END IF;
  END IF;
  IF NEW.event_date IS NOT NULL AND NEW.notice_date IS NOT NULL AND NEW.notice_date < NEW.event_date THEN
    RAISE EXCEPTION 'Notice date % is before the event date %', NEW.notice_date, NEW.event_date;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Original entitlement is frozen once submitted.
    IF OLD.status NOT IN ('draft','notified') AND (NEW.claimed_days, NEW.claimed_amount, NEW.claim_type, NEW.basis, NEW.event_date, NEW.notice_date)
         IS DISTINCT FROM (OLD.claimed_days, OLD.claimed_amount, OLD.claim_type, OLD.basis, OLD.event_date, OLD.notice_date) THEN
      RAISE EXCEPTION 'Claimed entitlement of claim % is frozen after submission', OLD.id;
    END IF;
    IF NEW.status = 'notified' AND OLD.status = 'draft' AND NEW.notice_date IS NULL AND NOT EXISTS (SELECT 1 FROM contract_notices WHERE id = NEW.notice_id AND status IN ('issued','acknowledged')) THEN
      RAISE EXCEPTION 'A claim is notified only with a notice date or an issued notice';
    END IF;
    IF NEW.status = 'submitted' AND OLD.status = 'notified' THEN
      IF length(trim(coalesce(NEW.basis,''))) < 10 THEN RAISE EXCEPTION 'Submission requires the contractual basis'; END IF;
      IF NEW.claim_type IN ('eot','combined') AND NEW.claimed_days <= 0 THEN RAISE EXCEPTION 'An EOT/combined claim needs claimed days'; END IF;
      IF NEW.claim_type IN ('cost','combined') AND NEW.claimed_amount <= 0 THEN RAISE EXCEPTION 'A cost/combined claim needs a claimed amount'; END IF;
    END IF;
    IF (NEW.approved_days, NEW.approved_amount) IS DISTINCT FROM (OLD.approved_days, OLD.approved_amount) THEN
      IF NEW.determined_by IS NULL OR NEW.determined_by = NEW.created_by THEN RAISE EXCEPTION 'The claim author cannot determine the claim'; END IF;
      IF length(trim(coalesce(NEW.determination_reason,''))) < 5 THEN RAISE EXCEPTION 'A determination needs its reasoning'; END IF;
    END IF;
  END IF;
  IF NEW.approved_days IS NOT NULL AND (NEW.approved_days < 0 OR NEW.approved_days > NEW.claimed_days) THEN RAISE EXCEPTION 'Determined days % exceed claimed days %', NEW.approved_days, NEW.claimed_days; END IF;
  IF NEW.approved_amount IS NOT NULL AND (NEW.approved_amount < 0 OR NEW.approved_amount > NEW.claimed_amount) THEN RAISE EXCEPTION 'Determined amount % exceeds claimed amount %', NEW.approved_amount, NEW.claimed_amount; END IF;
  IF NEW.status IN ('approved','partially_approved','rejected','withdrawn') AND length(trim(coalesce(NEW.decision_reason,''))) < 5 THEN
    RAISE EXCEPTION 'A final decision or withdrawal needs a reason';
  END IF;
  IF NEW.status = 'approved' AND ((NEW.claim_type <> 'cost' AND NEW.approved_days IS DISTINCT FROM NEW.claimed_days) OR (NEW.claim_type <> 'eot' AND NEW.approved_amount IS DISTINCT FROM NEW.claimed_amount)) THEN
    RAISE EXCEPTION 'Determination is below the claim: use partially_approved';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_claim_guard ON contract_claims;
CREATE TRIGGER trg_contract_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_claims FOR EACH ROW EXECUTE FUNCTION guard_contract_claim();
