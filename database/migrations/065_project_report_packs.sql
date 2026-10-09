-- Stage 14 (GC-10 steps 1, 2, 4): weekly/monthly project report packs - previously ABSENT (reports were live queries;
-- nothing was frozen, reconciled or approved).
-- (transaction managed by migrator)
--  * project_report_snapshot() computes the pack content in the database. Ledger-based figures are AS OF the data
--    date (cost dated <= data date, budgets approved by then, NCRs open on that date, incidents in the period);
--    status-based figures (contract time position, risks, notices, diaries) are AT CAPTURE and labelled so -
--    nothing is presented as historical when it is not.
--  * Reconciliation exceptions are listed, never auto-corrected: actual cost not posted to the GL, commitment above
--    budget per cost code, actual cost with no approved budget, postings back-dated into a period already covered by
--    an approved pack (with amounts), notices past their deadline still open, unsigned site diaries in the period.
--  * The pack stores the snapshot with its SHA-256; content, period and hash are immutable; verification recomputes
--    the hash. Approval by someone other than the preparer; rejection needs a reason; a period has at most one
--    live (non-rejected) pack; packs with exceptions need an explanatory narrative before submission.
-- Rollback: DROP TABLE project_report_packs; DROP FUNCTION project_report_snapshot(bigint, date, date).

CREATE TABLE IF NOT EXISTS project_report_packs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('weekly','monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  exception_count INT NOT NULL,
  narrative TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  decided_by BIGINT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  CHECK (period_start <= period_end),
  CHECK (status NOT IN ('approved','rejected') OR (decided_by IS NOT NULL AND decided_by <> prepared_by AND decided_at IS NOT NULL)),
  CHECK (status <> 'rejected' OR length(trim(coalesce(decision_reason,''))) >= 5),
  CHECK (status = 'draft' OR exception_count = 0 OR length(trim(coalesce(narrative,''))) >= 20)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_pack_live_period ON project_report_packs(project_id, period_type, period_end) WHERE status <> 'rejected';

CREATE OR REPLACE FUNCTION project_report_snapshot(p_project bigint, p_start date, p_end date)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH prev AS (
  SELECT period_end, decided_at FROM project_report_packs
   WHERE project_id = p_project AND status = 'approved' AND period_end < p_end
   ORDER BY period_end DESC LIMIT 1),
codes AS (
  SELECT DISTINCT cost_code_id FROM (
    SELECT cost_code_id FROM cost_transactions WHERE project_id = p_project AND transaction_date <= p_end
    UNION SELECT cost_code_id FROM budgets WHERE project_id = p_project AND approved_by IS NOT NULL AND approval_date <= p_end
    UNION SELECT cost_code_id FROM purchase_orders WHERE project_id = p_project AND cost_code_id IS NOT NULL) x),
per_code AS (
  SELECT c.cost_code_id,
    coalesce((SELECT amount FROM budgets b WHERE b.project_id = p_project AND b.cost_code_id = c.cost_code_id AND b.approved_by IS NOT NULL
               AND b.approval_date <= p_end ORDER BY (b.budget_type = 'revised') DESC, b.approval_date DESC, b.id DESC LIMIT 1), 0) AS budget,
    (SELECT count(*) FROM budgets b WHERE b.project_id = p_project AND b.cost_code_id = c.cost_code_id AND b.approved_by IS NOT NULL AND b.approval_date <= p_end) AS budget_rows,
    coalesce((SELECT sum(amount) FROM cost_transactions t WHERE t.project_id = p_project AND t.cost_code_id = c.cost_code_id AND t.transaction_type = 'committed' AND t.transaction_date <= p_end), 0) AS committed,
    coalesce((SELECT sum(amount) FROM cost_transactions t WHERE t.project_id = p_project AND t.cost_code_id = c.cost_code_id AND t.transaction_type = 'actual' AND t.transaction_date <= p_end), 0) AS actual,
    cost_accrual_as_of(p_project, c.cost_code_id, p_end) AS accrual
  FROM codes c),
cost AS (
  SELECT coalesce(sum(budget), 0)::numeric(18,2) AS budget, coalesce(sum(committed), 0)::numeric(18,2) AS committed,
         coalesce(sum(actual), 0)::numeric(18,2) AS actual, coalesce(sum(accrual), 0)::numeric(18,2) AS accrual FROM per_code),
unposted AS (
  SELECT count(*)::int AS n, coalesce(sum(amount), 0)::numeric(18,2) AS amount FROM cost_transactions
   WHERE project_id = p_project AND transaction_type = 'actual' AND transaction_date <= p_end AND NOT is_posted_to_gl),
backdated AS (
  SELECT count(*)::int AS n, coalesce(sum(t.amount), 0)::numeric(18,2) AS amount FROM cost_transactions t, prev
   WHERE t.project_id = p_project AND t.transaction_date <= prev.period_end AND t.created_at > prev.decided_at),
notices AS (
  SELECT count(*)::int AS n FROM contract_notices cn JOIN contracts c ON c.id = cn.contract_id
   WHERE c.project_id = p_project AND cn.status = 'open' AND cn.deadline < p_end),
diaries AS (
  SELECT count(*)::int AS n FROM site_diary WHERE project_id = p_project AND diary_date BETWEEN p_start AND p_end AND status <> 'signed'),
exceptions AS (
  SELECT jsonb_agg(e ORDER BY e->>'type') AS list FROM (
    SELECT jsonb_build_object('type', 'actual_not_posted_to_gl', 'count', n, 'amount', amount) e FROM unposted WHERE n > 0
    UNION ALL SELECT jsonb_build_object('type', 'commitment_above_budget', 'cost_code_id', cost_code_id, 'budget', budget::numeric(18,2), 'committed', committed::numeric(18,2))
      FROM per_code WHERE budget_rows > 0 AND committed > budget
    UNION ALL SELECT jsonb_build_object('type', 'actual_without_approved_budget', 'cost_code_id', cost_code_id, 'actual', actual::numeric(18,2))
      FROM per_code WHERE budget_rows = 0 AND actual > 0
    UNION ALL SELECT jsonb_build_object('type', 'backdated_into_approved_period', 'count', n, 'amount', amount) FROM backdated WHERE n > 0
    UNION ALL SELECT jsonb_build_object('type', 'notices_past_deadline_open', 'count', n) FROM notices WHERE n > 0
    UNION ALL SELECT jsonb_build_object('type', 'unsigned_site_diaries_in_period', 'count', n) FROM diaries WHERE n > 0) z)
SELECT jsonb_build_object(
  'project_id', p_project, 'period_start', p_start, 'period_end', p_end, 'data_as_of', p_end,
  'cost', jsonb_build_object('basis', 'as_of', 'budget', cost.budget, 'committed', cost.committed, 'actual', cost.actual, 'accrual', cost.accrual,
           'actual_plus_accrual', (cost.actual + cost.accrual)::numeric(18,2)),
  'quality', jsonb_build_object('basis', 'as_of',
           'ncrs_open', (SELECT count(*) FROM ncrs WHERE project_id = p_project AND raised_date <= p_end AND (closed_date IS NULL OR closed_date > p_end)),
           'ncrs_raised_in_period', (SELECT count(*) FROM ncrs WHERE project_id = p_project AND raised_date BETWEEN p_start AND p_end)),
  'hse', jsonb_build_object('basis', 'as_of',
           'incidents_in_period', (SELECT count(*) FROM incidents WHERE project_id = p_project AND incident_date BETWEEN p_start AND p_end),
           'major_or_fatal_in_period', (SELECT count(*) FROM incidents WHERE project_id = p_project AND incident_date BETWEEN p_start AND p_end AND severity IN ('major','fatal'))),
  'time', jsonb_build_object('basis', 'at_capture', 'contracts', coalesce((
           SELECT jsonb_agg(jsonb_build_object('contract_id', tp.contract_id, 'original_completion', tp.original_completion, 'revised_completion', tp.revised_completion,
                  'approved_extension_days', tp.approved_extension_days, 'forecast_completion', tp.forecast_completion, 'forecast_source', tp.forecast_source,
                  'days_late', tp.days_late, 'ld_exposure', tp.ld_exposure) ORDER BY tp.contract_id)
             FROM contracts c CROSS JOIN LATERAL contract_time_position(c.id, NULL) tp
            WHERE c.project_id = p_project AND c.contract_status IN ('signed','active')), '[]'::jsonb)),
  'risks', jsonb_build_object('basis', 'at_capture',
           'open', (SELECT count(*) FROM risks WHERE project_id = p_project AND status <> 'closed'),
           'escalated', (SELECT count(*) FROM risks WHERE project_id = p_project AND status = 'escalated'),
           'open_threat_expected_value', (SELECT coalesce(sum(expected_value), 0)::numeric(18,2) FROM risks WHERE project_id = p_project AND status <> 'closed' AND kind = 'threat')),
  'exceptions', coalesce(exceptions.list, '[]'::jsonb),
  'exceptions_basis', 'cost exceptions as_of; notices and diaries at_capture')
FROM cost, exceptions;
$$;

CREATE OR REPLACE FUNCTION guard_report_pack() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Submitted or decided report packs cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Project not found in this organization'; END IF;
    IF NEW.period_end > current_date THEN RAISE EXCEPTION 'A report pack cannot be frozen for a period that has not ended'; END IF;
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A report pack starts as draft'; END IF;
    -- The content is always the database's own snapshot; a caller cannot supply figures.
    NEW.payload := project_report_snapshot(NEW.project_id, NEW.period_start, NEW.period_end);
    NEW.payload_sha256 := encode(sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex');
    NEW.exception_count := jsonb_array_length(NEW.payload->'exceptions');
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.project_id, NEW.period_type, NEW.period_start, NEW.period_end, NEW.payload, NEW.payload_sha256, NEW.exception_count, NEW.prepared_by, NEW.captured_at)
     IS DISTINCT FROM (OLD.org_id, OLD.project_id, OLD.period_type, OLD.period_start, OLD.period_end, OLD.payload, OLD.payload_sha256, OLD.exception_count, OLD.prepared_by, OLD.captured_at) THEN
    RAISE EXCEPTION 'A frozen report pack cannot change its period or content; reject it and freeze a new one';
  END IF;
  IF OLD.status IN ('approved','rejected') THEN RAISE EXCEPTION 'Report pack % is decided and immutable', OLD.id; END IF;
  IF OLD.status = 'submitted' AND NEW.narrative IS DISTINCT FROM OLD.narrative THEN RAISE EXCEPTION 'The narrative is frozen once submitted'; END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status IN ('draft','submitted')) OR (OLD.status = 'submitted' AND NEW.status IN ('approved','rejected'))) THEN
    RAISE EXCEPTION 'Invalid report pack transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_report_pack ON project_report_packs;
CREATE TRIGGER trg_report_pack BEFORE INSERT OR UPDATE OR DELETE ON project_report_packs FOR EACH ROW EXECUTE FUNCTION guard_report_pack();

ALTER TABLE project_report_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_report_packs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON project_report_packs;
DROP POLICY IF EXISTS tenant_isolation_write ON project_report_packs;
CREATE POLICY tenant_isolation_select ON project_report_packs FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint);
CREATE POLICY tenant_isolation_write ON project_report_packs FOR ALL USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint);

-- Report packs use reports.create / reports.edit / reports.approve; migration 010 seeded only view/export for the
-- System Admin role (new tenants already get every module x action from bootstrap). Same pattern as 010.
insert into permissions (role_id, module, action, scope)
select r.id, x.module, x.action, 'all'
from roles r
cross join (values ('reports','create'), ('reports','edit'), ('reports','approve')) as x(module, action)
where r.role_name = 'System Admin'
on conflict (role_id, module, action) do nothing;
