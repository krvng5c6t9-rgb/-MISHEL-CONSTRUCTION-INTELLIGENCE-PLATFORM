-- Stage 63 / CC-092 (A-006, COMPETITOR_SCAN_002; MP-06 AL-04): letters of guarantee / bank bonds register.
-- (transaction managed by migrator)
-- Before (E3 @CC-091): no register of guarantees; AL-04 (guarantee expiry) could not be evaluated (migration 091).
-- Now:
--  * bank_guarantees: guarantees ISSUED by the company's bank in favour of a client (bid bond for a tender, advance
--    payment, performance, retention, maintenance) and guarantees RECEIVED from subcontractors / suppliers in the
--    company's favour; bank, bank reference (unique per bank), currency, amount, issue and expiry dates, optional cash
--    margin and commission rate as agreed with the bank (company data, never assumed).
--  * life cycle: draft (editable, deletable) -> active (confirmed by a second person: SoD) -> released, claimed
--    (liquidated: amount not above the current amount, reason required) or expired (only after the current expiry).
--    Closed guarantees never change; non-draft guarantees are never deleted.
--  * bank_guarantee_amendments: extension (later expiry), reduction / increase (amount), each with the bank's amendment
--    reference and a reason; permanent; the guarantee's current amount and expiry always equal the original values
--    carried forward by its amendments (database rule).
--  * AL-04: active guarantee whose current expiry falls within the company's days (finance view required).
-- Rollback: drop the two tables and their functions; restore alert_catalog / evaluate_alerts of migration 091.

CREATE TABLE IF NOT EXISTS bank_guarantees (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('issued', 'received')),
  guarantee_type VARCHAR(20) NOT NULL CHECK (guarantee_type IN ('bid', 'advance_payment', 'performance', 'retention', 'maintenance')),
  tender_id BIGINT REFERENCES tenders(id),
  project_id BIGINT REFERENCES projects(id),
  contract_id BIGINT REFERENCES contracts(id),
  subcontract_id BIGINT REFERENCES subcontracts(id),
  client_id BIGINT REFERENCES clients(id),
  vendor_id BIGINT REFERENCES vendors_subcontractors(id),
  bank_name VARCHAR(150) NOT NULL CHECK (length(btrim(bank_name)) >= 2),
  bank_reference VARCHAR(80) NOT NULL CHECK (length(btrim(bank_reference)) >= 2),
  currency_id BIGINT NOT NULL REFERENCES currencies(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  issue_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  current_amount NUMERIC(18,2) NOT NULL,
  current_expiry DATE NOT NULL,
  cash_margin NUMERIC(18,2) CHECK (cash_margin IS NULL OR cash_margin >= 0),
  commission_rate_pct NUMERIC(7,4) CHECK (commission_rate_pct IS NULL OR (commission_rate_pct >= 0 AND commission_rate_pct <= 100)),
  notes TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'released', 'claimed', 'expired')),
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  activated_by BIGINT REFERENCES users(id), activated_at TIMESTAMPTZ,
  closed_on DATE, closed_by BIGINT REFERENCES users(id), close_reference TEXT,
  claimed_amount NUMERIC(18,2), claim_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, bank_name, bank_reference),
  CHECK (expiry_date >= issue_date AND current_expiry >= issue_date),
  CHECK (current_amount > 0),
  CHECK (direction <> 'issued' OR (client_id IS NOT NULL AND vendor_id IS NULL AND subcontract_id IS NULL)),
  CHECK (direction <> 'received' OR (vendor_id IS NOT NULL AND client_id IS NULL AND tender_id IS NULL AND guarantee_type <> 'bid')),
  CHECK (guarantee_type <> 'bid' OR (tender_id IS NOT NULL AND contract_id IS NULL)),
  CHECK (guarantee_type = 'bid' OR project_id IS NOT NULL),
  CHECK (status = 'draft' OR (activated_by IS NOT NULL AND activated_by <> prepared_by AND activated_at IS NOT NULL)),
  CHECK (status NOT IN ('released', 'claimed', 'expired') OR (closed_on IS NOT NULL AND closed_by IS NOT NULL)),
  CHECK (status <> 'claimed' OR (claimed_amount > 0 AND claimed_amount <= current_amount AND length(btrim(coalesce(claim_reason, ''))) >= 10)),
  CHECK (status = 'claimed' OR (claimed_amount IS NULL AND claim_reason IS NULL)),
  CHECK (status <> 'released' OR length(btrim(coalesce(close_reference, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS idx_bank_guarantees_expiry ON bank_guarantees(org_id, status, current_expiry);

CREATE TABLE IF NOT EXISTS bank_guarantee_amendments (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  guarantee_id BIGINT NOT NULL REFERENCES bank_guarantees(id),
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('extension', 'reduction', 'increase')),
  new_amount NUMERIC(18,2) CHECK (new_amount IS NULL OR new_amount > 0),
  new_expiry DATE,
  effective_date DATE NOT NULL,
  bank_reference VARCHAR(80) NOT NULL CHECK (length(btrim(bank_reference)) >= 2),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'extension' AND new_expiry IS NOT NULL AND new_amount IS NULL) OR (kind IN ('reduction', 'increase') AND new_amount IS NOT NULL AND new_expiry IS NULL))
);

ALTER TABLE bank_guarantees ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_guarantees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON bank_guarantees;
DROP POLICY IF EXISTS tenant_isolation_write ON bank_guarantees;
CREATE POLICY tenant_isolation_select ON bank_guarantees FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON bank_guarantees FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_bank_guarantees ON bank_guarantees;
CREATE TRIGGER trg_audit_bank_guarantees AFTER INSERT OR UPDATE OR DELETE ON bank_guarantees FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();
ALTER TABLE bank_guarantee_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_guarantee_amendments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON bank_guarantee_amendments;
DROP POLICY IF EXISTS tenant_isolation_write ON bank_guarantee_amendments;
CREATE POLICY tenant_isolation_select ON bank_guarantee_amendments FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON bank_guarantee_amendments FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_bank_guarantee_amendments ON bank_guarantee_amendments;
CREATE TRIGGER trg_audit_bank_guarantee_amendments AFTER INSERT OR UPDATE OR DELETE ON bank_guarantee_amendments FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

-- The current amount / expiry carried forward by the amendments (the original values when there is none).
CREATE OR REPLACE FUNCTION guarantee_carried(p_id bigint, OUT amount numeric, OUT expiry date) LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT a.new_amount FROM bank_guarantee_amendments a WHERE a.guarantee_id = g.id AND a.new_amount IS NOT NULL ORDER BY a.id DESC LIMIT 1), g.amount),
         coalesce((SELECT a.new_expiry FROM bank_guarantee_amendments a WHERE a.guarantee_id = g.id AND a.new_expiry IS NOT NULL ORDER BY a.id DESC LIMIT 1), g.expiry_date)
    FROM bank_guarantees g WHERE g.id = p_id $$;

CREATE OR REPLACE FUNCTION guard_bank_guarantee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'A guarantee that was activated is never deleted'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.tender_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenders WHERE id = NEW.tender_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Tender not found in this organization'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Project not found in this organization'; END IF;
  IF NEW.contract_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contracts WHERE id = NEW.contract_id AND org_id = NEW.org_id AND project_id IS NOT DISTINCT FROM NEW.project_id) THEN RAISE EXCEPTION 'Contract not found in this project'; END IF;
  IF NEW.subcontract_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcontracts WHERE id = NEW.subcontract_id AND org_id = NEW.org_id AND project_id = NEW.project_id AND vendor_id = NEW.vendor_id) THEN RAISE EXCEPTION 'Subcontract not found for this project and subcontractor'; END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Client not found in this organization'; END IF;
  IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vendors_subcontractors WHERE id = NEW.vendor_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Vendor not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A guarantee is recorded as a draft first'; END IF;
    NEW.current_amount := NEW.amount; NEW.current_expiry := NEW.expiry_date;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('released', 'claimed', 'expired') THEN RAISE EXCEPTION 'A closed guarantee is never changed'; END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'active') THEN RAISE EXCEPTION 'A draft guarantee is activated first'; END IF;
    IF NEW.prepared_by IS DISTINCT FROM OLD.prepared_by THEN RAISE EXCEPTION 'The preparer of a guarantee does not change'; END IF;
    NEW.current_amount := NEW.amount; NEW.current_expiry := NEW.expiry_date;
    RETURN NEW;
  END IF;
  IF (NEW.direction, NEW.guarantee_type, NEW.tender_id, NEW.project_id, NEW.contract_id, NEW.subcontract_id, NEW.client_id, NEW.vendor_id, NEW.bank_name,
      NEW.bank_reference, NEW.currency_id, NEW.amount, NEW.issue_date, NEW.expiry_date, NEW.cash_margin, NEW.commission_rate_pct, NEW.prepared_by,
      NEW.activated_by, NEW.activated_at)
     IS DISTINCT FROM (OLD.direction, OLD.guarantee_type, OLD.tender_id, OLD.project_id, OLD.contract_id, OLD.subcontract_id, OLD.client_id, OLD.vendor_id, OLD.bank_name,
      OLD.bank_reference, OLD.currency_id, OLD.amount, OLD.issue_date, OLD.expiry_date, OLD.cash_margin, OLD.commission_rate_pct, OLD.prepared_by,
      OLD.activated_by, OLD.activated_at) THEN
    RAISE EXCEPTION 'The terms of an active guarantee change only by an amendment';
  END IF;
  SELECT * INTO c FROM guarantee_carried(NEW.id);
  IF NEW.current_amount IS DISTINCT FROM c.amount OR NEW.current_expiry IS DISTINCT FROM c.expiry THEN
    RAISE EXCEPTION 'The current amount and expiry of a guarantee follow its amendments';
  END IF;
  IF NEW.status = 'released' AND NEW.closed_on < NEW.issue_date THEN RAISE EXCEPTION 'A guarantee cannot be released before it was issued'; END IF;
  IF NEW.status = 'claimed' AND (NEW.closed_on < NEW.issue_date OR NEW.closed_on > NEW.current_expiry) THEN RAISE EXCEPTION 'A guarantee can be claimed only while it is valid'; END IF;
  IF NEW.status = 'expired' AND NEW.current_expiry >= current_date THEN RAISE EXCEPTION 'A guarantee is marked expired only after its expiry date'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_bank_guarantee ON bank_guarantees;
CREATE TRIGGER trg_guard_bank_guarantee BEFORE INSERT OR UPDATE OR DELETE ON bank_guarantees FOR EACH ROW EXECUTE FUNCTION guard_bank_guarantee();

CREATE OR REPLACE FUNCTION guard_bank_guarantee_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Guarantee amendments are permanent'; END IF;
  SELECT * INTO g FROM bank_guarantees WHERE id = NEW.guarantee_id AND org_id = NEW.org_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Guarantee not found in this organization'; END IF;
  IF g.status <> 'active' THEN RAISE EXCEPTION 'Only an active guarantee is amended'; END IF;
  IF NEW.effective_date < g.issue_date THEN RAISE EXCEPTION 'An amendment cannot take effect before the guarantee was issued'; END IF;
  IF NEW.kind = 'extension' AND NEW.new_expiry <= g.current_expiry THEN RAISE EXCEPTION 'An extension must move the expiry later'; END IF;
  IF NEW.kind = 'reduction' AND NEW.new_amount >= g.current_amount THEN RAISE EXCEPTION 'A reduction must lower the amount'; END IF;
  IF NEW.kind = 'increase' AND NEW.new_amount <= g.current_amount THEN RAISE EXCEPTION 'An increase must raise the amount'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_bank_guarantee_amendment ON bank_guarantee_amendments;
CREATE TRIGGER trg_guard_bank_guarantee_amendment BEFORE INSERT OR UPDATE OR DELETE ON bank_guarantee_amendments FOR EACH ROW EXECUTE FUNCTION guard_bank_guarantee_amendment();

-- After an amendment the guarantee carries the new current amount / expiry (checked again by the guarantee's guard).
CREATE OR REPLACE FUNCTION apply_bank_guarantee_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM guarantee_carried(NEW.guarantee_id);
  UPDATE bank_guarantees SET current_amount = c.amount, current_expiry = c.expiry WHERE id = NEW.guarantee_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_apply_bank_guarantee_amendment ON bank_guarantee_amendments;
CREATE TRIGGER trg_apply_bank_guarantee_amendment AFTER INSERT ON bank_guarantee_amendments FOR EACH ROW EXECUTE FUNCTION apply_bank_guarantee_amendment();

-- AL-04 (guarantee expiry) joins the alert catalogue; the rest of the alert engine is as in migration 091.

CREATE OR REPLACE FUNCTION alert_catalog() RETURNS TABLE(alert_code text, threshold_unit text, needs_roles boolean, view_module text, default_on boolean)
LANGUAGE sql IMMUTABLE AS $$
  VALUES ('AL-01', NULL, false, 'approvals', true),
         ('AL-04', 'days', true, 'finance', false),
         ('AL-02', 'hours', false, 'approvals', false),
         ('AL-03', 'days', true, 'contracts', false),
         ('AL-06', 'days', true, 'hse', false),
         ('AL-07', 'percent', true, 'cost_control', false),
         ('AL-11', 'days', true, 'qaqc', false),
         ('AL-12', NULL, true, 'hse', false),
         ('AL-14', 'days', true, 'finance', false),
         ('AL-15', NULL, true, 'finance', false),
         ('AL-18', NULL, true, 'ai_platform', false),
         ('AL-20', NULL, true, 'ai_platform', false),
         ('AL-22', NULL, true, 'edms', false),
         ('AL-23', 'days', true, 'site', false),
         ('AL-25', NULL, true, 'technical_office', false) $$;

CREATE OR REPLACE FUNCTION evaluate_alerts(p_org bigint) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int := 0; k int; r record;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _alert_out (user_id bigint, alert_code text, params jsonb, record_table text, record_id bigint, dedupe_key text, message text, link text) ON COMMIT DROP;
  DELETE FROM _alert_out;
  FOR r IN
    SELECT c.alert_code, c.threshold_unit, c.needs_roles, c.view_module,
           coalesce(a.enabled, c.default_on) AS enabled, a.threshold, coalesce(a.recipient_role_ids, '{}') AS roles, a.enabled_at
      FROM alert_catalog() c LEFT JOIN alert_rules a ON a.org_id = p_org AND a.alert_code = c.alert_code
  LOOP
    CONTINUE WHEN NOT r.enabled;
    CONTINUE WHEN r.threshold_unit IS NOT NULL AND r.threshold IS NULL;
    CONTINUE WHEN r.needs_roles AND cardinality(r.roles) = 0;
    IF r.alert_code IN ('AL-01', 'AL-02') THEN
      INSERT INTO _alert_out
      SELECT u.id, r.alert_code,
             jsonb_build_object('module', ai.module, 'record', ai.record_id, 'amount', ai.amount, 'currency', cur.code, 'step', ai.current_step, 'hours', r.threshold),
             'approval_instances', ai.id, r.alert_code || ':' || ai.id || ':' || ai.current_step,
             CASE r.alert_code WHEN 'AL-01' THEN 'Approval pending: ' || ai.module || ' #' || ai.record_id
                  ELSE 'Approval overdue (more than ' || r.threshold || ' hours): ' || ai.module || ' #' || ai.record_id END,
             '/approvals'
        FROM approval_instances ai
        LEFT JOIN currencies cur ON cur.id = ai.currency_id
        CROSS JOIN LATERAL (
          SELECT d.approver_role_id FROM delegation_of_authority d
           WHERE d.org_id = ai.org_id AND d.module = ai.module AND d.approval_level = ai.current_step AND d.is_active AND d.is_confirmed
             AND d.effective_from <= current_date AND (d.effective_to IS NULL OR d.effective_to >= current_date)
             AND (d.currency_id IS NULL OR d.currency_id = ai.currency_id)
             AND (ai.amount IS NULL OR (ai.amount >= d.min_amount AND (d.max_amount IS NULL OR ai.amount <= d.max_amount)))
           ORDER BY d.approval_level, d.min_amount LIMIT 1) doa
        JOIN users u ON u.org_id = ai.org_id AND u.role_id = doa.approver_role_id AND u.is_active AND u.user_type = 'internal' AND u.id <> ai.initiated_by
       WHERE ai.org_id = p_org AND ai.status = 'pending'
         AND (r.alert_code = 'AL-01' OR greatest(ai.initiated_at, (SELECT max(l.action_date) FROM approval_actions_log l WHERE l.approval_instance_id = ai.id)) < now() - make_interval(hours => r.threshold));
    ELSE
      INSERT INTO _alert_out
      SELECT u.id, r.alert_code, x.params, x.record_table, x.record_id, x.dedupe_key, x.message, x.link
        FROM (
          SELECT jsonb_build_object('contract', n2.contract_id, 'title', e.title, 'deadline', n2.deadline) AS params, 'contract_notices'::text AS record_table, n2.id AS record_id,
                 'AL-03:' || n2.id AS dedupe_key, 'Contract notice due by ' || n2.deadline || ': ' || e.title AS message, '/project-controls' AS link
            FROM contract_notices n2 JOIN contract_events e ON e.id = n2.event_id
           WHERE r.alert_code = 'AL-03' AND n2.org_id = p_org AND n2.status = 'open' AND n2.deadline <= current_date + r.threshold
          UNION ALL
          SELECT jsonb_build_object('no', x2.ncr_no, 'raised', x2.raised_date, 'days', r.threshold), 'ncrs', x2.id,
                 'AL-11:' || x2.id, 'NCR ' || x2.ncr_no || ' open for more than ' || r.threshold || ' days', '/qaqc'
            FROM ncrs x2 WHERE r.alert_code = 'AL-11' AND x2.org_id = p_org AND x2.status = 'open' AND x2.raised_date < current_date - r.threshold
          UNION ALL
          SELECT jsonb_build_object('severity', i.severity, 'date', i.incident_date), 'incidents', i.id,
                 'AL-12:' || i.id, 'HSE incident reported (' || i.severity || ') on ' || i.incident_date, '/hse'
            FROM incidents i WHERE r.alert_code = 'AL-12' AND i.org_id = p_org AND i.created_at >= r.enabled_at
          UNION ALL
          SELECT jsonb_build_object('party', v.vendor_name, 'amount', ap.amount, 'currency', cur.code, 'due', ap.due_date), 'accounts_payable', ap.id,
                 'AL-14:' || ap.id || ':' || ap.due_date, 'Payment due ' || ap.due_date || ': ' || ap.amount || ' ' || cur.code || ' to ' || v.vendor_name, '/finance'
            FROM accounts_payable ap JOIN vendors_subcontractors v ON v.id = ap.vendor_id JOIN currencies cur ON cur.id = ap.currency_id
           WHERE r.alert_code = 'AL-14' AND ap.org_id = p_org AND ap.status IN ('open', 'partially_paid') AND ap.due_date IS NOT NULL AND ap.due_date <= current_date + r.threshold
          UNION ALL
          SELECT jsonb_build_object('party', cl.client_name, 'amount', ar.amount, 'currency', cur.code, 'due', ar.due_date), 'accounts_receivable', ar.id,
                 'AL-15:' || ar.id || ':' || ar.due_date, 'Receivable overdue since ' || ar.due_date || ': ' || ar.amount || ' ' || cur.code || ' from ' || cl.client_name, '/payments-certification'
            FROM accounts_receivable ar JOIN clients cl ON cl.id = ar.client_id JOIN currencies cur ON cur.id = ar.currency_id
           WHERE r.alert_code = 'AL-15' AND ar.org_id = p_org AND ar.status IN ('open', 'partially_paid') AND ar.due_date IS NOT NULL AND ar.due_date < current_date
          UNION ALL
          SELECT jsonb_build_object('kind', 'rfi', 'no', q.rfi_no, 'due', q.response_due), 'rfis', q.id,
                 'AL-25:rfi:' || q.id, 'RFI ' || q.rfi_no || ' without response since ' || q.response_due, '/technical-office'
            FROM rfis q WHERE r.alert_code = 'AL-25' AND q.org_id = p_org AND q.status = 'open' AND q.response_due IS NOT NULL AND q.response_due < current_date
          UNION ALL
          SELECT jsonb_build_object('kind', 'submittal', 'no', s.submittal_no, 'due', s.due_date), 'submittals', s.id,
                 'AL-25:submittal:' || s.id || ':' || s.cycle, 'Submittal ' || s.submittal_no || ' without response since ' || s.due_date, '/technical-office'
            FROM submittals s WHERE r.alert_code = 'AL-25' AND s.org_id = p_org AND s.status IN ('submitted', 'under_review') AND s.due_date IS NOT NULL AND s.due_date < current_date
          UNION ALL
          SELECT jsonb_build_object('type', w.permit_type, 'expiry', w.expiry_date), 'permits_to_work', w.id,
                 'AL-06:' || w.id || ':' || w.expiry_date, 'Work permit ' || w.permit_type || ' expires on ' || w.expiry_date, '/hse'
            FROM permits_to_work w WHERE r.alert_code = 'AL-06' AND w.org_id = p_org AND w.status IN ('approved', 'active')
             AND w.expiry_date IS NOT NULL AND w.expiry_date <= current_date + r.threshold
          UNION ALL
          SELECT jsonb_build_object('project', p.project_code, 'code', cc.code, 'budget', f.budget, 'eac', f.eac, 'percent', r.threshold), 'cost_forecast_snapshots', f.id,
                 'AL-07:' || f.id, 'EAC ' || f.eac || ' exceeds budget ' || f.budget || ' by more than ' || r.threshold || '% (' || p.project_code || ' / ' || cc.code || ')', '/cost-control'
            FROM (SELECT DISTINCT ON (s.project_id, s.cost_code_id) s.* FROM cost_forecast_snapshots s
                   WHERE s.org_id = p_org AND s.approved_at IS NOT NULL ORDER BY s.project_id, s.cost_code_id, s.as_of DESC, s.id DESC) f
            JOIN projects p ON p.id = f.project_id JOIN cost_codes cc ON cc.id = f.cost_code_id
           WHERE r.alert_code = 'AL-07' AND f.budget > 0 AND f.eac > f.budget * (1 + r.threshold / 100.0)
          UNION ALL
          SELECT jsonb_build_object('run', ar.id, 'agent', ag.name), 'ai_runs', ar.id,
                 'AL-18:' || ar.id, 'AI run #' || ar.id || ' (' || coalesce(ag.name, '-') || ') awaits human review', '/ai-platform'
            FROM ai_runs ar LEFT JOIN ai_agents ag ON ag.id = ar.agent_id
           WHERE r.alert_code = 'AL-18' AND ar.org_id = p_org AND ar.status = 'waiting_approval'
          UNION ALL
          SELECT jsonb_build_object('agent', ag.name, 'key', ag.agent_key), 'ai_agents', ag.id,
                 'AL-20:' || ag.id || ':' || ag.updated_at, 'AI agent ' || ag.name || ' is suspended', '/ai-platform'
            FROM ai_agents ag WHERE r.alert_code = 'AL-20' AND ag.org_id = p_org AND ag.status = 'suspended'
          UNION ALL
          SELECT jsonb_build_object('transmittal', t.transmittal_no, 'document', coalesce(d.doc_number, d.file_name), 'revision', v.revision), 'transmittal_lines', l.id,
                 'AL-22:' || l.id || ':' || v.id, 'Draft transmittal ' || t.transmittal_no || ' holds a superseded revision of ' || coalesce(d.doc_number, d.file_name), '/edms'
            FROM transmittal_lines l JOIN document_transmittals t ON t.id = l.transmittal_id
            JOIN document_versions v ON v.id = l.document_version_id JOIN documents d ON d.id = l.document_id
           WHERE r.alert_code = 'AL-22' AND l.org_id = p_org AND t.status = 'draft' AND NOT v.is_current
          UNION ALL
          SELECT jsonb_build_object('certificate', h.certificate_no, 'dlp_end', h.dlp_end_date), 'handover_certificates', h.id,
                 'AL-23:' || h.id || ':' || h.dlp_end_date, 'Defects liability period of ' || h.certificate_no || ' ends on ' || h.dlp_end_date, '/project-controls'
            FROM handover_certificates h WHERE r.alert_code = 'AL-23' AND h.org_id = p_org AND h.dlp_end_date IS NOT NULL
             AND h.dlp_end_date BETWEEN current_date AND current_date + r.threshold
          UNION ALL
          SELECT jsonb_build_object('reference', g.bank_reference, 'bank', g.bank_name, 'type', g.guarantee_type, 'expiry', g.current_expiry,
                                    'amount', g.current_amount, 'currency', cur.code), 'bank_guarantees', g.id,
                 'AL-04:' || g.id || ':' || g.current_expiry, 'Letter of guarantee ' || g.bank_reference || ' (' || g.bank_name || ') expires on ' || g.current_expiry, '/guarantees'
            FROM bank_guarantees g JOIN currencies cur ON cur.id = g.currency_id
           WHERE r.alert_code = 'AL-04' AND g.org_id = p_org AND g.status = 'active' AND g.current_expiry <= current_date + r.threshold
        ) x
        JOIN users u ON u.org_id = p_org AND u.role_id = ANY (r.roles) AND u.is_active AND u.user_type = 'internal';
    END IF;
  END LOOP;
  INSERT INTO notifications (org_id, user_id, source_module, message, link, alert_code, params, record_table, record_id, dedupe_key)
  SELECT p_org, o.user_id, 'alerts', o.message, o.link, o.alert_code, o.params, o.record_table, o.record_id, o.dedupe_key
    FROM _alert_out o JOIN alert_catalog() c ON c.alert_code = o.alert_code
   WHERE user_can_view(o.user_id, c.view_module)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;
