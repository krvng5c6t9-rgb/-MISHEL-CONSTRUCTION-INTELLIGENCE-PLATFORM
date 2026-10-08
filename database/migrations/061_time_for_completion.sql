-- NDC-029 (Stage 9): approved time propagates to a controlled revised Time for Completion and LD exposure.
-- (transaction managed by migrator)
--  * Signed contract terms are frozen (defect found in Stage 9: PATCH /contracts/:id rewrote contract value, completion
--    period and LD rate of a signed/active contract). The commencement date may be recorded once after signing
--    (it is usually notified after signature) but never changed.
--  * time_for_completion_revisions: append-only; one row per decided source (claim, compensation event, agreed
--    variation) carrying the decided days; written by DB triggers when the human decision is recorded, never by AI.
--    Original completion = commencement + completion period (immutable); revised = original + cumulative days.
--    Days are calendar days (the contract periods in this platform are entered in days).
--  * contract_ld_terms: LD basis/rate/cap entered from the contract with a source reference and confirmed by a second
--    person. The legacy contracts.liquidated_damages_rate (undefined unit) is NOT used for exposure (F-20).
--  * contract_time_position(): original/revised completion, forecast (accepted programme finish or a stated date),
--    days late and LD exposure (capped) - information only; LD entitlement is never decided by the system.
-- Rollback: DROP FUNCTION contract_time_position(bigint,date); DROP TABLE time_for_completion_revisions, contract_ld_terms;
--           drop triggers trg_contract_terms_frozen, trg_tfc_from_claim, trg_tfc_from_ce, trg_tfc_from_variation.

-- 1. Signed terms frozen.
CREATE OR REPLACE FUNCTION guard_contract_terms_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.contract_status IN ('signed','active','closed','terminated') THEN
    IF (NEW.project_id, NEW.client_id, NEW.contract_type, NEW.contract_form, NEW.contract_value, NEW.currency_id, NEW.signing_date,
        NEW.completion_period_days, NEW.defects_liability_months, NEW.retention_percent, NEW.advance_payment_percent,
        NEW.performance_bond_percent, NEW.liquidated_damages_rate, NEW.org_id)
       IS DISTINCT FROM
       (OLD.project_id, OLD.client_id, OLD.contract_type, OLD.contract_form, OLD.contract_value, OLD.currency_id, OLD.signing_date,
        OLD.completion_period_days, OLD.defects_liability_months, OLD.retention_percent, OLD.advance_payment_percent,
        OLD.performance_bond_percent, OLD.liquidated_damages_rate, OLD.org_id) THEN
      RAISE EXCEPTION 'Contract % is signed: its terms are frozen (changes go through variations, claims or a formal amendment)', OLD.id;
    END IF;
    IF OLD.effective_date IS NOT NULL AND NEW.effective_date IS DISTINCT FROM OLD.effective_date THEN
      RAISE EXCEPTION 'Contract % commencement date is recorded and cannot be changed', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_terms_frozen ON contracts;
CREATE TRIGGER trg_contract_terms_frozen BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION guard_contract_terms_frozen();

-- 2. LD terms from the contract, confirmed by a second person.
CREATE TABLE IF NOT EXISTS contract_ld_terms (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')::bigint REFERENCES organizations(id),
  contract_id BIGINT NOT NULL UNIQUE REFERENCES contracts(id),
  basis VARCHAR(40) NOT NULL CHECK (basis IN ('amount_per_day','percent_of_contract_value_per_day')),
  rate NUMERIC(18,6) NOT NULL CHECK (rate > 0),
  cap_basis VARCHAR(40) NOT NULL CHECK (cap_basis IN ('none','amount','percent_of_contract_value')),
  cap_value NUMERIC(18,6),
  clause_ref VARCHAR(60) NOT NULL,
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) >= 3),
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  confirmed_by BIGINT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((cap_basis = 'none') = (cap_value IS NULL)),
  CHECK (cap_value IS NULL OR cap_value > 0),
  CHECK (basis <> 'percent_of_contract_value_per_day' OR rate <= 100),
  CHECK (cap_basis <> 'percent_of_contract_value' OR cap_value <= 100),
  CHECK (status = 'draft' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by <> created_by))
);
CREATE OR REPLACE FUNCTION guard_contract_ld_terms() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed LD terms cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed LD terms are immutable'; END IF;
  SELECT id, org_id INTO c FROM contracts WHERE id = NEW.contract_id;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Contract % not found in this organization', NEW.contract_id; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'LD terms start as draft'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.contract_id, NEW.org_id, NEW.created_by) IS DISTINCT FROM (OLD.contract_id, OLD.org_id, OLD.created_by) THEN
    RAISE EXCEPTION 'LD terms ownership cannot change';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contract_ld_terms ON contract_ld_terms;
CREATE TRIGGER trg_contract_ld_terms BEFORE INSERT OR UPDATE OR DELETE ON contract_ld_terms FOR EACH ROW EXECUTE FUNCTION guard_contract_ld_terms();

-- 3. Append-only Time for Completion revisions sourced from decided records.
CREATE TABLE IF NOT EXISTS time_for_completion_revisions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  revision_seq INT NOT NULL,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('claim','compensation_event','variation')),
  source_id BIGINT NOT NULL,
  days INT NOT NULL CHECK (days > 0),
  cumulative_days INT NOT NULL,
  decided_on DATE NOT NULL,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id),
  UNIQUE (contract_id, revision_seq)
);
CREATE OR REPLACE FUNCTION guard_tfc_revision() RETURNS trigger AS $$
DECLARE c record; ok boolean; prev int; seq int;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Time for Completion revisions are append-only'; END IF;
  SELECT id, org_id INTO c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Contract % not found in this organization', NEW.contract_id; END IF;
  IF NEW.source_type = 'claim' THEN
    SELECT EXISTS (SELECT 1 FROM contract_claims k WHERE k.id = NEW.source_id AND k.contract_id = NEW.contract_id AND k.org_id = NEW.org_id
                   AND k.status IN ('approved','partially_approved') AND k.approved_days = NEW.days) INTO ok;
  ELSIF NEW.source_type = 'compensation_event' THEN
    SELECT EXISTS (SELECT 1 FROM compensation_events e WHERE e.id = NEW.source_id AND e.contract_id = NEW.contract_id AND e.org_id = NEW.org_id
                   AND e.status IN ('accepted','pm_assessed') AND e.decided_time_days = NEW.days) INTO ok;
  ELSE
    SELECT EXISTS (SELECT 1 FROM variations v WHERE v.id = NEW.source_id AND v.contract_id = NEW.contract_id AND v.org_id = NEW.org_id
                   AND v.client_status = 'agreed' AND v.agreed_time_days = NEW.days) INTO ok;
  END IF;
  IF NOT ok THEN RAISE EXCEPTION 'A Time for Completion revision needs a decided % on this contract granting exactly % days', NEW.source_type, NEW.days; END IF;
  SELECT coalesce(max(revision_seq), 0), coalesce(max(cumulative_days), 0) INTO seq, prev FROM time_for_completion_revisions WHERE contract_id = NEW.contract_id;
  NEW.revision_seq := seq + 1;
  NEW.cumulative_days := prev + NEW.days;
  NEW.created_by := coalesce(NEW.created_by, NULLIF(current_setting('app.user_id', true), '')::bigint);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tfc_revision ON time_for_completion_revisions;
CREATE TRIGGER trg_tfc_revision BEFORE INSERT OR UPDATE OR DELETE ON time_for_completion_revisions FOR EACH ROW EXECUTE FUNCTION guard_tfc_revision();

-- One propagation function per source table (never a shared multi-table function: G-015 lesson).
CREATE OR REPLACE FUNCTION tfc_from_claim() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('approved','partially_approved') AND OLD.status IS DISTINCT FROM NEW.status AND coalesce(NEW.approved_days, 0) > 0 THEN
    IF NEW.contract_id IS NULL THEN RAISE EXCEPTION 'An extension of time needs the claim to be under a contract'; END IF;
    INSERT INTO time_for_completion_revisions(org_id, contract_id, revision_seq, source_type, source_id, days, cumulative_days, decided_on)
    VALUES (NEW.org_id, NEW.contract_id, 0, 'claim', NEW.id, NEW.approved_days, 0, current_date);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tfc_from_claim ON contract_claims;
CREATE TRIGGER trg_tfc_from_claim AFTER UPDATE ON contract_claims FOR EACH ROW EXECUTE FUNCTION tfc_from_claim();

CREATE OR REPLACE FUNCTION tfc_from_ce() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('accepted','pm_assessed') AND OLD.status IS DISTINCT FROM NEW.status AND coalesce(NEW.decided_time_days, 0) > 0 THEN
    INSERT INTO time_for_completion_revisions(org_id, contract_id, revision_seq, source_type, source_id, days, cumulative_days, decided_on)
    VALUES (NEW.org_id, NEW.contract_id, 0, 'compensation_event', NEW.id, NEW.decided_time_days, 0, coalesce(NEW.decision_on, current_date));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tfc_from_ce ON compensation_events;
CREATE TRIGGER trg_tfc_from_ce AFTER UPDATE ON compensation_events FOR EACH ROW EXECUTE FUNCTION tfc_from_ce();

CREATE OR REPLACE FUNCTION tfc_from_variation() RETURNS trigger AS $$
BEGIN
  IF NEW.client_status = 'agreed' AND OLD.client_status IS DISTINCT FROM NEW.client_status AND coalesce(NEW.agreed_time_days, 0) > 0 THEN
    INSERT INTO time_for_completion_revisions(org_id, contract_id, revision_seq, source_type, source_id, days, cumulative_days, decided_on)
    VALUES (NEW.org_id, NEW.contract_id, 0, 'variation', NEW.id, NEW.agreed_time_days, 0, coalesce(NEW.client_decided_on, current_date));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tfc_from_variation ON variations;
CREATE TRIGGER trg_tfc_from_variation AFTER UPDATE ON variations FOR EACH ROW EXECUTE FUNCTION tfc_from_variation();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['contract_ld_terms','time_for_completion_revisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

-- 4. Time / LD position (SECURITY INVOKER: RLS of the caller applies).
CREATE OR REPLACE FUNCTION contract_time_position(p_contract bigint, p_forecast date DEFAULT NULL)
RETURNS TABLE (contract_id bigint, commencement_date date, completion_period_days int, original_completion date,
               approved_extension_days int, revisions int, revised_completion date, forecast_completion date, forecast_source text,
               days_late int, ld_terms_status text, ld_daily_amount numeric, ld_gross numeric, ld_cap numeric, ld_exposure numeric,
               programme_update_outstanding boolean)
LANGUAGE sql STABLE AS $$
  WITH c AS (SELECT id, effective_date, completion_period_days, contract_value FROM contracts WHERE id = p_contract),
  r AS (SELECT coalesce(max(cumulative_days), 0)::int AS ext, count(*)::int AS n, max(created_at) AS last_at
        FROM time_for_completion_revisions WHERE time_for_completion_revisions.contract_id = p_contract),
  ap AS (SELECT max(a.planned_finish) AS finish FROM programme_submissions s JOIN programme_submission_activities a ON a.submission_id = s.id
         WHERE s.contract_id = p_contract AND s.status = 'accepted'),
  ls AS (SELECT max(s.created_at) AS last_sub FROM programme_submissions s WHERE s.contract_id = p_contract),
  ld AS (SELECT * FROM contract_ld_terms WHERE contract_ld_terms.contract_id = p_contract),
  base AS (
    SELECT c.id, c.effective_date, c.completion_period_days, c.contract_value, r.ext, r.n, r.last_at,
           (c.effective_date + c.completion_period_days) AS orig,
           coalesce(p_forecast, ap.finish) AS fc,
           CASE WHEN p_forecast IS NOT NULL THEN 'stated' WHEN ap.finish IS NOT NULL THEN 'accepted_programme' ELSE 'none' END AS fsrc,
           ls.last_sub
    FROM c CROSS JOIN r CROSS JOIN ap CROSS JOIN ls),
  calc AS (
    SELECT b.*, (b.orig + b.ext) AS rev,
           CASE WHEN b.orig IS NULL OR b.fc IS NULL THEN NULL ELSE greatest(0, b.fc - (b.orig + b.ext)) END AS late,
           ld.status AS lds,
           CASE WHEN ld.status <> 'confirmed' THEN NULL WHEN ld.basis = 'amount_per_day' THEN ld.rate ELSE b.contract_value * ld.rate / 100 END AS daily,
           CASE WHEN ld.status <> 'confirmed' OR ld.cap_basis = 'none' THEN NULL WHEN ld.cap_basis = 'amount' THEN ld.cap_value ELSE b.contract_value * ld.cap_value / 100 END AS cap
    FROM base b LEFT JOIN ld ON true)
  SELECT id, effective_date, completion_period_days, orig, ext, n, rev, fc, fsrc, late,
         coalesce(lds, 'not_recorded'),
         round(daily, 2), round(daily * late, 2), round(cap, 2),
         CASE WHEN daily IS NULL OR late IS NULL THEN NULL ELSE round(least(daily * late, coalesce(cap, daily * late)), 2) END,
         (n > 0 AND (last_sub IS NULL OR last_sub < last_at))
  FROM calc
$$;
