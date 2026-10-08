-- CC-034 (NDC-002 remainder): compensation-event register, FIDIC-style determination / dispute ladder on claims,
-- and claim gating on notices. Periods are never invented: deadlines come only from confirmed contract obligation
-- rules (Contract Data Pack, CC-021). Lateness is recorded and shown; legal consequences stay a human decision.
-- (transaction managed by migrator)
ALTER TABLE contract_obligation_rules DROP CONSTRAINT IF EXISTS contract_obligation_rules_obligation_type_check;
ALTER TABLE contract_obligation_rules ADD CONSTRAINT contract_obligation_rules_obligation_type_check CHECK (obligation_type IN
  ('notice_of_claim','notice_of_delay','early_warning','variation_notice','notice_of_dispute','response_due','particulars_due','quotation_due','other'));
-- Compensation events carry event_id directly (no extra event-link type, which would bypass the link guard).

-- Rule lookup: confirmed rule of the given type on the given contract, else error.
CREATE OR REPLACE FUNCTION contract_rule_period(p_rule bigint, p_contract bigint, p_type text, p_from date) RETURNS date AS $$
DECLARE r record;
BEGIN
  IF p_rule IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM contract_obligation_rules WHERE id = p_rule;
  IF r.id IS NULL OR r.contract_id <> p_contract OR r.status <> 'confirmed' OR r.obligation_type <> p_type THEN
    RAISE EXCEPTION 'Rule % must be a confirmed % rule of this contract', p_rule, p_type;
  END IF;
  RETURN compute_notice_deadline(p_from, r.period_value, r.period_unit);
END $$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS compensation_events (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  event_id BIGINT NOT NULL REFERENCES contract_events(id),
  ce_no VARCHAR(30) NOT NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) >= 5),
  notified_on DATE NOT NULL,
  quotation_rule_id BIGINT REFERENCES contract_obligation_rules(id),
  quotation_due DATE,
  reply_rule_id BIGINT REFERENCES contract_obligation_rules(id),
  reply_due DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'notified' CHECK (status IN ('notified','quotation_submitted','accepted','pm_assessed','not_a_ce','withdrawn')),
  quotation_amount NUMERIC(18,2), quotation_time_days INT, quotation_submitted_on DATE, quotation_by BIGINT REFERENCES users(id),
  decision_on DATE, decision_reference TEXT, decided_amount NUMERIC(18,2), decided_time_days INT, decision_reason TEXT, decision_recorded_by BIGINT REFERENCES users(id),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, ce_no)
);
CREATE OR REPLACE FUNCTION guard_compensation_event() RETURNS trigger AS $$
DECLARE c record; e record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Compensation events cannot be deleted; withdraw them'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT id, org_id, contract_status INTO c FROM contracts WHERE id = NEW.contract_id;
    IF c.id IS NULL OR c.org_id <> NEW.org_id OR c.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'Compensation events need a signed or active contract'; END IF;
    SELECT id, contract_id, became_aware_on INTO e FROM contract_events WHERE id = NEW.event_id;
    IF e.id IS NULL OR e.contract_id <> NEW.contract_id THEN RAISE EXCEPTION 'Compensation event must arise from an event of the same contract'; END IF;
    IF NEW.notified_on < e.became_aware_on OR NEW.notified_on > current_date THEN RAISE EXCEPTION 'Notification date must be between awareness of the event and today'; END IF;
    IF NEW.status <> 'notified' THEN RAISE EXCEPTION 'Compensation events start as notified'; END IF;
    NEW.quotation_due := contract_rule_period(NEW.quotation_rule_id, NEW.contract_id, 'quotation_due', NEW.notified_on);
    RETURN NEW;
  END IF;
  IF OLD.status IN ('accepted','pm_assessed','not_a_ce','withdrawn') THEN RAISE EXCEPTION 'Compensation event % is decided and immutable', OLD.id; END IF;
  IF (NEW.contract_id, NEW.event_id, NEW.ce_no, NEW.notified_on, NEW.quotation_rule_id, NEW.created_by) IS DISTINCT FROM (OLD.contract_id, OLD.event_id, OLD.ce_no, OLD.notified_on, OLD.quotation_rule_id, OLD.created_by) THEN
    RAISE EXCEPTION 'Compensation event identity is immutable';
  END IF;
  IF NEW.status = 'quotation_submitted' AND OLD.status = 'notified' THEN
    IF NEW.quotation_amount IS NULL OR NEW.quotation_time_days IS NULL OR NEW.quotation_time_days < 0 OR NEW.quotation_submitted_on IS NULL OR NEW.quotation_by IS NULL THEN
      RAISE EXCEPTION 'A quotation needs amount, time, date and preparer';
    END IF;
    IF NEW.quotation_submitted_on < NEW.notified_on OR NEW.quotation_submitted_on > current_date THEN RAISE EXCEPTION 'Quotation date must be between notification and today'; END IF;
    NEW.reply_due := contract_rule_period(NEW.reply_rule_id, NEW.contract_id, 'response_due', NEW.quotation_submitted_on);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('accepted','pm_assessed','not_a_ce') THEN
    IF NEW.decision_on IS NULL OR length(trim(coalesce(NEW.decision_reference,''))) < 3 OR NEW.decision_recorded_by IS NULL THEN RAISE EXCEPTION 'A decision needs date, reference and recorder'; END IF;
    IF NEW.decision_recorded_by = NEW.quotation_by OR NEW.decision_recorded_by = NEW.created_by THEN RAISE EXCEPTION 'The decision must be recorded by someone other than the notifier and the quotation preparer'; END IF;
    IF NEW.decision_on < coalesce(NEW.quotation_submitted_on, NEW.notified_on) OR NEW.decision_on > current_date THEN RAISE EXCEPTION 'Decision date out of sequence'; END IF;
    IF NEW.status = 'accepted' THEN
      IF OLD.status <> 'quotation_submitted' THEN RAISE EXCEPTION 'Only a submitted quotation can be accepted'; END IF;
      NEW.decided_amount := NEW.quotation_amount; NEW.decided_time_days := NEW.quotation_time_days;
    ELSIF NEW.status = 'pm_assessed' THEN
      IF NEW.decided_amount IS NULL OR NEW.decided_time_days IS NULL OR length(trim(coalesce(NEW.decision_reason,''))) < 5 THEN RAISE EXCEPTION 'A PM assessment needs amount, time and reasons'; END IF;
    ELSE
      IF length(trim(coalesce(NEW.decision_reason,''))) < 5 THEN RAISE EXCEPTION 'A "not a compensation event" decision needs reasons'; END IF;
      NEW.decided_amount := NULL; NEW.decided_time_days := NULL;
    END IF;
  ELSIF NEW.status = 'withdrawn' THEN
    IF length(trim(coalesce(NEW.decision_reason,''))) < 5 THEN RAISE EXCEPTION 'Withdrawal needs a reason'; END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Invalid compensation event transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_compensation_event_guard ON compensation_events;
CREATE TRIGGER trg_compensation_event_guard BEFORE INSERT OR UPDATE OR DELETE ON compensation_events FOR EACH ROW EXECUTE FUNCTION guard_compensation_event();

-- FIDIC-style determination / dispute ladder (append-only), and claim gating.
ALTER TABLE contract_claims ADD COLUMN IF NOT EXISTS time_bar_position TEXT;
CREATE TABLE IF NOT EXISTS claim_dispute_steps (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  claim_id BIGINT NOT NULL REFERENCES contract_claims(id),
  step VARCHAR(30) NOT NULL CHECK (step IN ('engineer_determination','notice_of_dissatisfaction','daab_referral','daab_decision','amicable_settlement','arbitration_referral')),
  occurred_on DATE NOT NULL,
  reference TEXT NOT NULL CHECK (length(trim(reference)) >= 3),
  determined_days INT, determined_amount NUMERIC(18,2),
  rule_id BIGINT REFERENCES contract_obligation_rules(id),
  deadline DATE, late BOOLEAN,
  recorded_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION guard_claim_dispute_step() RETURNS trigger AS $$
DECLARE k record; prev record; has text[];
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'claim_dispute_steps is append-only'; END IF;
  SELECT * INTO k FROM contract_claims WHERE id = NEW.claim_id FOR UPDATE;
  IF k.id IS NULL OR k.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF k.status IN ('draft','notified','withdrawn') THEN RAISE EXCEPTION 'Dispute steps start only after the claim is submitted'; END IF;
  IF NEW.occurred_on > current_date THEN RAISE EXCEPTION 'Dispute steps cannot be future-dated'; END IF;
  SELECT array_agg(step) INTO has FROM claim_dispute_steps WHERE claim_id = NEW.claim_id;
  has := coalesce(has, ARRAY[]::text[]);
  IF NEW.step = ANY(has) THEN RAISE EXCEPTION 'Step % already recorded for this claim', NEW.step; END IF;
  SELECT * INTO prev FROM claim_dispute_steps WHERE claim_id = NEW.claim_id ORDER BY occurred_on DESC, id DESC LIMIT 1;
  IF prev.id IS NOT NULL AND NEW.occurred_on < prev.occurred_on THEN RAISE EXCEPTION 'Dispute steps must be in date order'; END IF;
  IF NEW.step = 'engineer_determination' THEN
    IF NEW.determined_days IS NULL AND NEW.determined_amount IS NULL THEN RAISE EXCEPTION 'A determination states days and/or amount'; END IF;
    IF NEW.determined_days > k.claimed_days OR NEW.determined_amount > k.claimed_amount OR NEW.determined_days < 0 OR NEW.determined_amount < 0 THEN
      RAISE EXCEPTION 'Determination cannot exceed the claim';
    END IF;
  ELSIF NEW.step = 'notice_of_dissatisfaction' THEN
    SELECT * INTO prev FROM claim_dispute_steps WHERE claim_id = NEW.claim_id AND step = 'engineer_determination';
    IF prev.id IS NULL THEN RAISE EXCEPTION 'A notice of dissatisfaction follows a determination'; END IF;
    NEW.deadline := contract_rule_period(NEW.rule_id, k.contract_id, 'notice_of_dispute', prev.occurred_on);
    NEW.late := CASE WHEN NEW.deadline IS NULL THEN NULL ELSE NEW.occurred_on > NEW.deadline END;
  ELSIF NEW.step = 'daab_referral' AND NOT ('notice_of_dissatisfaction' = ANY(has)) THEN RAISE EXCEPTION 'DAAB referral follows a notice of dissatisfaction';
  ELSIF NEW.step = 'daab_decision' AND NOT ('daab_referral' = ANY(has)) THEN RAISE EXCEPTION 'A DAAB decision follows a referral';
  ELSIF NEW.step = 'arbitration_referral' AND NOT ('daab_decision' = ANY(has)) THEN RAISE EXCEPTION 'Arbitration follows a DAAB decision';
  ELSIF NEW.step = 'amicable_settlement' AND NOT ('notice_of_dissatisfaction' = ANY(has)) THEN RAISE EXCEPTION 'Amicable settlement follows a notice of dissatisfaction';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_claim_dispute_step ON claim_dispute_steps;
CREATE TRIGGER trg_claim_dispute_step BEFORE INSERT OR UPDATE OR DELETE ON claim_dispute_steps FOR EACH ROW EXECUTE FUNCTION guard_claim_dispute_step();

-- Claim gating: submission needs an issued notice of the claim event; a late condition-precedent notice needs a
-- recorded human time-bar position (the platform never decides entitlement).
CREATE OR REPLACE FUNCTION guard_claim_gating() RETURNS trigger AS $$
DECLARE n record;
BEGIN
  IF NEW.status = 'submitted' AND OLD.status = 'notified' THEN
    SELECT cn.status, cn.issued_late, r.is_condition_precedent INTO n FROM contract_notices cn JOIN contract_obligation_rules r ON r.id = cn.rule_id WHERE cn.id = NEW.notice_id;
    IF n.status IS NULL OR n.status NOT IN ('issued','acknowledged') THEN RAISE EXCEPTION 'A claim is submitted only with an issued notice of the claim event'; END IF;
    IF n.issued_late AND n.is_condition_precedent AND length(trim(coalesce(NEW.time_bar_position,''))) < 10 THEN
      RAISE EXCEPTION 'The notice was issued late on a condition-precedent clause: record the time-bar position before submitting';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_claim_gating ON contract_claims;
CREATE TRIGGER trg_claim_gating BEFORE UPDATE ON contract_claims FOR EACH ROW EXECUTE FUNCTION guard_claim_gating();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['compensation_events','claim_dispute_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
