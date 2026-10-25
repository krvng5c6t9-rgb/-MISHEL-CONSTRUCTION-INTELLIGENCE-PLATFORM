-- Stage 54 / CC-084 / R1.4 second batch (MP-06 §6): the alerts the existing data supports.
-- (transaction managed by migrator)
-- Added to the engine of 090 (definitions of the first batch unchanged):
--   AL-06 permit / licence expiry   -> approved or active work permit expiring within the company's days (permits to
--                                      work only: licences, calibration, training and supplier certificates have no
--                                      register yet)
--   AL-07 budget / EAC breach        -> latest approved cost forecast per project and cost code whose EAC exceeds the
--                                      budget by more than the company's percentage
--   AL-18 AI draft awaiting review   -> AI run waiting for human approval
--   AL-20 agent suspended            -> AI agent in status suspended (security incidents have no register yet)
--   AL-22 document superseded in use -> a draft transmittal holding a document version that is no longer current
--   AL-23 DLP end due                -> handover certificate whose defects liability period ends within the company's
--                                      days (retention-release milestones are not scheduled records yet)
-- Same rules as 090: a threshold and recipient roles must be set before an alert runs (nothing is assumed); only users
-- holding 'view' on the alert's module are told; one notification per recipient, record and state.
-- Not supported by existing data (no register yet): AL-04 guarantees, AL-05 insurance, AL-08 critical delay (float is
-- not stored), AL-09 material need date (no expected delivery date on orders), AL-10 stock minimum, AL-13 workforce
-- gap, AL-16 cash forecast, AL-17 close checklist, AL-19 import refused rows (previews are not stored), AL-21 variation
-- candidate (no flag on site instructions), AL-24 billing cut-off (no billing calendar), AL-26 price index.
-- Rollback: restore alert_catalog and evaluate_alerts from 090; delete alert_rules rows of the six codes.

CREATE OR REPLACE FUNCTION alert_catalog() RETURNS TABLE(alert_code text, threshold_unit text, needs_roles boolean, view_module text, default_on boolean)
LANGUAGE sql IMMUTABLE AS $$
  VALUES ('AL-01', NULL, false, 'approvals', true),
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
