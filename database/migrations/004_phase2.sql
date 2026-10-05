-- ============================================================================
-- PHASE 2.1 — TECHNICAL OFFICE
-- ============================================================================

CREATE TABLE drawings (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    drawing_no          VARCHAR(50) NOT NULL,
    title               VARCHAR(255) NOT NULL,
    discipline          VARCHAR(50),
    revision            VARCHAR(10) NOT NULL DEFAULT 'A',
    status              VARCHAR(30) NOT NULL DEFAULT 'for_review'
                            CHECK (status IN ('for_review','approved','approved_with_comments','rejected','superseded')),
    document_id         BIGINT REFERENCES documents(id),
    issued_by           BIGINT NOT NULL REFERENCES users(id),
    issued_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, drawing_no, revision)
);
CREATE INDEX idx_drawings_project_status ON drawings(project_id, status);

CREATE TABLE submittals (
    id                      BIGSERIAL PRIMARY KEY,
    project_id              BIGINT NOT NULL REFERENCES projects(id),
    submittal_no            VARCHAR(30) NOT NULL,
    type                    VARCHAR(30) NOT NULL CHECK (type IN ('material','shop_drawing','method_statement','sample','other')),
    description             TEXT NOT NULL,
    submitted_by            BIGINT NOT NULL REFERENCES users(id),
    submitted_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    reviewer_id             BIGINT REFERENCES users(id),
    status                  VARCHAR(30) NOT NULL DEFAULT 'submitted'
                                CHECK (status IN ('submitted','under_review','approved','approved_as_noted','rejected','resubmit_required')),
    due_date                DATE,
    actual_response_date    DATE,
    document_id             BIGINT REFERENCES documents(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, submittal_no)
);
CREATE INDEX idx_submittals_project_status ON submittals(project_id, status);

CREATE TABLE rfis (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    rfi_no              VARCHAR(30) NOT NULL,
    subject             VARCHAR(255) NOT NULL,
    question            TEXT NOT NULL,
    raised_by           BIGINT NOT NULL REFERENCES users(id),
    raised_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    assigned_to         BIGINT REFERENCES users(id),
    response            TEXT,
    response_date       DATE,
    cost_impact_flag    BOOLEAN NOT NULL DEFAULT FALSE,
    time_impact_flag    BOOLEAN NOT NULL DEFAULT FALSE,
    status              VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, rfi_no)
);
CREATE INDEX idx_rfis_project_status ON rfis(project_id, status);

CREATE TABLE method_statements (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    activity_name       VARCHAR(255) NOT NULL,
    document_id         BIGINT REFERENCES documents(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
    approved_by         BIGINT REFERENCES users(id),
    approval_date       DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 2.2 — PLANNING & SCHEDULING
-- ============================================================================

CREATE TABLE schedule_baselines (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    baseline_name       VARCHAR(100) NOT NULL,
    baseline_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    is_current          BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, baseline_name)
);
-- At most one current baseline per project — this is what PV in EVM is measured against.
CREATE UNIQUE INDEX uq_schedule_one_current_baseline
    ON schedule_baselines(project_id) WHERE is_current = TRUE;

CREATE TABLE schedule_activities (
    id                      BIGSERIAL PRIMARY KEY,
    project_id              BIGINT NOT NULL REFERENCES projects(id),
    cost_code_id            BIGINT REFERENCES cost_codes(id),   -- WBS linkage: this IS the EVM join key
    activity_id_ext         VARCHAR(30),                         -- P6 Activity ID, for XER/XML import traceability
    activity_name           VARCHAR(255) NOT NULL,
    planned_start            DATE,
    planned_finish            DATE,
    actual_start               DATE,
    actual_finish                DATE,
    planned_duration_days          INT,
    percent_complete                 NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
    predecessor_activity_id            BIGINT REFERENCES schedule_activities(id),
    baseline_id                          BIGINT REFERENCES schedule_baselines(id),
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sched_act_project  ON schedule_activities(project_id);
CREATE INDEX idx_sched_act_costcode ON schedule_activities(cost_code_id);
-- SIMPLIFICATION FLAGGED: single self-referencing predecessor_activity_id models a plain
-- finish-to-start chain only. Real P6 logic (multiple predecessors, FS/SS/FF/SF, lag) needs
-- a separate schedule_relationships(predecessor_id, successor_id, relationship_type, lag_days)
-- table — not built here because it wasn't in scope and would be invented, not requested.
-- Add it before P6 import if your schedules actually use non-FS relationships (they usually do).

CREATE TABLE progress_updates (
    id                      BIGSERIAL PRIMARY KEY,
    schedule_activity_id     BIGINT NOT NULL REFERENCES schedule_activities(id),
    update_date               DATE NOT NULL DEFAULT CURRENT_DATE,
    percent_complete            NUMERIC(5,2) NOT NULL CHECK (percent_complete BETWEEN 0 AND 100),
    updated_by                    BIGINT NOT NULL REFERENCES users(id),
    remarks                         TEXT,
    boq_item_id                       BIGINT REFERENCES project_boq(id),  -- physical quantity evidence link
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_updates_activity ON progress_updates(schedule_activity_id);

CREATE TABLE milestones (
    id                      BIGSERIAL PRIMARY KEY,
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    milestone_name             VARCHAR(200) NOT NULL,
    planned_date                 DATE,
    actual_date                    DATE,
    is_contractual                   BOOLEAN NOT NULL DEFAULT FALSE,
    payment_trigger_flag               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 2.3 — SITE EXECUTION
-- ============================================================================

CREATE TABLE site_diary (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    diary_date          DATE NOT NULL,
    weather              VARCHAR(50),
    work_performed         TEXT,
    delays_notes              TEXT,
    visitors                    TEXT,
    safety_notes                  TEXT,
    prepared_by                     BIGINT NOT NULL REFERENCES users(id),
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, diary_date)
);

CREATE TABLE diary_manpower (
    id                  BIGSERIAL PRIMARY KEY,
    diary_id            BIGINT NOT NULL REFERENCES site_diary(id) ON DELETE CASCADE,
    trade                VARCHAR(50) NOT NULL,
    subcontractor_id       BIGINT REFERENCES vendors_subcontractors(id),
    headcount                INT NOT NULL,
    hours                      NUMERIC(5,2),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE diary_equipment (
    id                      BIGSERIAL PRIMARY KEY,
    diary_id                BIGINT NOT NULL REFERENCES site_diary(id) ON DELETE CASCADE,
    equipment_description     VARCHAR(200) NOT NULL,   -- free text: assets_equipment table is Phase 4, not built yet
    hours_used                  NUMERIC(6,2),
    idle_hours                    NUMERIC(6,2),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE site_instructions (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    instruction_no       VARCHAR(30) NOT NULL,
    issued_by             BIGINT NOT NULL REFERENCES users(id),
    issued_to               VARCHAR(150),
    description                TEXT NOT NULL,
    issue_date                   DATE NOT NULL DEFAULT CURRENT_DATE,
    status                         VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','closed')),
    related_rfi_id                   BIGINT REFERENCES rfis(id),
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, instruction_no)
);

CREATE TABLE quantity_sheets (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    boq_item_id          BIGINT NOT NULL REFERENCES project_boq(id),
    measurement_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    location_ref             VARCHAR(150),
    quantity                   NUMERIC(14,3) NOT NULL,
    measured_by                  BIGINT NOT NULL REFERENCES users(id),
    checked_by                     BIGINT REFERENCES users(id),
    status                           VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified')),
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qty_sheets_boq_item ON quantity_sheets(boq_item_id);
CREATE INDEX idx_qty_sheets_project  ON quantity_sheets(project_id);
-- This is the QS's evidence file for IPC quantities in Phase 3 — every IPC line
-- should be traceable to verified rows here, not typed from memory.

CREATE TABLE punch_lists (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    location             VARCHAR(150),
    description             TEXT NOT NULL,
    raised_by                 BIGINT NOT NULL REFERENCES users(id),
    assigned_to                  BIGINT REFERENCES users(id),
    status                          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    due_date                          DATE,
    closed_date                          DATE,
    created_at                              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 2.4 — PROJECT CONTROLS / EVM
-- ============================================================================

CREATE TABLE budgets (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    cost_code_id         BIGINT NOT NULL REFERENCES cost_codes(id),
    budget_type            VARCHAR(20) NOT NULL DEFAULT 'original' CHECK (budget_type IN ('original','revised')),
    amount                    NUMERIC(18,2) NOT NULL,
    approved_by                 BIGINT REFERENCES users(id),
    approval_date                  DATE,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, cost_code_id, budget_type)
);

CREATE TABLE cost_forecasts (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    cost_code_id         BIGINT NOT NULL REFERENCES cost_codes(id),
    forecast_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    estimate_to_complete      NUMERIC(18,2) NOT NULL,
    estimate_at_completion       NUMERIC(18,2) NOT NULL,
    variance_reason                 TEXT,
    prepared_by                        BIGINT NOT NULL REFERENCES users(id),
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cost_forecasts_project_costcode ON cost_forecasts(project_id, cost_code_id);

CREATE TABLE evm_snapshots (
    id                          BIGSERIAL PRIMARY KEY,
    project_id                   BIGINT NOT NULL REFERENCES projects(id),
    snapshot_date                  DATE NOT NULL DEFAULT CURRENT_DATE,
    planned_value                    NUMERIC(18,2) NOT NULL,
    earned_value                        NUMERIC(18,2) NOT NULL,
    actual_cost                            NUMERIC(18,2) NOT NULL,
    cost_performance_index                    NUMERIC(6,4) GENERATED ALWAYS AS (
                                                  CASE WHEN actual_cost = 0 THEN NULL ELSE earned_value / actual_cost END
                                               ) STORED,
    schedule_performance_index                   NUMERIC(6,4) GENERATED ALWAYS AS (
                                                  CASE WHEN planned_value = 0 THEN NULL ELSE earned_value / planned_value END
                                               ) STORED,
    cost_variance                                   NUMERIC(18,2) GENERATED ALWAYS AS (earned_value - actual_cost) STORED,
    schedule_variance                                  NUMERIC(18,2) GENERATED ALWAYS AS (earned_value - planned_value) STORED,
    estimate_at_completion                                NUMERIC(18,2),
    created_at                                              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, snapshot_date)
);
-- Note: this table stores periodic SNAPSHOTS (weekly/monthly), computed from a batch job
-- reading schedule_activities (for PV against the current baseline) and cost_transactions
-- (for AC, summing transaction_type='actual'). EV = SUM(project_boq.contract_amount *
-- progress_updates.percent_complete) per cost code. Not a live view by design — EVM
-- should reflect a fixed reporting date, not recompute mid-scroll.

-- ============================================================================
-- PHASE 2.5 — SUBCONTRACT MANAGEMENT + CERTIFICATES
-- ============================================================================

CREATE TABLE subcontracts (
    id                      BIGSERIAL PRIMARY KEY,
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    vendor_id                  BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    package_name                 VARCHAR(200) NOT NULL,
    scope_of_work                   TEXT,
    contract_value                     NUMERIC(18,2) NOT NULL,
    currency_id                           BIGINT NOT NULL REFERENCES currencies(id),
    cost_code_id                             BIGINT REFERENCES cost_codes(id),
    retention_percent                           NUMERIC(5,2),
    advance_payment_percent                        NUMERIC(5,2),
    start_date                                        DATE,
    completion_date                                      DATE,
    status                                                  VARCHAR(20) NOT NULL DEFAULT 'draft'
                                                                CHECK (status IN ('draft','active','completed','terminated')),
    approval_instance_id                                        BIGINT REFERENCES approval_instances(id),
    created_by                                                     BIGINT REFERENCES users(id),
    created_at                                                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subcontracts_project ON subcontracts(project_id);
CREATE INDEX idx_subcontracts_vendor  ON subcontracts(vendor_id);

CREATE TABLE subcontract_certificates (
    id                          BIGSERIAL PRIMARY KEY,
    subcontract_id               BIGINT NOT NULL REFERENCES subcontracts(id),
    project_id                      BIGINT NOT NULL REFERENCES projects(id),
    certificate_no                     VARCHAR(30) NOT NULL,
    period_from                           DATE NOT NULL,
    period_to                                DATE NOT NULL,
    gross_work_done                             NUMERIC(18,2) NOT NULL DEFAULT 0,
    less_retention                                 NUMERIC(18,2) NOT NULL DEFAULT 0,
    less_advance_recovery                             NUMERIC(18,2) NOT NULL DEFAULT 0,
    less_previous_paid                                   NUMERIC(18,2) NOT NULL DEFAULT 0,
    penalties_deductions                                    NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_amount_due                                             NUMERIC(18,2) GENERATED ALWAYS AS (
                                                                    gross_work_done - less_retention - less_advance_recovery
                                                                    - less_previous_paid - penalties_deductions
                                                                 ) STORED,
    status                                                        VARCHAR(20) NOT NULL DEFAULT 'draft'
                                                                       CHECK (status IN ('draft','site_verified','qs_certified','approved','posted','paid')),
    approval_instance_id                                              BIGINT REFERENCES approval_instances(id),
    certified_by                                                         BIGINT REFERENCES users(id),
    posted_cost_transaction_id                                              BIGINT REFERENCES cost_transactions(id),
    created_at                                                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subcontract_id, certificate_no)
);
CREATE INDEX idx_subcontract_certs_project_status ON subcontract_certificates(project_id, status);
CREATE INDEX idx_subcontract_certs_subcontract     ON subcontract_certificates(subcontract_id);

CREATE TABLE subcontract_certificate_lines (
    id                      BIGSERIAL PRIMARY KEY,
    certificate_id           BIGINT NOT NULL REFERENCES subcontract_certificates(id) ON DELETE CASCADE,
    description                 TEXT NOT NULL,
    quantity_this_period           NUMERIC(14,3) NOT NULL,
    cumulative_quantity               NUMERIC(14,3) NOT NULL,
    unit_rate                            NUMERIC(14,2) NOT NULL,
    amount                                  NUMERIC(18,2) GENERATED ALWAYS AS (quantity_this_period * unit_rate) STORED,
    created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- END PHASE 2 DDL
-- ============================================================================
-- Roles activated in Phase 2 (append to the roles seeded in Phase 0)
INSERT INTO roles (org_id, role_name, is_system_role) VALUES
(1, 'Technical Office Manager', FALSE),
(1, 'Planning Manager', FALSE),
(1, 'Site/Construction Manager', FALSE),
(1, 'Site Engineer', FALSE),
(1, 'Project Controls/Cost Engineer', FALSE);

-- DOA — subcontract modules. Dummy round numbers, same as every prior DOA seed.
-- *** CONFIRM REAL THRESHOLDS BEFORE GO-LIVE ***
INSERT INTO delegation_of_authority (org_id, module, min_amount, max_amount, currency_id, approval_level, approver_role_id, notes) VALUES
(1, 'subcontract_signing',      0,        500000, 1, 1, (SELECT id FROM roles WHERE role_name='Contracts Manager'), 'PLACEHOLDER'),
(1, 'subcontract_signing',      500000.01, NULL,  1, 1, (SELECT id FROM roles WHERE role_name='General Manager'),   'PLACEHOLDER'),
(1, 'subcontract_certificate',  0,        200000, 1, 1, (SELECT id FROM roles WHERE role_name='Project Manager'),   'PLACEHOLDER'),
(1, 'subcontract_certificate',  200000.01, NULL,  1, 1, (SELECT id FROM roles WHERE role_name='Contracts Manager'), 'PLACEHOLDER');

INSERT INTO approval_workflow_steps (org_id, module, step_no, doa_id, is_parallel, sla_hours)
SELECT 1, module, 1, id, FALSE, 72
FROM delegation_of_authority
WHERE module IN ('subcontract_signing','subcontract_certificate') AND approval_level = 1;
