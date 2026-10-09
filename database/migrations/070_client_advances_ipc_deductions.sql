-- Stage 21 / GC-13 step 3 (F-32): client advance payments and their recovery on client IPCs, retention within the
-- contract percentage, and "less previous certified" bounded by what was certified. (transaction managed by migrator)
-- Before (E1 SW-GC13_ipc_deductions_BEFORE_fix_sd2.txt): on a signed 5%-retention contract with no advance provision,
-- an IPC with retention 60,000 on 300,000 gross (20%), advance recovery 20,000 with no advance ever received, and
-- "less previous" 200,000 when only 95,000 had ever been certified was accepted and submitted to the client.
-- Now:
--  * a client advance is recorded only where the signed/active contract provides one (advance_payment_percent), within
--    that percentage of the contract value; approved by someone other than its preparer; recorded as received (receipt
--    reference) by someone other than its preparer; only received advances are recovered;
--  * recovery never exceeds the outstanding received advance; where the advance carries the contract's recovery rate,
--    the IPC recovery must equal min(rate x gross work done this period, outstanding). Basis = gross work done this
--    period (materials on site excluded) - contracts that amortise on another basis or start recovery after a
--    threshold record no rate and enter the recovery manually within the outstanding cap (F-34);
--  * retention never above the contract retention percentage of (gross this period + materials on site) when the
--    contract states one; retention limits (caps on total retention) are not modelled;
--  * less previous certified never above the total net of earlier client-approved / posted / paid IPCs of the contract;
--  * checks run at creation and again, serialised per contract, when the IPC leaves draft.
-- Also corrects CC-049: the subcontract "less previous" cap and position summed net + previous (overcounts under the
-- cumulative model); both now use the sum of nets.
-- GL treatment of client advances (liability) remains with DEC-009/DEC-012; nothing is posted here.
-- Rollback: DROP TRIGGER trg_ipc_deductions ON ipcs; DROP TABLE client_advances; re-apply the 069 functions.

CREATE TABLE IF NOT EXISTS client_advances (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  recovery_percent NUMERIC(5,2) CHECK (recovery_percent IS NULL OR (recovery_percent > 0 AND recovery_percent <= 100)),
  guarantee_ref TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','received')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  received_by BIGINT REFERENCES users(id),
  received_at TIMESTAMPTZ,
  receipt_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_by <> created_by AND approved_at IS NOT NULL)),
  CHECK (status <> 'received' OR (received_by IS NOT NULL AND received_by <> created_by AND received_at IS NOT NULL AND length(trim(coalesce(receipt_reference,''))) >= 3))
);
CREATE INDEX IF NOT EXISTS idx_client_advances_contract ON client_advances(contract_id);

CREATE OR REPLACE FUNCTION guard_client_advance() RETURNS trigger AS $$
DECLARE c record; total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft client advance can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, contract_status, contract_value, advance_payment_percent INTO c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Contract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A client advance starts as draft'; END IF;
    IF c.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'Client advances are recorded only under a signed or active contract (contract % is %)', c.id, c.contract_status; END IF;
    IF c.advance_payment_percent IS NULL OR c.advance_payment_percent <= 0 THEN
      RAISE EXCEPTION 'Contract % provides no advance payment (advance_payment_percent not set)', c.id;
    END IF;
    SELECT coalesce(sum(amount), 0) INTO total FROM client_advances WHERE contract_id = NEW.contract_id;
    IF total + NEW.amount > round(c.contract_value * c.advance_payment_percent / 100, 2) THEN
      RAISE EXCEPTION 'Client advances % exceed % percent of the contract value %', total + NEW.amount, c.advance_payment_percent, c.contract_value;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.org_id, NEW.contract_id, NEW.amount, NEW.recovery_percent, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.org_id, OLD.contract_id, OLD.amount, OLD.recovery_percent, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Client advance % is approved; its terms are frozen', OLD.id;
  END IF;
  IF OLD.status = 'received' THEN RAISE EXCEPTION 'Client advance % is received and immutable', OLD.id; END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status IN ('draft','approved')) OR (OLD.status = 'approved' AND NEW.status = 'received')) THEN
    RAISE EXCEPTION 'Invalid client advance transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_client_advance ON client_advances;
CREATE TRIGGER trg_client_advance BEFORE INSERT OR UPDATE OR DELETE ON client_advances FOR EACH ROW EXECUTE FUNCTION guard_client_advance();

CREATE OR REPLACE FUNCTION guard_ipc_deductions() RETURNS trigger AS $$
DECLARE c record; received numeric; recovered numeric; outstanding numeric; rate_part numeric; rated int; expected numeric; prev_net numeric;
BEGIN
  IF NOT (TG_OP = 'INSERT' OR (OLD.status = 'draft' AND NEW.status = 'submitted_to_client')) THEN RETURN NEW; END IF;
  SELECT id, retention_percent INTO c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF c.retention_percent IS NOT NULL AND NEW.less_retention > round((NEW.gross_work_done_this_period + NEW.materials_on_site_value) * c.retention_percent / 100, 2) THEN
    RAISE EXCEPTION 'Retention % exceeds % percent of gross this period plus materials on site %', NEW.less_retention, c.retention_percent, NEW.gross_work_done_this_period + NEW.materials_on_site_value;
  END IF;
  SELECT coalesce(sum(amount), 0), coalesce(sum(round(NEW.gross_work_done_this_period * recovery_percent / 100, 2)), 0), count(recovery_percent)
    INTO received, rate_part, rated FROM client_advances WHERE contract_id = NEW.contract_id AND status = 'received';
  SELECT coalesce(sum(less_advance_recovery), 0) INTO recovered FROM ipcs
    WHERE contract_id = NEW.contract_id AND id IS DISTINCT FROM NEW.id AND status <> 'draft';
  outstanding := received - recovered;
  IF NEW.less_advance_recovery > outstanding THEN
    RAISE EXCEPTION 'Advance recovery % exceeds the outstanding received advance % (received %, already recovered %)', NEW.less_advance_recovery, outstanding, received, recovered;
  END IF;
  IF rated > 0 THEN
    expected := least(rate_part, outstanding);
    IF NEW.less_advance_recovery <> expected THEN
      RAISE EXCEPTION 'Advance recovery % differs from the recovery due % (recorded rate on gross this period %, capped at outstanding %)', NEW.less_advance_recovery, expected, NEW.gross_work_done_this_period, outstanding;
    END IF;
  END IF;
  SELECT coalesce(sum(net_amount_due), 0) INTO prev_net FROM ipcs
    WHERE contract_id = NEW.contract_id AND id IS DISTINCT FROM NEW.id AND status IN ('client_approved','posted','paid');
  IF NEW.less_previous_certified > prev_net THEN
    RAISE EXCEPTION 'Less previous certified % exceeds the net certified on earlier client-approved IPCs %', NEW.less_previous_certified, prev_net;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ipc_deductions ON ipcs;
CREATE TRIGGER trg_ipc_deductions BEFORE INSERT OR UPDATE OF status ON ipcs FOR EACH ROW EXECUTE FUNCTION guard_ipc_deductions();

CREATE OR REPLACE FUNCTION client_advance_position(p_contract BIGINT) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'contract_id', c.id,
    'advance_limit', CASE WHEN c.advance_payment_percent IS NULL THEN NULL ELSE round(c.contract_value * c.advance_payment_percent / 100, 2) END,
    'advances_recorded', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id),
    'advances_received', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id AND status = 'received'),
    'advance_recovered', (SELECT coalesce(sum(less_advance_recovery), 0) FROM ipcs WHERE contract_id = c.id AND status <> 'draft'),
    'advance_outstanding', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id AND status = 'received')
                         - (SELECT coalesce(sum(less_advance_recovery), 0) FROM ipcs WHERE contract_id = c.id AND status <> 'draft'),
    'net_certified', (SELECT coalesce(sum(net_amount_due), 0) FROM ipcs WHERE contract_id = c.id AND status IN ('client_approved','posted','paid')))
  FROM contracts c WHERE c.id = p_contract
$$ LANGUAGE sql STABLE;

ALTER TABLE client_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON client_advances;
DROP POLICY IF EXISTS tenant_isolation_write ON client_advances;
CREATE POLICY tenant_isolation_select ON client_advances FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON client_advances FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);

-- CC-049 correction (subcontract side).
CREATE OR REPLACE FUNCTION guard_subcontract_certificate_integrity() RETURNS trigger AS $$
DECLARE s subcontracts%ROWTYPE; line_total numeric; line_count int;
        paid_adv numeric; recovered numeric; outstanding numeric; rate_part numeric; rated int; expected numeric;
        bc_total numeric; prev_net numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft subcontract certificates can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO s FROM subcontracts WHERE id = NEW.subcontract_id;
  IF TG_OP = 'INSERT' THEN
    IF s.status <> 'active' THEN RAISE EXCEPTION 'Certificates can only be raised against an active (approved) subcontract; subcontract % is %', s.id, s.status; END IF;
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Certificates start as draft'; END IF;
    RETURN NEW;
  END IF;
  -- Valuation fields are frozen once the certificate leaves draft.
  IF OLD.status <> 'draft' AND (NEW.gross_work_done, NEW.less_retention, NEW.less_advance_recovery, NEW.less_previous_paid, NEW.penalties_deductions, NEW.subcontract_id, NEW.project_id, NEW.period_from, NEW.period_to)
       IS DISTINCT FROM (OLD.gross_work_done, OLD.less_retention, OLD.less_advance_recovery, OLD.less_previous_paid, OLD.penalties_deductions, OLD.subcontract_id, OLD.project_id, OLD.period_from, OLD.period_to) THEN
    RAISE EXCEPTION 'Subcontract certificate valuation is frozen after draft';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'site_verified' THEN
    -- Serialise deduction checks per subcontract (two certificates must not recover the same advance).
    PERFORM 1 FROM subcontracts WHERE id = NEW.subcontract_id FOR UPDATE;
    SELECT coalesce(sum(amount), 0), count(*) INTO line_total, line_count FROM subcontract_certificate_lines WHERE certificate_id = NEW.id;
    IF line_count > 0 AND line_total <> NEW.gross_work_done THEN
      RAISE EXCEPTION 'Certificate gross % does not equal the sum of its lines %', NEW.gross_work_done, line_total;
    END IF;
    IF s.retention_percent IS NOT NULL AND NEW.less_retention > round(NEW.gross_work_done * s.retention_percent / 100, 2) THEN
      RAISE EXCEPTION 'Retention % exceeds % percent of gross %', NEW.less_retention, s.retention_percent, NEW.gross_work_done;
    END IF;
    -- Advance recovery: only of paid advances, never above the outstanding balance, at the recorded rate when one exists.
    SELECT coalesce(sum(amount), 0), coalesce(sum(round(NEW.gross_work_done * recovery_percent / 100, 2)), 0), count(recovery_percent)
      INTO paid_adv, rate_part, rated FROM subcontract_advances WHERE subcontract_id = NEW.subcontract_id AND status = 'paid';
    SELECT coalesce(sum(less_advance_recovery), 0) INTO recovered FROM subcontract_certificates
      WHERE subcontract_id = NEW.subcontract_id AND id <> NEW.id AND status <> 'draft';
    outstanding := paid_adv - recovered;
    IF NEW.less_advance_recovery > outstanding THEN
      RAISE EXCEPTION 'Advance recovery % exceeds the outstanding paid advance % (paid %, already recovered %)', NEW.less_advance_recovery, outstanding, paid_adv, recovered;
    END IF;
    IF rated > 0 THEN
      expected := least(rate_part, outstanding);
      IF NEW.less_advance_recovery <> expected THEN
        RAISE EXCEPTION 'Advance recovery % differs from the recovery due % (recorded rate on gross %, capped at outstanding %)', NEW.less_advance_recovery, expected, NEW.gross_work_done, outstanding;
      END IF;
    END IF;
    -- Back-charges: the deduction is exactly the approved back-charges applied to this certificate.
    SELECT coalesce(sum(amount), 0) INTO bc_total FROM subcontract_backcharges WHERE certificate_id = NEW.id AND status = 'applied';
    IF NEW.penalties_deductions <> bc_total THEN
      RAISE EXCEPTION 'Deductions % must equal the back-charges applied to this certificate %', NEW.penalties_deductions, bc_total;
    END IF;
    -- Less previous: never more than the total net certified on earlier approved certificates (sum of nets is the
    -- amount certified to date under both periodic and cumulative valuation; 069 summed net + previous, which
    -- overcounts under the cumulative model).
    SELECT coalesce(sum(net_amount_due), 0) INTO prev_net FROM subcontract_certificates
      WHERE subcontract_id = NEW.subcontract_id AND id <> NEW.id AND status IN ('approved','posted','paid');
    IF NEW.less_previous_paid > prev_net THEN
      RAISE EXCEPTION 'Less previous % exceeds the net certified on earlier approved certificates %', NEW.less_previous_paid, prev_net;
    END IF;
    -- Defect (043): the generated net_amount_due of the new row is not yet computed in a BEFORE trigger (NULL), so the
    -- "never negative" check never fired. The net is computed here from its parts.
    IF NEW.gross_work_done - NEW.less_retention - NEW.less_advance_recovery - NEW.less_previous_paid - NEW.penalties_deductions < 0 THEN
      RAISE EXCEPTION 'Net amount due % cannot be negative; use a separate credit process', NEW.gross_work_done - NEW.less_retention - NEW.less_advance_recovery - NEW.less_previous_paid - NEW.penalties_deductions;
    END IF;
    IF NEW.period_to < NEW.period_from THEN RAISE EXCEPTION 'Certificate period end precedes start'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION subcontract_deductions_position(p_subcontract BIGINT) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'subcontract_id', s.id,
    'advance_limit', CASE WHEN s.advance_payment_percent IS NULL THEN NULL ELSE round(s.contract_value * s.advance_payment_percent / 100, 2) END,
    'advances_recorded', (SELECT coalesce(sum(amount), 0) FROM subcontract_advances WHERE subcontract_id = s.id),
    'advances_paid', (SELECT coalesce(sum(amount), 0) FROM subcontract_advances WHERE subcontract_id = s.id AND status = 'paid'),
    'advance_recovered', (SELECT coalesce(sum(less_advance_recovery), 0) FROM subcontract_certificates WHERE subcontract_id = s.id AND status <> 'draft'),
    'advance_outstanding', (SELECT coalesce(sum(amount), 0) FROM subcontract_advances WHERE subcontract_id = s.id AND status = 'paid')
                         - (SELECT coalesce(sum(less_advance_recovery), 0) FROM subcontract_certificates WHERE subcontract_id = s.id AND status <> 'draft'),
    'backcharges', (SELECT coalesce(jsonb_object_agg(status, total), '{}'::jsonb) FROM (SELECT status, sum(amount) total FROM subcontract_backcharges WHERE subcontract_id = s.id GROUP BY status) b),
    'backcharges_disputed', (SELECT coalesce(sum(amount), 0) FROM subcontract_backcharges WHERE subcontract_id = s.id AND subcontractor_response = 'disputed' AND status <> 'withdrawn'),
    'net_certified_approved', (SELECT coalesce(sum(net_amount_due), 0) FROM subcontract_certificates WHERE subcontract_id = s.id AND status IN ('approved','posted','paid')))
  FROM subcontracts s WHERE s.id = p_subcontract
$$ LANGUAGE sql STABLE;

