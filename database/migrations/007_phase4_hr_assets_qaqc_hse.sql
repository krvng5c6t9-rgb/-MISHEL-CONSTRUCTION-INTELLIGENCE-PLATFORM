-- ============================================================================
-- PHASE 4.1 — HR & PAYROLL
-- ============================================================================

ALTER TABLE employees
    ADD COLUMN employment_type VARCHAR(20) CHECK (employment_type IN ('staff','labor','daily_wage')),
    ADD COLUMN basic_salary NUMERIC(14,2),
    ADD COLUMN primary_project_id BIGINT REFERENCES projects(id);

CREATE TABLE attendance (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id),
    project_id BIGINT REFERENCES projects(id),
    attendance_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('present','absent','leave','overtime')),
    hours_worked NUMERIC(5,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (employee_id, attendance_date)
);

CREATE TABLE timesheets (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id),
    project_id BIGINT NOT NULL REFERENCES projects(id),
    cost_code_id BIGINT REFERENCES cost_codes(id),
    work_date DATE NOT NULL,
    hours NUMERIC(5,2) NOT NULL,
    activity_ref BIGINT REFERENCES schedule_activities(id),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
    approved_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_timesheets_project_status ON timesheets(project_id, status);

CREATE TABLE payroll_runs (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id),
    period_month DATE NOT NULL,
    run_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','posted','paid')),
    total_amount NUMERIC(18,2),
    approval_instance_id BIGINT REFERENCES approval_instances(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, period_month)
);

CREATE TABLE payroll_lines (
    id BIGSERIAL PRIMARY KEY,
    payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id),
    employee_id BIGINT NOT NULL REFERENCES employees(id),
    project_id BIGINT REFERENCES projects(id),   -- NULL = overhead (see Section 3)
    cost_code_id BIGINT REFERENCES cost_codes(id),
    currency_id BIGINT NOT NULL REFERENCES currencies(id),
    basic NUMERIC(14,2) NOT NULL DEFAULT 0,
    overtime NUMERIC(14,2) NOT NULL DEFAULT 0,
    allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
    deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_pay NUMERIC(14,2) GENERATED ALWAYS AS (basic + overtime + allowances - deductions) STORED,
    posted_cost_transaction_id BIGINT REFERENCES cost_transactions(id),   -- project_id NOT NULL rows only
    posted_gl_batch_id BIGINT,                                            -- project_id NULL rows only
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payroll_lines_run ON payroll_lines(payroll_run_id);
CREATE INDEX idx_payroll_lines_employee ON payroll_lines(employee_id);
-- One employee can have multiple rows in one run (one per project they split
-- across) — this IS the Phase 0 "shared staff allocation" answer: an explicit
-- row per project rather than a single percentage field nobody enforces.

CREATE TABLE leave_requests (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id),
    leave_type VARCHAR(30) NOT NULL CHECK (leave_type IN ('annual','sick','unpaid','other')),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    approved_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (to_date >= from_date)
);

CREATE TABLE recruitment (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id),
    position_title VARCHAR(150) NOT NULL,
    department_id BIGINT REFERENCES departments(id),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','interviewing','offered','closed')),
    requested_by BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 4.2 — ASSETS & EQUIPMENT
-- ============================================================================

CREATE TABLE assets_equipment (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id),
    asset_code VARCHAR(30) NOT NULL,
    asset_name VARCHAR(150) NOT NULL,
    category VARCHAR(50),
    ownership_type VARCHAR(20) NOT NULL CHECK (ownership_type IN ('owned','rented')),
    acquisition_date DATE,
    current_project_id BIGINT REFERENCES projects(id),
    status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_use','maintenance','retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, asset_code)
);

-- Phase 2's diary_equipment was free-text only, flagged at the time as a
-- simplification pending this table. Linked now, free text kept as fallback
-- for untracked one-off rentals.
ALTER TABLE diary_equipment ADD COLUMN asset_id BIGINT REFERENCES assets_equipment(id);

CREATE TABLE equipment_usage (
    id BIGSERIAL PRIMARY KEY,
    asset_id BIGINT NOT NULL REFERENCES assets_equipment(id),
    project_id BIGINT NOT NULL REFERENCES projects(id),
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    hours_used NUMERIC(6,2) NOT NULL,
    operator_id BIGINT REFERENCES employees(id),
    cost_code_id BIGINT REFERENCES cost_codes(id),
    currency_id BIGINT NOT NULL REFERENCES currencies(id),
    hourly_rate NUMERIC(10,2) NOT NULL,
    cost_amount NUMERIC(14,2) GENERATED ALWAYS AS (hours_used * hourly_rate) STORED,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
    approval_instance_id BIGINT REFERENCES approval_instances(id),
    posted_cost_transaction_id BIGINT REFERENCES cost_transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_usage_project ON equipment_usage(project_id);
CREATE INDEX idx_equipment_usage_asset ON equipment_usage(asset_id);

CREATE TABLE maintenance_log (
    id BIGSERIAL PRIMARY KEY,
    asset_id BIGINT NOT NULL REFERENCES assets_equipment(id),
    maintenance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('preventive','breakdown')),
    cost NUMERIC(14,2),
    next_due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Not wired into cost_transactions: maintenance is asset upkeep, not an
-- inherent project cost, unless a company later decides to re-bill it —
-- that decision wasn't specified, so it isn't invented here.

-- ============================================================================
-- PHASE 4.3 — QA/QC
-- ============================================================================

CREATE TABLE inspection_checklists (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    checklist_type VARCHAR(100) NOT NULL,
    activity_ref BIGINT REFERENCES schedule_activities(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','passed','failed')),
    inspected_by BIGINT REFERENCES users(id),
    inspection_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ncrs (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    ncr_no VARCHAR(30) NOT NULL,
    description TEXT NOT NULL,
    raised_by BIGINT NOT NULL REFERENCES users(id),
    raised_date DATE NOT NULL DEFAULT CURRENT_DATE,
    root_cause TEXT,
    corrective_action TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_date DATE,
    cost_impact NUMERIC(14,2),   -- >0 is a manual hand-off to Variation, same pattern as RFIs (Phase 2)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, ncr_no)
);

-- ============================================================================
-- PHASE 4.4 — HSE
-- ============================================================================

CREATE TABLE incidents (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    incident_date DATE NOT NULL DEFAULT CURRENT_DATE,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('near_miss','minor','major','fatality')),
    description TEXT NOT NULL,
    injured_party VARCHAR(150),
    reported_by BIGINT NOT NULL REFERENCES users(id),
    investigation_status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (investigation_status IN ('open','closed')),
    corrective_actions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE toolbox_talks (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    talk_date DATE NOT NULL DEFAULT CURRENT_DATE,
    topic VARCHAR(200) NOT NULL,
    attendees_count INT,
    conducted_by BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permits_to_work (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    permit_type VARCHAR(30) NOT NULL CHECK (permit_type IN ('hot_work','confined_space','height','other')),
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE,
    issued_by BIGINT NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 4.5 — FORMAL EDMS (register/transmittal discipline on top of `documents`)
-- ============================================================================

CREATE TABLE document_registers (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    register_type VARCHAR(30) NOT NULL CHECK (register_type IN ('drawings','correspondence','contracts','submittals','photos')),
    numbering_scheme VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_transmittals (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    transmittal_no VARCHAR(30) NOT NULL,
    from_party VARCHAR(150),
    to_party VARCHAR(150),
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    purpose VARCHAR(30) CHECK (purpose IN ('for_approval','for_information','for_construction')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, transmittal_no)
);

CREATE TABLE transmittal_lines (
    id BIGSERIAL PRIMARY KEY,
    transmittal_id BIGINT NOT NULL REFERENCES document_transmittals(id) ON DELETE CASCADE,
    document_id BIGINT NOT NULL REFERENCES documents(id),
    revision VARCHAR(10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION validate_cost_transaction_insert()
RETURNS TRIGGER AS $$
DECLARE
    r    cost_adjustment_requests%ROWTYPE;
    c    subcontract_certificates%ROWTYPE;
    s    subcontracts%ROWTYPE;
    pl   payroll_lines%ROWTYPE;
    pr   payroll_runs%ROWTYPE;
    eu   equipment_usage%ROWTYPE;
BEGIN

    IF NEW.source_module = 'manual_adjustment' THEN
        IF NEW.source_table <> 'cost_adjustment_requests' THEN
            RAISE EXCEPTION 'manual_adjustment rows must have source_table = ''cost_adjustment_requests'', got "%".', NEW.source_table;
        END IF;
        SELECT * INTO r FROM cost_adjustment_requests WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'No cost_adjustment_requests row with id %', NEW.source_record_id; END IF;
        IF r.status <> 'approved' THEN
            RAISE EXCEPTION 'cost_adjustment_requests % has status "%" — only an approved request may post.', r.id, r.status;
        END IF;
        IF r.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'cost_adjustment_requests % has already posted transaction %.', r.id, r.posted_cost_transaction_id;
        END IF;
        IF NEW.project_id <> r.project_id OR NEW.cost_code_id <> r.cost_code_id
           OR NEW.boq_item_id IS DISTINCT FROM r.boq_item_id OR NEW.currency_id <> r.currency_id
           OR NEW.transaction_type <> r.transaction_type OR NEW.amount <> r.requested_amount THEN
            RAISE EXCEPTION 'Posted adjustment does not match approved request % (all fields must be identical).', r.id;
        END IF;
        IF r.adjustment_type = 'reversal' THEN
            IF NEW.reversal_of_transaction_id IS DISTINCT FROM r.original_cost_transaction_id THEN
                RAISE EXCEPTION 'A reversal posting must set reversal_of_transaction_id = %.', r.original_cost_transaction_id;
            END IF;
        ELSE
            IF NEW.reversal_of_transaction_id IS NOT NULL THEN
                RAISE EXCEPTION 'A replacement posting must NOT set reversal_of_transaction_id.';
            END IF;
        END IF;
        RETURN NEW;

    ELSIF NEW.source_module = 'subcontract' THEN
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        IF NEW.source_table <> 'subcontract_certificates' THEN
            RAISE EXCEPTION 'subcontract rows must have source_table = ''subcontract_certificates'', got "%".', NEW.source_table;
        END IF;
        SELECT * INTO c FROM subcontract_certificates WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No subcontract_certificates row with id %', NEW.source_record_id; END IF;
        IF c.status <> 'approved' THEN
            RAISE EXCEPTION 'subcontract_certificates % has status "%" — only approved may post.', c.id, c.status;
        END IF;
        IF c.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'subcontract_certificates % already posted. Duplicate posting not permitted.', c.id;
        END IF;
        IF NEW.amount <> c.net_amount_due THEN
            RAISE EXCEPTION 'Posted amount (%) must equal net_amount_due (%) for certificate %.', NEW.amount, c.net_amount_due, c.id;
        END IF;
        IF NEW.project_id <> c.project_id THEN
            RAISE EXCEPTION 'project_id mismatch for certificate %.', c.id;
        END IF;
        SELECT * INTO s FROM subcontracts WHERE id = c.subcontract_id;
        IF NEW.currency_id <> s.currency_id THEN
            RAISE EXCEPTION 'currency_id must match subcontracts.currency_id for certificate %.', c.id;
        END IF;
        IF NEW.transaction_type <> 'actual' THEN
            RAISE EXCEPTION 'subcontract certificate postings must be transaction_type = ''actual''.';
        END IF;
        RETURN NEW;

    -- ---------------- hr_payroll: NEW in Phase 4 ----------------
    ELSIF NEW.source_module = 'hr_payroll' THEN
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        IF NEW.source_table <> 'payroll_lines' THEN
            RAISE EXCEPTION 'hr_payroll rows must have source_table = ''payroll_lines'', got "%".', NEW.source_table;
        END IF;

        SELECT * INTO pl FROM payroll_lines WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No payroll_lines row with id %', NEW.source_record_id; END IF;
        IF pl.project_id IS NULL THEN
            RAISE EXCEPTION 'payroll_lines % has no project_id — overhead payroll posts directly to GL (source_module=''payroll_overhead''), not to cost_transactions.', pl.id;
        END IF;

        SELECT * INTO pr FROM payroll_runs WHERE id = pl.payroll_run_id;
        IF pr.status <> 'approved' THEN
            RAISE EXCEPTION 'payroll_runs % has status "%" — only an approved run may post.', pr.id, pr.status;
        END IF;
        IF pl.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'payroll_lines % already posted. Duplicate posting not permitted.', pl.id;
        END IF;
        IF NEW.amount <> pl.net_pay THEN
            RAISE EXCEPTION 'Posted amount (%) must equal payroll_lines.net_pay (%) for line %.', NEW.amount, pl.net_pay, pl.id;
        END IF;
        IF NEW.project_id <> pl.project_id THEN
            RAISE EXCEPTION 'project_id mismatch for payroll_lines %.', pl.id;
        END IF;
        IF NEW.currency_id <> pl.currency_id THEN
            RAISE EXCEPTION 'currency_id mismatch for payroll_lines %.', pl.id;
        END IF;
        IF NEW.transaction_type <> 'actual' THEN
            RAISE EXCEPTION 'payroll postings must be transaction_type = ''actual''.';
        END IF;
        RETURN NEW;

    -- ---------------- equipment: NEW in Phase 4 ----------------
    ELSIF NEW.source_module = 'equipment' THEN
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        IF NEW.source_table <> 'equipment_usage' THEN
            RAISE EXCEPTION 'equipment rows must have source_table = ''equipment_usage'', got "%".', NEW.source_table;
        END IF;

        SELECT * INTO eu FROM equipment_usage WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No equipment_usage row with id %', NEW.source_record_id; END IF;
        IF eu.status <> 'approved' THEN
            RAISE EXCEPTION 'equipment_usage % has status "%" — only approved may post.', eu.id, eu.status;
        END IF;
        IF eu.posted_cost_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'equipment_usage % already posted. Duplicate posting not permitted.', eu.id;
        END IF;
        IF NEW.amount <> eu.cost_amount THEN
            RAISE EXCEPTION 'Posted amount (%) must equal equipment_usage.cost_amount (%) for row %.', NEW.amount, eu.cost_amount, eu.id;
        END IF;
        IF NEW.project_id <> eu.project_id THEN
            RAISE EXCEPTION 'project_id mismatch for equipment_usage %.', eu.id;
        END IF;
        IF NEW.currency_id <> eu.currency_id THEN
            RAISE EXCEPTION 'currency_id mismatch for equipment_usage %.', eu.id;
        END IF;
        IF NEW.transaction_type <> 'actual' THEN
            RAISE EXCEPTION 'equipment postings must be transaction_type = ''actual''.';
        END IF;
        RETURN NEW;

    ELSE
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        RETURN NEW;
    END IF;

END;
$$ LANGUAGE plpgsql;
ALTER TABLE general_ledger DROP CONSTRAINT general_ledger_source_module_check;
ALTER TABLE general_ledger ADD CONSTRAINT general_ledger_source_module_check
    CHECK (source_module IN ('cost_transaction','ipc','payment','manual_journal','payroll_overhead'));

ALTER TABLE gl_posting_rules DROP CONSTRAINT gl_posting_rules_source_module_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_source_module_check
    CHECK (source_module IN ('cost_transaction','ipc','payment','payroll_overhead'));

CREATE OR REPLACE FUNCTION validate_gl_insert()
RETURNS TRIGGER AS $$
DECLARE
    ct  cost_transactions%ROWTYPE;
    ipc ipcs%ROWTYPE;
    pay payments%ROWTYPE;
    mje manual_journal_entries%ROWTYPE;
    pl  payroll_lines%ROWTYPE;
    pr  payroll_runs%ROWTYPE;
BEGIN
    IF NEW.source_module = 'cost_transaction' THEN
        IF NEW.source_table <> 'cost_transactions' THEN
            RAISE EXCEPTION 'cost_transaction GL rows must have source_table = ''cost_transactions''.';
        END IF;
        SELECT * INTO ct FROM cost_transactions WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'cost_transactions row % not found', NEW.source_record_id; END IF;
        IF ct.is_posted_to_gl THEN RAISE EXCEPTION 'cost_transactions % already posted to GL.', ct.id; END IF;
        IF NEW.project_id IS DISTINCT FROM ct.project_id THEN RAISE EXCEPTION 'project_id mismatch for %.', ct.id; END IF;
        IF NEW.currency_id <> ct.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for %.', ct.id; END IF;

    ELSIF NEW.source_module = 'ipc' THEN
        IF NEW.source_table <> 'ipcs' THEN RAISE EXCEPTION 'ipc GL rows must have source_table = ''ipcs''.'; END IF;
        SELECT * INTO ipc FROM ipcs WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'ipcs row % not found', NEW.source_record_id; END IF;
        IF ipc.status <> 'client_approved' THEN RAISE EXCEPTION 'ipcs % status "%" not postable.', ipc.id, ipc.status; END IF;
        IF ipc.posted_ar_id IS NOT NULL THEN RAISE EXCEPTION 'ipcs % already posted.', ipc.id; END IF;
        IF NEW.project_id <> ipc.project_id THEN RAISE EXCEPTION 'project_id mismatch for %.', ipc.id; END IF;

    ELSIF NEW.source_module = 'payment' THEN
        IF NEW.source_table <> 'payments' THEN RAISE EXCEPTION 'payment GL rows must have source_table = ''payments''.'; END IF;
        SELECT * INTO pay FROM payments WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'payments row % not found', NEW.source_record_id; END IF;
        IF pay.status <> 'approved' THEN RAISE EXCEPTION 'payments % status "%" not postable.', pay.id, pay.status; END IF;
        IF NEW.currency_id <> pay.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for %.', pay.id; END IF;

    ELSIF NEW.source_module = 'manual_journal' THEN
        IF NEW.source_table <> 'manual_journal_entries' THEN RAISE EXCEPTION 'must have source_table = ''manual_journal_entries''.'; END IF;
        SELECT * INTO mje FROM manual_journal_entries WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'manual_journal_entries row % not found', NEW.source_record_id; END IF;
        IF mje.status <> 'approved' THEN RAISE EXCEPTION 'manual_journal_entries % status "%" not postable.', mje.id, mje.status; END IF;

    -- ---------------- payroll_overhead: NEW in Phase 4 ----------------
    ELSIF NEW.source_module = 'payroll_overhead' THEN
        IF NEW.source_table <> 'payroll_lines' THEN
            RAISE EXCEPTION 'payroll_overhead GL rows must have source_table = ''payroll_lines''.';
        END IF;
        SELECT * INTO pl FROM payroll_lines WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'payroll_lines row % not found', NEW.source_record_id; END IF;
        IF pl.project_id IS NOT NULL THEN
            RAISE EXCEPTION 'payroll_lines % has a project_id — project-allocated payroll posts via cost_transactions, not payroll_overhead.', pl.id;
        END IF;
        SELECT * INTO pr FROM payroll_runs WHERE id = pl.payroll_run_id;
        IF pr.status <> 'approved' THEN RAISE EXCEPTION 'payroll_runs % status "%" not postable.', pr.id, pr.status; END IF;
        IF pl.posted_gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'payroll_lines % already posted to GL.', pl.id; END IF;
        IF NEW.currency_id <> pl.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for payroll_lines %.', pl.id; END IF;

    ELSE
        RAISE EXCEPTION 'Unrecognized GL source_module "%".', NEW.source_module;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION guard_payroll_line_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.posted_cost_transaction_id IS NOT NULL OR OLD.posted_gl_batch_id IS NOT NULL THEN
        IF NEW.basic <> OLD.basic OR NEW.overtime <> OLD.overtime OR NEW.allowances <> OLD.allowances
           OR NEW.deductions <> OLD.deductions OR NEW.project_id IS DISTINCT FROM OLD.project_id
           OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id OR NEW.currency_id <> OLD.currency_id
           OR NEW.employee_id <> OLD.employee_id OR NEW.payroll_run_id <> OLD.payroll_run_id
        THEN
            RAISE EXCEPTION 'payroll_lines % is already posted and is frozen.', OLD.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_payroll_line_lock BEFORE UPDATE ON payroll_lines
    FOR EACH ROW EXECUTE FUNCTION guard_payroll_line_lock();

CREATE OR REPLACE FUNCTION guard_equipment_usage_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.posted_cost_transaction_id IS NOT NULL THEN
        IF NEW.hours_used <> OLD.hours_used OR NEW.hourly_rate <> OLD.hourly_rate
           OR NEW.project_id <> OLD.project_id OR NEW.cost_code_id IS DISTINCT FROM OLD.cost_code_id
           OR NEW.currency_id <> OLD.currency_id OR NEW.asset_id <> OLD.asset_id
        THEN
            RAISE EXCEPTION 'equipment_usage % is already posted and is frozen.', OLD.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_equipment_usage_lock BEFORE UPDATE ON equipment_usage
    FOR EACH ROW EXECUTE FUNCTION guard_equipment_usage_lock();
INSERT INTO roles (org_id, role_name, is_system_role) VALUES
(1, 'HR Manager', FALSE), (1, 'HSE Officer', FALSE), (1, 'QA/QC Engineer', FALSE),
(1, 'Document Controller', FALSE), (1, 'Plant/Equipment Coordinator', FALSE);

-- *** PLACEHOLDER thresholds — same caveat as every prior phase ***
INSERT INTO delegation_of_authority (org_id, module, min_amount, max_amount, currency_id, approval_level, approver_role_id, notes) VALUES
(1, 'payroll_run',      0, NULL,   1, 1, (SELECT id FROM roles WHERE role_name='Finance Manager'), 'PLACEHOLDER'),
(1, 'equipment_usage',  0, 20000,  1, 1, (SELECT id FROM roles WHERE role_name='Project Manager'), 'PLACEHOLDER'),
(1, 'equipment_usage',  20000.01, NULL, 1, 1, (SELECT id FROM roles WHERE role_name='Finance Manager'), 'PLACEHOLDER');

INSERT INTO approval_workflow_steps (org_id, module, step_no, doa_id, is_parallel, sla_hours)
SELECT 1, module, 1, id, FALSE, 48 FROM delegation_of_authority
WHERE module IN ('payroll_run','equipment_usage') AND approval_level = 1;
