-- ============================================================================
-- CONSTRUCTION ERP — PHASE 0 + PHASE 1 SCHEMA
-- PostgreSQL 14+
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PHASE 0.1 — ORGANIZATION, CURRENCY, DEPARTMENTS
-- ----------------------------------------------------------------------------

CREATE TABLE organizations (
    id                  BIGSERIAL PRIMARY KEY,
    parent_org_id       BIGINT REFERENCES organizations(id),
    name                VARCHAR(200) NOT NULL,
    legal_name          VARCHAR(200),
    tax_id              VARCHAR(50),
    address             TEXT,
    logo_url            TEXT,
    base_currency_id    BIGINT,  -- FK added after currencies table
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE currencies (
    id                      BIGSERIAL PRIMARY KEY,
    code                    VARCHAR(3) NOT NULL UNIQUE,       -- ISO 4217: EGP, USD, EUR
    name                    VARCHAR(50) NOT NULL,
    exchange_rate_to_base   NUMERIC(14,6) NOT NULL DEFAULT 1,
    rate_date               DATE NOT NULL DEFAULT CURRENT_DATE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organizations
    ADD CONSTRAINT fk_org_base_currency FOREIGN KEY (base_currency_id) REFERENCES currencies(id);

CREATE TABLE departments (
    id                      BIGSERIAL PRIMARY KEY,
    org_id                  BIGINT NOT NULL REFERENCES organizations(id),
    department_name         VARCHAR(100) NOT NULL,
    parent_department_id    BIGINT REFERENCES departments(id),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, department_name)
);

-- ----------------------------------------------------------------------------
-- PHASE 0.2 — ROLES, PERMISSIONS, EMPLOYEES, USERS
-- ----------------------------------------------------------------------------

CREATE TABLE roles (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    role_name           VARCHAR(100) NOT NULL,
    description         TEXT,
    is_system_role      BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE = cannot be deleted from UI
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, role_name)
);

CREATE TABLE employees (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    department_id       BIGINT REFERENCES departments(id),
    employee_code       VARCHAR(30) NOT NULL,
    full_name           VARCHAR(150) NOT NULL,
    job_title           VARCHAR(100),
    national_id         VARCHAR(30),
    phone               VARCHAR(30),
    email               VARCHAR(150),
    hire_date           DATE,
    termination_date    DATE,
    employment_status   VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (employment_status IN ('active','on_leave','terminated')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, employee_code)
);
-- NOTE: this is a lightweight identity record only (headcount + org placement).
-- Full HR (payroll, attendance, leave) is Phase 4 — not built here.

CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    employee_id         BIGINT REFERENCES employees(id),   -- NULL = external/portal user (future)
    role_id             BIGINT NOT NULL REFERENCES roles(id),
    full_name           VARCHAR(150) NOT NULL,
    email               VARCHAR(150) NOT NULL,
    phone               VARCHAR(30),
    password_hash       TEXT NOT NULL,
    user_type           VARCHAR(20) NOT NULL DEFAULT 'internal'
                            CHECK (user_type IN ('internal','client_portal','subcontractor_portal')),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, email)
);

CREATE TABLE permissions (
    id                  BIGSERIAL PRIMARY KEY,
    role_id             BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    module              VARCHAR(60) NOT NULL,       -- 'crm','tendering','boq','contracts','procurement', etc.
    action               VARCHAR(20) NOT NULL
                            CHECK (action IN ('view','create','edit','approve','delete','export')),
    scope               VARCHAR(20) NOT NULL DEFAULT 'own'
                            CHECK (scope IN ('own','department','all')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (role_id, module, action)
);

-- ----------------------------------------------------------------------------
-- PHASE 0.3 — CLIENTS, VENDORS/SUBCONTRACTORS
-- ----------------------------------------------------------------------------

CREATE TABLE clients (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    client_name         VARCHAR(200) NOT NULL,
    client_type         VARCHAR(20) NOT NULL DEFAULT 'private'
                            CHECK (client_type IN ('private','government','developer')),
    contact_person      VARCHAR(150),
    phone               VARCHAR(30),
    email               VARCHAR(150),
    address             TEXT,
    tax_id              VARCHAR(50),
    source              VARCHAR(20) CHECK (source IN ('referral','tender','direct','other')),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vendors_subcontractors (
    id                          BIGSERIAL PRIMARY KEY,
    org_id                      BIGINT NOT NULL REFERENCES organizations(id),
    vendor_name                 VARCHAR(200) NOT NULL,
    vendor_type                 VARCHAR(20) NOT NULL DEFAULT 'supplier'
                                    CHECK (vendor_type IN ('supplier','subcontractor','both')),
    trade_category               VARCHAR(100),
    contact_person              VARCHAR(150),
    phone                       VARCHAR(30),
    email                       VARCHAR(150),
    tax_id                      VARCHAR(50),
    bank_name                   VARCHAR(150),
    bank_account_no             VARCHAR(50),
    prequalification_status     VARCHAR(20) NOT NULL DEFAULT 'pending'
                                    CHECK (prequalification_status IN ('pending','approved','rejected','expired')),
    rating_score                NUMERIC(3,1),
    is_blacklisted              BOOLEAN NOT NULL DEFAULT FALSE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by                  BIGINT REFERENCES users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- PHASE 0.4 — PROJECTS, COST CODES
-- ----------------------------------------------------------------------------

CREATE TABLE cost_codes (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    project_id          BIGINT,  -- FK added after projects table; NULL = global/template code
    code                VARCHAR(30) NOT NULL,
    description         VARCHAR(255) NOT NULL,
    parent_code_id      BIGINT REFERENCES cost_codes(id),
    cost_type           VARCHAR(20) NOT NULL
                            CHECK (cost_type IN ('labor','material','equipment','subcontract','overhead','preliminaries')),
    unit_of_measure     VARCHAR(20),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, project_id, code)
);

CREATE TABLE projects (
    id                          BIGSERIAL PRIMARY KEY,
    org_id                      BIGINT NOT NULL REFERENCES organizations(id),
    project_code                VARCHAR(30) NOT NULL,
    project_name                VARCHAR(200) NOT NULL,
    project_type                VARCHAR(20) NOT NULL
                                    CHECK (project_type IN ('fit_out','finishing','construction','design_build')),
    client_id                   BIGINT REFERENCES clients(id),
    contract_id                 BIGINT,  -- FK added after contracts table (Phase 1)
    currency_id                 BIGINT NOT NULL REFERENCES currencies(id),
    project_manager_id          BIGINT REFERENCES users(id),
    status                      VARCHAR(20) NOT NULL DEFAULT 'lead'
                                    CHECK (status IN ('lead','tender','awarded','execution','closeout','closed','cancelled')),
    location                    TEXT,
    start_date                  DATE,
    planned_end_date            DATE,
    actual_end_date             DATE,
    original_contract_value     NUMERIC(18,2),
    current_contract_value      NUMERIC(18,2),
    retention_percent           NUMERIC(5,2),
    advance_payment_percent     NUMERIC(5,2),
    created_by                  BIGINT REFERENCES users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, project_code)
);

ALTER TABLE cost_codes
    ADD CONSTRAINT fk_cost_codes_project FOREIGN KEY (project_id) REFERENCES projects(id);

-- ----------------------------------------------------------------------------
-- PHASE 0.5 — DOCUMENTS
-- ----------------------------------------------------------------------------

CREATE TABLE documents (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    project_id          BIGINT REFERENCES projects(id),
    module_source       VARCHAR(60) NOT NULL,   -- 'tendering','contracts','procurement', etc.
    record_type         VARCHAR(60) NOT NULL,   -- 'tender','contract','po', etc.
    record_id           BIGINT,
    file_name           VARCHAR(255) NOT NULL,
    file_path           TEXT NOT NULL,
    version_no          INT NOT NULL DEFAULT 1,
    revision            VARCHAR(10),
    doc_number          VARCHAR(50),
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','for_approval','approved','superseded','rejected')),
    confidentiality     VARCHAR(20) NOT NULL DEFAULT 'internal'
                            CHECK (confidentiality IN ('public','internal','restricted')),
    uploaded_by         BIGINT NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- PHASE 0.6 — DELEGATION OF AUTHORITY + APPROVAL ENGINE
-- (configurable, no hardcoded thresholds — see Section 8 for placeholder seed rows)
-- ----------------------------------------------------------------------------

CREATE TABLE delegation_of_authority (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    module              VARCHAR(60) NOT NULL,        -- 'material_requisition','purchase_order','variation', etc.
    min_amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
    max_amount          NUMERIC(18,2),                -- NULL = unlimited (top tier)
    currency_id         BIGINT REFERENCES currencies(id),
    approval_level      SMALLINT NOT NULL,            -- 1 = first approver in chain, 2 = second, ...
    approver_role_id    BIGINT NOT NULL REFERENCES roles(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to        DATE,
    notes               TEXT,
    created_by          BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (max_amount IS NULL OR max_amount > min_amount)
);
CREATE INDEX idx_doa_module_active ON delegation_of_authority(org_id, module, is_active);

CREATE TABLE approval_workflow_steps (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    module              VARCHAR(60) NOT NULL,
    step_no             SMALLINT NOT NULL,
    doa_id              BIGINT NOT NULL REFERENCES delegation_of_authority(id),
    is_parallel         BOOLEAN NOT NULL DEFAULT FALSE,
    sla_hours           INT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, module, step_no, doa_id)
);

CREATE TABLE approval_instances (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    module              VARCHAR(60) NOT NULL,
    record_id           BIGINT NOT NULL,
    amount              NUMERIC(18,2),
    currency_id         BIGINT REFERENCES currencies(id),
    current_step        SMALLINT NOT NULL DEFAULT 1,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected','returned','cancelled')),
    initiated_by        BIGINT NOT NULL REFERENCES users(id),
    initiated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);
CREATE INDEX idx_approval_instances_module_status ON approval_instances(org_id, module, status);

CREATE TABLE approval_actions_log (
    id                          BIGSERIAL PRIMARY KEY,
    approval_instance_id       BIGINT NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,
    step_no                    SMALLINT NOT NULL,
    approver_id                BIGINT NOT NULL REFERENCES users(id),
    action                     VARCHAR(20) NOT NULL CHECK (action IN ('approved','rejected','returned')),
    comment                    TEXT,
    action_date                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- PHASE 0.7 — AUDIT LOG, NOTIFICATIONS, SYSTEM SETTINGS
-- ----------------------------------------------------------------------------

CREATE TABLE audit_log (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    user_id             BIGINT REFERENCES users(id),
    table_name          VARCHAR(100) NOT NULL,
    record_id           BIGINT,
    action               VARCHAR(20) NOT NULL CHECK (action IN ('insert','update','delete')),
    old_value           JSONB,
    new_value           JSONB,
    ip_address           VARCHAR(45),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);

CREATE TABLE notifications (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    user_id             BIGINT NOT NULL REFERENCES users(id),
    source_module       VARCHAR(60),
    message             TEXT NOT NULL,
    link                TEXT,
    is_read             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read);

CREATE TABLE system_settings (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    setting_key         VARCHAR(100) NOT NULL,
    setting_value       TEXT,
    data_type           VARCHAR(20) NOT NULL DEFAULT 'string'
                            CHECK (data_type IN ('string','number','boolean','json')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, setting_key)
);

-- ============================================================================
-- PHASE 1.1 — CRM
-- ============================================================================

CREATE TABLE leads (
    id                      BIGSERIAL PRIMARY KEY,
    org_id                  BIGINT NOT NULL REFERENCES organizations(id),
    lead_name               VARCHAR(200) NOT NULL,
    client_id               BIGINT REFERENCES clients(id),
    source                  VARCHAR(20) CHECK (source IN ('referral','tender','direct','marketing','other')),
    project_type            VARCHAR(20) CHECK (project_type IN ('fit_out','finishing','construction','design_build')),
    estimated_value         NUMERIC(18,2),
    currency_id             BIGINT REFERENCES currencies(id),
    stage                   VARCHAR(20) NOT NULL DEFAULT 'new'
                                CHECK (stage IN ('new','qualified','proposal','won','lost')),
    owner_id                BIGINT NOT NULL REFERENCES users(id),
    expected_close_date     DATE,
    notes                   TEXT,
    created_by              BIGINT REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_stage ON leads(org_id, stage);

CREATE TABLE lead_activities (
    id                  BIGSERIAL PRIMARY KEY,
    lead_id             BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    activity_type       VARCHAR(20) NOT NULL CHECK (activity_type IN ('call','meeting','site_visit','email','other')),
    activity_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
    performed_by        BIGINT NOT NULL REFERENCES users(id),
    notes               TEXT,
    next_action_date    DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id);

CREATE TABLE opportunities (
    id                          BIGSERIAL PRIMARY KEY,
    lead_id                     BIGINT NOT NULL REFERENCES leads(id),
    opportunity_name            VARCHAR(200) NOT NULL,
    estimated_value             NUMERIC(18,2),
    currency_id                 BIGINT REFERENCES currencies(id),
    probability_percent         NUMERIC(5,2) CHECK (probability_percent BETWEEN 0 AND 100),
    status                      VARCHAR(20) NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open','converted','lost')),
    converts_to_tender_id       BIGINT,  -- FK added after tenders table
    created_by                  BIGINT REFERENCES users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 1.2 — TENDERING
-- ============================================================================

CREATE TABLE tenders (
    id                          BIGSERIAL PRIMARY KEY,
    org_id                      BIGINT NOT NULL REFERENCES organizations(id),
    opportunity_id              BIGINT REFERENCES opportunities(id),
    client_id                   BIGINT REFERENCES clients(id),
    tender_ref                  VARCHAR(50) NOT NULL,
    tender_title                VARCHAR(200) NOT NULL,
    tender_type                 VARCHAR(20) NOT NULL DEFAULT 'private'
                                    CHECK (tender_type IN ('public','private','invited')),
    submission_deadline         TIMESTAMPTZ,
    bond_required               BOOLEAN NOT NULL DEFAULT FALSE,
    bond_amount                 NUMERIC(18,2),
    estimated_value             NUMERIC(18,2),
    currency_id                 BIGINT REFERENCES currencies(id),
    assigned_estimator_id       BIGINT REFERENCES users(id),
    status                      VARCHAR(20) NOT NULL DEFAULT 'invited'
                                    CHECK (status IN ('invited','in_progress','submitted','won','lost','withdrawn')),
    awarded_value                NUMERIC(18,2),               -- filled on 'won'
    loss_reason                 TEXT,                          -- filled on 'lost'
    converts_to_project_id      BIGINT REFERENCES projects(id),-- filled on 'won'
    approval_instance_id        BIGINT REFERENCES approval_instances(id),
    created_by                  BIGINT REFERENCES users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, tender_ref)
);

ALTER TABLE opportunities
    ADD CONSTRAINT fk_opp_tender FOREIGN KEY (converts_to_tender_id) REFERENCES tenders(id);

CREATE TABLE tender_documents (
    id                  BIGSERIAL PRIMARY KEY,
    tender_id           BIGINT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
    doc_type            VARCHAR(30) NOT NULL
                            CHECK (doc_type IN ('rfp','drawings','specs','boq_template','addendum','other')),
    document_id         BIGINT NOT NULL REFERENCES documents(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tender_clarifications (
    id                  BIGSERIAL PRIMARY KEY,
    tender_id           BIGINT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
    question            TEXT NOT NULL,
    answer              TEXT,
    raised_by           BIGINT NOT NULL REFERENCES users(id),
    raised_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_date       TIMESTAMPTZ,
    status              VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 1.3 — ESTIMATION & BOQ
-- ============================================================================

CREATE TABLE resource_library (
    id                      BIGSERIAL PRIMARY KEY,
    org_id                  BIGINT NOT NULL REFERENCES organizations(id),
    resource_type           VARCHAR(20) NOT NULL CHECK (resource_type IN ('material','labor','equipment')),
    resource_name           VARCHAR(200) NOT NULL,
    unit_of_measure         VARCHAR(20) NOT NULL,
    current_market_rate     NUMERIC(14,2),
    currency_id             BIGINT REFERENCES currencies(id),
    last_updated            DATE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE boq_master (
    id                          BIGSERIAL PRIMARY KEY,
    tender_id                   BIGINT REFERENCES tenders(id),
    project_id                  BIGINT REFERENCES projects(id),
    item_no                     VARCHAR(20) NOT NULL,
    section                     VARCHAR(150),
    description                 TEXT NOT NULL,
    unit_of_measure             VARCHAR(20) NOT NULL,
    quantity                    NUMERIC(14,3) NOT NULL DEFAULT 0,
    cost_code_id                BIGINT REFERENCES cost_codes(id),
    unit_rate_material          NUMERIC(14,2) NOT NULL DEFAULT 0,
    unit_rate_labor             NUMERIC(14,2) NOT NULL DEFAULT 0,
    unit_rate_equipment         NUMERIC(14,2) NOT NULL DEFAULT 0,
    unit_rate_subcontract       NUMERIC(14,2) NOT NULL DEFAULT 0,
    overhead_percent            NUMERIC(5,2) NOT NULL DEFAULT 0,
    profit_percent              NUMERIC(5,2) NOT NULL DEFAULT 0,
    total_rate                  NUMERIC(14,2) GENERATED ALWAYS AS (
                                    (unit_rate_material + unit_rate_labor + unit_rate_equipment + unit_rate_subcontract)
                                    * (1 + overhead_percent / 100) * (1 + profit_percent / 100)
                                 ) STORED,
    total_amount                NUMERIC(18,2) GENERATED ALWAYS AS (
                                    quantity * (unit_rate_material + unit_rate_labor + unit_rate_equipment + unit_rate_subcontract)
                                    * (1 + overhead_percent / 100) * (1 + profit_percent / 100)
                                 ) STORED,
    approval_instance_id        BIGINT REFERENCES approval_instances(id),
    created_by                  BIGINT REFERENCES users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (tender_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE INDEX idx_boq_master_tender ON boq_master(tender_id);
CREATE INDEX idx_boq_master_project ON boq_master(project_id);

CREATE TABLE boq_rate_buildup (
    id                      BIGSERIAL PRIMARY KEY,
    boq_master_id           BIGINT NOT NULL REFERENCES boq_master(id) ON DELETE CASCADE,
    resource_type           VARCHAR(20) NOT NULL CHECK (resource_type IN ('material','labor','equipment')),
    resource_id             BIGINT REFERENCES resource_library(id),
    quantity_per_unit       NUMERIC(14,4) NOT NULL,
    unit_cost               NUMERIC(14,2) NOT NULL,
    source                  VARCHAR(20) NOT NULL DEFAULT 'own_db' CHECK (source IN ('own_db','vendor_quote')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_boq (
    id                      BIGSERIAL PRIMARY KEY,
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    boq_master_id            BIGINT REFERENCES boq_master(id),   -- traceability to originating tender BOQ
    item_no                  VARCHAR(20) NOT NULL,
    section                  VARCHAR(150),
    description              TEXT NOT NULL,
    unit_of_measure          VARCHAR(20) NOT NULL,
    contract_quantity        NUMERIC(14,3) NOT NULL DEFAULT 0,
    contract_unit_rate       NUMERIC(14,2) NOT NULL DEFAULT 0,
    contract_amount          NUMERIC(18,2) GENERATED ALWAYS AS (contract_quantity * contract_unit_rate) STORED,
    revised_quantity         NUMERIC(14,3),      -- set only via approved variations
    revised_amount           NUMERIC(18,2),      -- set only via approved variations
    cost_code_id             BIGINT REFERENCES cost_codes(id),
    is_locked                BOOLEAN NOT NULL DEFAULT TRUE,   -- app layer must block direct edits when TRUE (Risk 3 control)
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, item_no)
);
CREATE INDEX idx_project_boq_project ON project_boq(project_id);
CREATE INDEX idx_project_boq_cost_code ON project_boq(cost_code_id);

-- ============================================================================
-- PHASE 1.4 — CONTRACTS
-- ============================================================================

CREATE TABLE contracts (
    id                          BIGSERIAL PRIMARY KEY,
    project_id                  BIGINT NOT NULL REFERENCES projects(id),
    client_id                   BIGINT NOT NULL REFERENCES clients(id),
    contract_type                VARCHAR(20) NOT NULL CHECK (contract_type IN ('lump_sum','unit_price','cost_plus')),
    contract_form                VARCHAR(30)          -- PLACEHOLDER until Missing Requirement #2 confirmed
                                    CHECK (contract_form IN ('fidic_red','fidic_yellow','fidic_silver','custom')),
    contract_value               NUMERIC(18,2) NOT NULL,
    currency_id                  BIGINT NOT NULL REFERENCES currencies(id),
    signing_date                 DATE,
    effective_date               DATE,
    completion_period_days       INT,
    defects_liability_months     INT,
    retention_percent            NUMERIC(5,2),
    advance_payment_percent      NUMERIC(5,2),
    performance_bond_percent     NUMERIC(5,2),
    liquidated_damages_rate      NUMERIC(6,4),
    contract_status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                                    CHECK (contract_status IN ('draft','under_review','signed','active','closed','terminated')),
    approval_instance_id         BIGINT REFERENCES approval_instances(id),
    created_by                   BIGINT REFERENCES users(id),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects
    ADD CONSTRAINT fk_project_contract FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE TABLE contract_clauses (
    id                  BIGSERIAL PRIMARY KEY,
    contract_id         BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    clause_ref          VARCHAR(30),
    clause_title        VARCHAR(200),
    clause_text         TEXT,
    category            VARCHAR(20) CHECK (category IN ('payment','variation','dispute','termination','general')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE variations (
    id                          BIGSERIAL PRIMARY KEY,
    project_id                  BIGINT NOT NULL REFERENCES projects(id),
    contract_id                 BIGINT NOT NULL REFERENCES contracts(id),
    variation_no                VARCHAR(20) NOT NULL,
    description                 TEXT NOT NULL,
    initiated_by                BIGINT NOT NULL REFERENCES users(id),
    reason                      VARCHAR(30) CHECK (reason IN ('client_request','design_change','site_condition','other')),
    cost_impact                 NUMERIC(18,2) NOT NULL DEFAULT 0,
    time_impact_days            INT NOT NULL DEFAULT 0,
    status                      VARCHAR(20) NOT NULL DEFAULT 'proposed'
                                    CHECK (status IN ('proposed','under_review','approved','rejected')),
    approval_instance_id        BIGINT REFERENCES approval_instances(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, variation_no)
);
CREATE INDEX idx_variations_project ON variations(project_id);

CREATE TABLE variation_boq_lines (
    id                      BIGSERIAL PRIMARY KEY,
    variation_id            BIGINT NOT NULL REFERENCES variations(id) ON DELETE CASCADE,
    project_boq_item_id     BIGINT REFERENCES project_boq(id),  -- NULL = brand-new BOQ item
    description              TEXT NOT NULL,
    unit_of_measure          VARCHAR(20) NOT NULL,
    quantity                 NUMERIC(14,3) NOT NULL,
    unit_rate                NUMERIC(14,2) NOT NULL,
    amount                   NUMERIC(18,2) GENERATED ALWAYS AS (quantity * unit_rate) STORED,
    action                   VARCHAR(10) NOT NULL CHECK (action IN ('add','omit','amend')),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PHASE 1.5 — PROCUREMENT & COST TRANSACTIONS
-- ============================================================================

CREATE TABLE material_requisitions (
    id                      BIGSERIAL PRIMARY KEY,
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    requested_by             BIGINT NOT NULL REFERENCES users(id),
    cost_code_id             BIGINT REFERENCES cost_codes(id),
    boq_item_id              BIGINT REFERENCES project_boq(id),
    mr_no                    VARCHAR(30) NOT NULL,
    request_date              DATE NOT NULL DEFAULT CURRENT_DATE,
    required_date             DATE,
    status                    VARCHAR(20) NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','approved','in_procurement','closed','cancelled')),
    approval_instance_id      BIGINT REFERENCES approval_instances(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, mr_no)
);
CREATE INDEX idx_mr_project_status ON material_requisitions(project_id, status);

CREATE TABLE mr_lines (
    id                  BIGSERIAL PRIMARY KEY,
    mr_id               BIGINT NOT NULL REFERENCES material_requisitions(id) ON DELETE CASCADE,
    item_description    TEXT NOT NULL,
    unit_of_measure     VARCHAR(20) NOT NULL,
    quantity             NUMERIC(14,3) NOT NULL,
    spec_ref             VARCHAR(100),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rfqs (
    id                  BIGSERIAL PRIMARY KEY,
    project_id           BIGINT NOT NULL REFERENCES projects(id),
    mr_id                BIGINT REFERENCES material_requisitions(id),
    rfq_ref              VARCHAR(30) NOT NULL,
    issue_date            DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date              DATE,
    status                VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, rfq_ref)
);

CREATE TABLE rfq_vendors (
    id                  BIGSERIAL PRIMARY KEY,
    rfq_id               BIGINT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
    vendor_id             BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    invited_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    quote_received         BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (rfq_id, vendor_id)
);

CREATE TABLE vendor_quotations (
    id                          BIGSERIAL PRIMARY KEY,
    rfq_id                       BIGINT NOT NULL REFERENCES rfqs(id),
    vendor_id                    BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    quotation_ref                 VARCHAR(50),
    total_amount                  NUMERIC(18,2) NOT NULL,
    currency_id                   BIGINT NOT NULL REFERENCES currencies(id),
    validity_date                  DATE,
    lead_time_days                 INT,
    payment_terms                  VARCHAR(150),
    attachment_document_id         BIGINT REFERENCES documents(id),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comparative_statements (
    id                          BIGSERIAL PRIMARY KEY,
    rfq_id                       BIGINT NOT NULL REFERENCES rfqs(id),
    prepared_by                  BIGINT NOT NULL REFERENCES users(id),
    recommended_vendor_id         BIGINT REFERENCES vendors_subcontractors(id),
    justification                 TEXT,
    status                        VARCHAR(20) NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','submitted','approved','rejected')),
    approval_instance_id          BIGINT REFERENCES approval_instances(id),
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
    id                      BIGSERIAL PRIMARY KEY,
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    vendor_id                 BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    mr_id                     BIGINT REFERENCES material_requisitions(id),
    cost_code_id              BIGINT REFERENCES cost_codes(id),
    po_ref                    VARCHAR(30) NOT NULL,
    po_date                   DATE NOT NULL DEFAULT CURRENT_DATE,
    total_amount               NUMERIC(18,2) NOT NULL,
    currency_id                BIGINT NOT NULL REFERENCES currencies(id),
    payment_terms               VARCHAR(150),
    delivery_terms               VARCHAR(150),
    status                       VARCHAR(20) NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','approved','issued','partially_delivered','closed','cancelled')),
    approval_instance_id         BIGINT REFERENCES approval_instances(id),
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, po_ref)
);
CREATE INDEX idx_po_project_status ON purchase_orders(project_id, status);
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);

CREATE TABLE po_lines (
    id                  BIGSERIAL PRIMARY KEY,
    po_id                BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    boq_item_id           BIGINT REFERENCES project_boq(id),
    item_description       TEXT NOT NULL,
    unit_of_measure        VARCHAR(20) NOT NULL,
    quantity                NUMERIC(14,3) NOT NULL,
    unit_rate               NUMERIC(14,2) NOT NULL,
    amount                   NUMERIC(18,2) GENERATED ALWAYS AS (quantity * unit_rate) STORED,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goods_receipt_notes (
    id                  BIGSERIAL PRIMARY KEY,
    po_id                BIGINT NOT NULL REFERENCES purchase_orders(id),
    project_id            BIGINT NOT NULL REFERENCES projects(id),
    grn_no                 VARCHAR(30) NOT NULL,
    received_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    received_by             BIGINT NOT NULL REFERENCES users(id),
    status                   VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, grn_no)
);

CREATE TABLE grn_lines (
    id                      BIGSERIAL PRIMARY KEY,
    grn_id                    BIGINT NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    po_line_id                 BIGINT NOT NULL REFERENCES po_lines(id),
    quantity_received            NUMERIC(14,3) NOT NULL,
    quantity_accepted             NUMERIC(14,3) NOT NULL,
    quantity_rejected              NUMERIC(14,3) NOT NULL DEFAULT 0,
    rejection_reason                TEXT,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vendor_invoices (
    id                          BIGSERIAL PRIMARY KEY,
    vendor_id                    BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    project_id                    BIGINT NOT NULL REFERENCES projects(id),
    po_id                          BIGINT REFERENCES purchase_orders(id),
    invoice_no                      VARCHAR(50) NOT NULL,
    invoice_date                     DATE NOT NULL,
    amount                            NUMERIC(18,2) NOT NULL,
    tax_amount                        NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency_id                       BIGINT NOT NULL REFERENCES currencies(id),
    matched_grn_id                     BIGINT REFERENCES goods_receipt_notes(id),
    match_variance_amount               NUMERIC(18,2) NOT NULL DEFAULT 0,
    match_variance_reason                TEXT,
    status                                VARCHAR(20) NOT NULL DEFAULT 'received'
                                            CHECK (status IN ('received','matched','disputed','approved','posted_to_gl','paid')),
    approval_instance_id                  BIGINT REFERENCES approval_instances(id),
    due_date                               DATE,
    created_at                              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vendor_id, invoice_no)
);
CREATE INDEX idx_vendor_invoices_project_status ON vendor_invoices(project_id, status);

CREATE TABLE cost_transactions (
    id                      BIGSERIAL PRIMARY KEY,
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    cost_code_id              BIGINT NOT NULL REFERENCES cost_codes(id),
    boq_item_id               BIGINT REFERENCES project_boq(id),
    source_module              VARCHAR(30) NOT NULL
                                CHECK (source_module IN ('procurement','subcontract','hr_payroll','equipment','overhead','manual_adjustment')),
    source_table                VARCHAR(60) NOT NULL,      -- e.g. 'purchase_orders','vendor_invoices'
    source_record_id             BIGINT NOT NULL,
    transaction_type              VARCHAR(20) NOT NULL CHECK (transaction_type IN ('committed','actual')),
    amount                         NUMERIC(18,2) NOT NULL,
    currency_id                    BIGINT NOT NULL REFERENCES currencies(id),
    transaction_date                DATE NOT NULL DEFAULT CURRENT_DATE,
    description                      TEXT,
    is_posted_to_gl                  BOOLEAN NOT NULL DEFAULT FALSE,  -- consumed by Phase 3 GL auto-posting job
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cost_txn_project_costcode ON cost_transactions(project_id, cost_code_id);
CREATE INDEX idx_cost_txn_type ON cost_transactions(project_id, transaction_type);
CREATE INDEX idx_cost_txn_source ON cost_transactions(source_table, source_record_id);

-- ============================================================================
-- END OF PHASE 0 + PHASE 1 DDL
-- ============================================================================
-- Organization (edit to your real registration details)
INSERT INTO organizations (name, legal_name, tax_id) VALUES
('Al Sadim Architects & Consultants', 'PLACEHOLDER — confirm legal name', 'PLACEHOLDER — confirm tax ID');

-- Base currency
INSERT INTO currencies (code, name, exchange_rate_to_base) VALUES
('EGP', 'Egyptian Pound', 1.000000);

UPDATE organizations SET base_currency_id = (SELECT id FROM currencies WHERE code = 'EGP') WHERE id = 1;

-- Roles (matches Section 4 matrix; org_id assumes the org inserted above = 1)
INSERT INTO roles (org_id, role_name, is_system_role) VALUES
(1, 'System Admin', TRUE),
(1, 'General Manager', TRUE),
(1, 'BD Manager', FALSE),
(1, 'Tendering Manager', FALSE),
(1, 'Chief Estimator', FALSE),
(1, 'QS', FALSE),
(1, 'Contracts Manager', FALSE),
(1, 'Procurement Manager', FALSE),
(1, 'Project Manager', FALSE),
(1, 'Finance Manager', FALSE);

-- Cost code types (global templates, project_id NULL)
INSERT INTO cost_codes (org_id, code, description, cost_type) VALUES
(1, 'LAB-000', 'Labor — general template', 'labor'),
(1, 'MAT-000', 'Material — general template', 'material'),
(1, 'EQP-000', 'Equipment — general template', 'equipment'),
(1, 'SUB-000', 'Subcontract — general template', 'subcontract'),
(1, 'OVH-000', 'Overhead — general template', 'overhead'),
(1, 'PRE-000', 'Preliminaries — general template', 'preliminaries');

-- ============================================================
-- DELEGATION OF AUTHORITY — PLACEHOLDER THRESHOLDS
-- *** DO NOT GO LIVE WITH THESE VALUES — CONFIRM ACTUAL AMOUNTS ***
-- Structure demonstrates a 3-tier chain per module; amounts are dummy
-- round numbers only to prove the mechanism, not company policy.
-- ============================================================
INSERT INTO delegation_of_authority (org_id, module, min_amount, max_amount, currency_id, approval_level, approver_role_id, notes) VALUES
(1, 'purchase_order', 0,        50000,   1, 1, (SELECT id FROM roles WHERE role_name='Procurement Manager'), 'PLACEHOLDER — confirm Tier 1 ceiling'),
(1, 'purchase_order', 50000.01, 250000,  1, 1, (SELECT id FROM roles WHERE role_name='Project Manager'),     'PLACEHOLDER — confirm Tier 2 ceiling'),
(1, 'purchase_order', 250000.01, NULL,   1, 1, (SELECT id FROM roles WHERE role_name='General Manager'),     'PLACEHOLDER — confirm top tier, unlimited above this'),

(1, 'variation',      0,        100000,  1, 1, (SELECT id FROM roles WHERE role_name='Project Manager'),      'PLACEHOLDER'),
(1, 'variation',      100000.01, 500000, 1, 1, (SELECT id FROM roles WHERE role_name='Contracts Manager'),    'PLACEHOLDER'),
(1, 'variation',      500000.01, NULL,   1, 1, (SELECT id FROM roles WHERE role_name='General Manager'),      'PLACEHOLDER'),

(1, 'contract_signing', 0,       NULL,   1, 1, (SELECT id FROM roles WHERE role_name='Contracts Manager'), 'PLACEHOLDER — confirm if GM co-sign is required at all tiers'),
(1, 'contract_signing', 0,       NULL,   1, 2, (SELECT id FROM roles WHERE role_name='General Manager'),   'PLACEHOLDER — set as step 2 for all contracts, or tier by value'),

(1, 'material_requisition', 0,  NULL,    1, 1, (SELECT id FROM roles WHERE role_name='Project Manager'), 'PLACEHOLDER'),

(1, 'tender_submission', 0,     NULL,    1, 1, (SELECT id FROM roles WHERE role_name='Tendering Manager'), 'PLACEHOLDER'),

(1, 'vendor_invoice', 0,        NULL,    1, 1, (SELECT id FROM roles WHERE role_name='Finance Manager'), 'PLACEHOLDER — confirm if PM co-approval is also required');

-- Approval workflow steps (chains the DOA rows above into ordered sequences)
INSERT INTO approval_workflow_steps (org_id, module, step_no, doa_id, is_parallel, sla_hours)
SELECT 1, 'purchase_order', 1, id, FALSE, 48 FROM delegation_of_authority WHERE module='purchase_order' AND approval_level=1;
-- (repeat pattern per module — omitted here for brevity; same INSERT shape for variation,
--  contract_signing, material_requisition, tender_submission, vendor_invoice)

-- System settings (examples)
INSERT INTO system_settings (org_id, setting_key, setting_value, data_type) VALUES
(1, 'default_currency', 'EGP', 'string'),
(1, 'default_retention_percent', '10', 'number'),  -- PLACEHOLDER — confirm actual company standard
(1, 'fiscal_year_start_month', '1', 'number');
