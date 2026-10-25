-- Stage 53 / CC-083 / R1.4 (MP-06 §6, first batch): alert engine and notification centre.
-- (transaction managed by migrator)
-- Before (E3 @CC-082): only one trigger wrote notifications (008 notify_pending_approval): when an approval was created,
-- through the old approval_workflow_steps table, to every user of the approver role including the initiator, with a
-- link to a route the screens do not have; later steps, currency, confirmation and validity of the DOA row were not
-- considered, and the notifications had no screen (F-60). That trigger is replaced by AL-01 below; notifications it
-- wrote stay as they are.
-- Now:
--  * alert_rules: per company and alert, enabled / threshold / recipient roles (company settings, MP-06 §6). No window
--    or threshold is assumed: an alert that needs one stays off until the company sets it, and an alert addressed to
--    roles stays off until the company names them. AL-01 (approval pending) needs neither - its recipient is the
--    approver of the current step - and is on unless the company turns it off.
--  * evaluate_alerts(org): deterministic rules on database data (MP-04 rule 2), first batch:
--      AL-01 approval pending          -> approvers of the current DOA step (not the initiator)
--      AL-02 approval overdue          -> the same approvers, pending longer than the company's hours
--      AL-03 contract time-bar         -> open notice whose deadline falls within the company's days (or has passed)
--      AL-11 NCR open too long         -> open NCR raised more than the company's days ago
--      AL-12 HSE incident reported     -> incident recorded after the alert was switched on
--      AL-14 payment due               -> open payable due within the company's days (or overdue)
--      AL-15 receivable overdue        -> open receivable past its due date
--      AL-25 consultant response overdue -> open RFI past its response date / submittal under review past its due date
--    Each recipient is told once per record and state (dedupe key); only users holding 'view' on the alert's module
--    are told (an alert never shows a user what the user may not read).
--  * notifications carry the alert code, its values (for the user's language), the record and the time read.
-- Not in this batch (MP-06 §6): AL-04…AL-10, AL-13, AL-16…AL-24, AL-26; escalation to the line manager (positions are
-- not modelled - recipients are roles); e-mail / SMS, digest and quiet hours.
-- Rollback: drop function evaluate_alerts, alert_catalog, user_can_view, guard_alert_rule; drop table alert_rules; drop
-- the added columns and index of notifications; recreate trg_notify_pending_approval (008).

DROP TRIGGER IF EXISTS trg_notify_pending_approval ON approval_instances;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS alert_code VARCHAR(8),
  ADD COLUMN IF NOT EXISTS params JSONB,
  ADD COLUMN IF NOT EXISTS record_table VARCHAR(60),
  ADD COLUMN IF NOT EXISTS record_id BIGINT,
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- The alerts of this batch: threshold unit (null = none), whether recipient roles are needed, the module a recipient
-- must be able to view, on by default.
CREATE OR REPLACE FUNCTION alert_catalog() RETURNS TABLE(alert_code text, threshold_unit text, needs_roles boolean, view_module text, default_on boolean)
LANGUAGE sql IMMUTABLE AS $$
  VALUES ('AL-01', NULL, false, 'approvals', true),
         ('AL-02', 'hours', false, 'approvals', false),
         ('AL-03', 'days', true, 'contracts', false),
         ('AL-11', 'days', true, 'qaqc', false),
         ('AL-12', NULL, true, 'hse', false),
         ('AL-14', 'days', true, 'finance', false),
         ('AL-15', NULL, true, 'finance', false),
         ('AL-25', NULL, true, 'technical_office', false) $$;

CREATE TABLE IF NOT EXISTS alert_rules (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  alert_code VARCHAR(8) NOT NULL,
  enabled BOOLEAN NOT NULL,
  threshold INT CHECK (threshold BETWEEN 0 AND 3650),
  recipient_role_ids BIGINT[] NOT NULL DEFAULT '{}',
  enabled_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, alert_code)
);
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON alert_rules;
DROP POLICY IF EXISTS tenant_isolation_write ON alert_rules;
CREATE POLICY tenant_isolation_select ON alert_rules FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON alert_rules FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_alert_rules ON alert_rules;
CREATE TRIGGER trg_audit_alert_rules AFTER INSERT OR UPDATE OR DELETE ON alert_rules FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

-- A rule must name an alert of the catalogue; recipient roles must be the company's own; enabled_at follows switching on.
CREATE OR REPLACE FUNCTION guard_alert_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM alert_catalog() c WHERE c.alert_code = NEW.alert_code) THEN
    RAISE EXCEPTION 'Unknown alert %', NEW.alert_code;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.recipient_role_ids) r(id) WHERE NOT EXISTS (SELECT 1 FROM roles x WHERE x.id = r.id AND x.org_id = NEW.org_id)) THEN
    RAISE EXCEPTION 'Recipient roles must be roles of this company';
  END IF;
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled) THEN NEW.enabled_at := now(); END IF;
  IF NOT NEW.enabled THEN NEW.enabled_at := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_alert_rule ON alert_rules;
CREATE TRIGGER trg_guard_alert_rule BEFORE INSERT OR UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION guard_alert_rule();

CREATE OR REPLACE FUNCTION user_can_view(p_user bigint, p_module text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users u JOIN permissions p ON p.role_id = u.role_id
                  WHERE u.id = p_user AND u.is_active AND p.module = p_module AND p.action = 'view') $$;

-- Evaluates the active alerts of one company and records one notification per recipient, record and state. Runs in
-- the caller's tenant context; returns the number of notifications written.
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
