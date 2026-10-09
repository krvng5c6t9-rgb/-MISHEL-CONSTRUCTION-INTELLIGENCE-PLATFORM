-- Stage 20 / GC-12 step 4-5: subcontract advance payments and their recovery, back-charges, and the "less previous"
-- deduction. (transaction managed by migrator)
-- Before this migration a subcontract certificate carried less_advance_recovery, penalties_deductions and
-- less_previous_paid as free numbers typed by the maker: a recovery could be taken with no advance ever paid, recovered
-- twice, a deduction could be made with no recorded back-charge (no cause, no approval, no notice to the subcontractor),
-- and "previous" could exceed everything ever certified. Now:
--  * an advance is recorded only where the subcontract provides for one (advance_payment_percent), within that
--    percentage of the subcontract value; approved by someone other than its preparer; recovery only of advances
--    marked paid. The recovery rate is the subcontract's term as entered on the advance (no default); when present the
--    certificate's recovery must equal min(rate x gross, outstanding); without a rate the recovery is manual but never
--    above the outstanding advance;
--  * a back-charge is raised with cause and amount, approved by a second person only once the subcontractor has been
--    notified (date recorded), then applied to a draft certificate; the certificate deduction must equal the
--    back-charges applied to it; the subcontractor's response (accepted / disputed) is recorded, not decided here;
--  * less_previous_paid may not exceed the net certified on earlier approved certificates of the same subcontract;
--  * defect: the 043 "net never negative" check read the generated net_amount_due inside a BEFORE trigger, where it is
--    not yet computed (NULL), so a certificate with net -5,500 passed site verification (E1 SW-GC12_deductions_BEFORE_fix_ux2.txt).
-- Whether certificates are periodic or cumulative, the cost/AP basis and the GL treatment of advances remain DEC-012.
-- Tax/withholding on certificates is not modelled (law- and owner-defined; nothing invented).
-- Rollback: DROP TABLE subcontract_backcharges, subcontract_advances; restore guard_subcontract_certificate_integrity
-- from 043.

CREATE TABLE IF NOT EXISTS subcontract_advances (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  subcontract_id BIGINT NOT NULL REFERENCES subcontracts(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  recovery_percent NUMERIC(5,2) CHECK (recovery_percent IS NULL OR (recovery_percent > 0 AND recovery_percent <= 100)),
  guarantee_ref TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  paid_by BIGINT REFERENCES users(id),
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_by <> created_by AND approved_at IS NOT NULL)),
  CHECK (status <> 'paid' OR (paid_by IS NOT NULL AND paid_by <> created_by AND paid_at IS NOT NULL AND length(trim(coalesce(payment_reference,''))) >= 3))
);
CREATE INDEX IF NOT EXISTS idx_subcontract_advances_sc ON subcontract_advances(subcontract_id);

CREATE OR REPLACE FUNCTION guard_subcontract_advance() RETURNS trigger AS $$
DECLARE s record; total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft advance can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, status, contract_value, advance_payment_percent INTO s FROM subcontracts WHERE id = NEW.subcontract_id FOR UPDATE;
  IF s.id IS NULL OR s.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Subcontract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'An advance starts as draft'; END IF;
    IF s.status <> 'active' THEN RAISE EXCEPTION 'Advances are recorded only on an active subcontract (subcontract % is %)', s.id, s.status; END IF;
    IF s.advance_payment_percent IS NULL OR s.advance_payment_percent <= 0 THEN
      RAISE EXCEPTION 'Subcontract % provides no advance payment (advance_payment_percent not set)', s.id;
    END IF;
    SELECT coalesce(sum(amount), 0) INTO total FROM subcontract_advances WHERE subcontract_id = NEW.subcontract_id;
    IF total + NEW.amount > round(s.contract_value * s.advance_payment_percent / 100, 2) THEN
      RAISE EXCEPTION 'Advances % exceed % percent of the subcontract value %', total + NEW.amount, s.advance_payment_percent, s.contract_value;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.subcontract_id, NEW.amount, NEW.recovery_percent, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.org_id, OLD.subcontract_id, OLD.amount, OLD.recovery_percent, OLD.created_by, OLD.created_at) AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Advance % is approved; its terms are frozen', OLD.id;
  END IF;
  IF OLD.status = 'paid' THEN RAISE EXCEPTION 'Advance % is paid and immutable', OLD.id; END IF;
  IF NOT ((OLD.status = NEW.status) OR (OLD.status = 'draft' AND NEW.status = 'approved') OR (OLD.status = 'approved' AND NEW.status = 'paid')) THEN
    RAISE EXCEPTION 'Invalid advance transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN RAISE EXCEPTION 'An approved advance changes only by being paid'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_advance ON subcontract_advances;
CREATE TRIGGER trg_subcontract_advance BEFORE INSERT OR UPDATE OR DELETE ON subcontract_advances FOR EACH ROW EXECUTE FUNCTION guard_subcontract_advance();

CREATE TABLE IF NOT EXISTS subcontract_backcharges (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  subcontract_id BIGINT NOT NULL REFERENCES subcontracts(id),
  reference VARCHAR(40) NOT NULL,
  cause TEXT NOT NULL CHECK (length(trim(cause)) >= 10),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  evidence_document_id BIGINT REFERENCES documents(id),
  status VARCHAR(10) NOT NULL DEFAULT 'raised' CHECK (status IN ('raised','approved','applied','withdrawn')),
  raised_by BIGINT NOT NULL REFERENCES users(id),
  notified_on DATE,
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  subcontractor_response VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (subcontractor_response IN ('none','accepted','disputed')),
  response_note TEXT,
  certificate_id BIGINT REFERENCES subcontract_certificates(id),
  withdrawn_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subcontract_id, reference),
  CHECK (status IN ('raised','withdrawn') OR (approved_by IS NOT NULL AND approved_by <> raised_by AND approved_at IS NOT NULL AND notified_on IS NOT NULL)),
  CHECK ((status = 'applied') = (certificate_id IS NOT NULL)),
  CHECK (status <> 'withdrawn' OR length(trim(coalesce(withdrawn_reason,''))) >= 5),
  CHECK (subcontractor_response = 'none' OR length(trim(coalesce(response_note,''))) >= 5)
);
CREATE INDEX IF NOT EXISTS idx_subcontract_backcharges_sc ON subcontract_backcharges(subcontract_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_backcharges_cert ON subcontract_backcharges(certificate_id);

CREATE OR REPLACE FUNCTION guard_subcontract_backcharge() RETURNS trigger AS $$
DECLARE s record; c record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Back-charges are never deleted; withdraw with a reason'; END IF;
  SELECT id, org_id, status INTO s FROM subcontracts WHERE id = NEW.subcontract_id;
  IF s.id IS NULL OR s.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Subcontract not found in this organization'; END IF;
  IF NEW.evidence_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.evidence_document_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Evidence document not found in this organization';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'raised' THEN RAISE EXCEPTION 'A back-charge starts as raised'; END IF;
    IF NEW.notified_on IS NOT NULL AND NEW.notified_on > current_date THEN RAISE EXCEPTION 'Notification date cannot be in the future'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.subcontract_id, NEW.reference, NEW.raised_by, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.subcontract_id, OLD.reference, OLD.raised_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Back-charge identity is immutable';
  END IF;
  IF OLD.status <> 'raised' AND (NEW.cause, NEW.amount, NEW.evidence_document_id, NEW.notified_on) IS DISTINCT FROM (OLD.cause, OLD.amount, OLD.evidence_document_id, OLD.notified_on) THEN
    RAISE EXCEPTION 'Back-charge % is approved; cause, amount and notice are frozen', OLD.id;
  END IF;
  IF NEW.notified_on IS NOT NULL AND NEW.notified_on > current_date THEN RAISE EXCEPTION 'Notification date cannot be in the future'; END IF;
  IF OLD.status = 'withdrawn' THEN RAISE EXCEPTION 'Back-charge % is withdrawn', OLD.id; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'raised' AND NEW.status IN ('approved','withdrawn')) OR
       (OLD.status = 'approved' AND NEW.status IN ('applied','withdrawn')) OR
       (OLD.status = 'applied' AND NEW.status = 'approved')) THEN
    RAISE EXCEPTION 'Invalid back-charge transition % -> %', OLD.status, NEW.status;
  END IF;
  -- Applying to / detaching from a certificate only while that certificate is draft and of the same subcontract.
  IF NEW.certificate_id IS DISTINCT FROM OLD.certificate_id THEN
    SELECT id, subcontract_id, status INTO c FROM subcontract_certificates WHERE id = coalesce(NEW.certificate_id, OLD.certificate_id);
    IF c.id IS NULL OR c.subcontract_id <> NEW.subcontract_id THEN RAISE EXCEPTION 'Certificate must belong to the same subcontract'; END IF;
    IF c.status <> 'draft' THEN RAISE EXCEPTION 'Back-charges are applied to or removed from a draft certificate only (certificate % is %)', c.id, c.status; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_backcharge ON subcontract_backcharges;
CREATE TRIGGER trg_subcontract_backcharge BEFORE INSERT OR UPDATE OR DELETE ON subcontract_backcharges FOR EACH ROW EXECUTE FUNCTION guard_subcontract_backcharge();

-- Certificate integrity (043) extended with the deduction rules at draft -> site_verified.
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
    -- Less previous: never more than the net certified on earlier approved certificates.
    SELECT coalesce(sum(net_amount_due + less_previous_paid), 0) INTO prev_net FROM subcontract_certificates
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
    'net_certified_approved', (SELECT coalesce(sum(net_amount_due + less_previous_paid), 0) FROM subcontract_certificates WHERE subcontract_id = s.id AND status IN ('approved','posted','paid')))
  FROM subcontracts s WHERE s.id = p_subcontract
$$ LANGUAGE sql STABLE;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['subcontract_advances','subcontract_backcharges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
