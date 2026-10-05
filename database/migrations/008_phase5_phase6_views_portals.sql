-- Cost control: Budget vs Committed vs Actual vs Forecast, per cost code
CREATE OR REPLACE VIEW v_cost_control_summary AS
SELECT
    cc.project_id, cc.id AS cost_code_id, cc.code, cc.description,
    COALESCE(bud.amount, 0) AS budget,
    COALESCE(SUM(ct.amount) FILTER (WHERE ct.transaction_type = 'committed'), 0) AS committed,
    COALESCE(SUM(ct.amount) FILTER (WHERE ct.transaction_type = 'actual'), 0) AS actual,
    lf.estimate_at_completion,
    COALESCE(bud.amount, 0) - COALESCE(lf.estimate_at_completion, 0) AS variance_at_completion
FROM cost_codes cc
LEFT JOIN budgets bud ON bud.cost_code_id = cc.id AND bud.budget_type = 'original'
LEFT JOIN cost_transactions ct ON ct.cost_code_id = cc.id
LEFT JOIN LATERAL (
    SELECT estimate_at_completion FROM cost_forecasts f
    WHERE f.cost_code_id = cc.id ORDER BY forecast_date DESC LIMIT 1
) lf ON TRUE
WHERE cc.project_id IS NOT NULL
GROUP BY cc.project_id, cc.id, cc.code, cc.description, bud.amount, lf.estimate_at_completion;

-- BOQ vs Actual, per contract item
CREATE OR REPLACE VIEW v_boq_vs_actual AS
SELECT
    pb.project_id, pb.id AS boq_item_id, pb.item_no, pb.description,
    COALESCE(pb.revised_amount, pb.contract_amount) AS current_contract_amount,
    COALESCE(SUM(ct.amount) FILTER (WHERE ct.transaction_type = 'actual'), 0) AS actual_cost,
    COALESCE(SUM(ct.amount) FILTER (WHERE ct.transaction_type = 'actual'), 0)
        - COALESCE(pb.revised_amount, pb.contract_amount) AS variance
FROM project_boq pb
LEFT JOIN cost_transactions ct ON ct.boq_item_id = pb.id
GROUP BY pb.project_id, pb.id, pb.item_no, pb.description, pb.contract_amount, pb.revised_amount;

-- AR / AP aging
CREATE OR REPLACE VIEW v_ar_aging AS
SELECT ar.id, ar.client_id, ar.project_id, ar.amount, ar.due_date,
    (CURRENT_DATE - ar.due_date) AS days_overdue,
    CASE WHEN ar.due_date >= CURRENT_DATE THEN 'current'
         WHEN CURRENT_DATE - ar.due_date <= 30 THEN '1-30'
         WHEN CURRENT_DATE - ar.due_date <= 60 THEN '31-60'
         WHEN CURRENT_DATE - ar.due_date <= 90 THEN '61-90'
         ELSE '90+' END AS aging_bucket
FROM accounts_receivable ar WHERE ar.status <> 'paid';

CREATE OR REPLACE VIEW v_ap_aging AS
SELECT ap.id, ap.vendor_id, ap.project_id, ap.amount, ap.due_date,
    (CURRENT_DATE - ap.due_date) AS days_overdue,
    CASE WHEN ap.due_date >= CURRENT_DATE THEN 'current'
         WHEN CURRENT_DATE - ap.due_date <= 30 THEN '1-30'
         WHEN CURRENT_DATE - ap.due_date <= 60 THEN '31-60'
         WHEN CURRENT_DATE - ap.due_date <= 90 THEN '61-90'
         ELSE '90+' END AS aging_bucket
FROM accounts_payable ap WHERE ap.status <> 'paid';

-- Portfolio summary: the "3-number" PM view — % complete vs % billed vs % cost spent
CREATE OR REPLACE VIEW v_portfolio_summary AS
SELECT
    p.id AS project_id, p.project_name, p.status, p.current_contract_value,
    li.cumulative_billed,
    ROUND(100.0 * COALESCE(li.cumulative_billed,0) / NULLIF(p.current_contract_value,0), 1) AS percent_billed,
    le.cost_performance_index, le.schedule_performance_index, le.snapshot_date
FROM projects p
LEFT JOIN LATERAL (
    SELECT SUM(ib.cumulative_amount) AS cumulative_billed
    FROM ipcs i JOIN ipc_boq_lines ib ON ib.ipc_id = i.id
    WHERE i.id = (SELECT id FROM ipcs i2 WHERE i2.project_id = p.id
                  AND i2.status IN ('client_approved','posted','paid')
                  ORDER BY period_to DESC LIMIT 1)
) li ON TRUE
LEFT JOIN LATERAL (
    SELECT cost_performance_index, schedule_performance_index, snapshot_date
    FROM evm_snapshots e WHERE e.project_id = p.id ORDER BY snapshot_date DESC LIMIT 1
) le ON TRUE;

-- Tender win/loss
CREATE OR REPLACE VIEW v_tender_win_loss AS
SELECT org_id, DATE_TRUNC('quarter', submission_deadline)::date AS period,
    COUNT(*) FILTER (WHERE status='won') AS won_count,
    COUNT(*) FILTER (WHERE status='lost') AS lost_count,
    SUM(awarded_value) FILTER (WHERE status='won') AS won_value,
    SUM(estimated_value) FILTER (WHERE status='lost') AS lost_value
FROM tenders WHERE status IN ('won','lost')
GROUP BY org_id, DATE_TRUNC('quarter', submission_deadline);

-- Procurement cycle time: MR -> PO -> first delivery
CREATE OR REPLACE VIEW v_procurement_cycle_time AS
SELECT po.project_id, po.id AS po_id, mr.request_date, po.po_date,
    (po.po_date - mr.request_date) AS mr_to_po_days,
    grn.received_date, (grn.received_date - po.po_date) AS po_to_delivery_days
FROM purchase_orders po
LEFT JOIN material_requisitions mr ON mr.id = po.mr_id
LEFT JOIN LATERAL (
    SELECT MIN(received_date) AS received_date FROM goods_receipt_notes g WHERE g.po_id = po.id
) grn ON TRUE;
CREATE OR REPLACE FUNCTION notify_pending_approval()
RETURNS TRIGGER AS $$
DECLARE
    doa_row delegation_of_authority%ROWTYPE;
BEGIN
    SELECT d.* INTO doa_row
    FROM approval_workflow_steps s
    JOIN delegation_of_authority d ON d.id = s.doa_id
    WHERE s.org_id = NEW.org_id AND s.module = NEW.module AND s.step_no = NEW.current_step
      AND d.min_amount <= COALESCE(NEW.amount,0)
      AND (d.max_amount IS NULL OR d.max_amount >= COALESCE(NEW.amount,0))
    LIMIT 1;

    IF FOUND THEN
        INSERT INTO notifications (org_id, user_id, source_module, message, link)
        SELECT NEW.org_id, u.id, NEW.module,
               format('New %s pending your approval (record #%s)', NEW.module, NEW.record_id),
               format('/approvals/%s', NEW.id)
        FROM users u WHERE u.role_id = doa_row.approver_role_id AND u.is_active = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_pending_approval
    AFTER INSERT ON approval_instances
    FOR EACH ROW EXECUTE FUNCTION notify_pending_approval();
CREATE TABLE client_portal_access (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    client_id BIGINT NOT NULL REFERENCES clients(id),
    project_id BIGINT NOT NULL REFERENCES projects(id),
    granted_by BIGINT REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, project_id)
);

CREATE OR REPLACE FUNCTION validate_client_portal_access()
RETURNS TRIGGER AS $$
DECLARE u_type VARCHAR(20);
BEGIN
    SELECT user_type INTO u_type FROM users WHERE id = NEW.user_id;
    IF u_type <> 'client_portal' THEN
        RAISE EXCEPTION 'user % is not a client_portal user (type=%).', NEW.user_id, u_type;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_validate_client_portal_access
    BEFORE INSERT OR UPDATE ON client_portal_access
    FOR EACH ROW EXECUTE FUNCTION validate_client_portal_access();

CREATE TABLE subcontractor_portal_access (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    vendor_id BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    subcontract_id BIGINT REFERENCES subcontracts(id),   -- NULL = access to all of that vendor's packages
    granted_by BIGINT REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, vendor_id, subcontract_id)
);

CREATE OR REPLACE FUNCTION validate_subcontractor_portal_access()
RETURNS TRIGGER AS $$
DECLARE u_type VARCHAR(20);
BEGIN
    SELECT user_type INTO u_type FROM users WHERE id = NEW.user_id;
    IF u_type <> 'subcontractor_portal' THEN
        RAISE EXCEPTION 'user % is not a subcontractor_portal user (type=%).', NEW.user_id, u_type;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_validate_subcontractor_portal_access
    BEFORE INSERT OR UPDATE ON subcontractor_portal_access
    FOR EACH ROW EXECUTE FUNCTION validate_subcontractor_portal_access();
