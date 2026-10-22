-- Stage 45 / CC-075: fatal incidents are counted in the frozen project report packs.
-- (transaction managed by migrator)
-- Before (E3 @34792e0): project_report_snapshot() (migration 065) counted 'major_or_fatal_in_period' as severity IN
-- ('major','fatal'), but incidents store 'fatality' (CHECK in incidents: near_miss / minor / major / fatality), so a
-- fatality was never counted in a report pack. Now: severity IN ('major','fatality'); the function is otherwise
-- unchanged (body copied from 065). Frozen packs keep their stored content and hash; verification recomputes the
-- snapshot, so a frozen pack whose period contains a fatality now reports data_changed_since_freeze = true - which is
-- correct: its stored count was wrong.
-- Rollback: re-run the function definition from 065.
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
           'major_or_fatal_in_period', (SELECT count(*) FROM incidents WHERE project_id = p_project AND incident_date BETWEEN p_start AND p_end AND severity IN ('major','fatality'))),
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
