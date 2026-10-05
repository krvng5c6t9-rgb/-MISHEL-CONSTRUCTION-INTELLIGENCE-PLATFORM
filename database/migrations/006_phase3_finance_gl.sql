-- ============================================================================
-- PHASE 3.1 — CHART OF ACCOUNTS + GL POSTING RULES (configurable, not hardcoded —
-- same principle as delegation_of_authority: account mappings live in data)
-- ============================================================================

CREATE TABLE chart_of_accounts (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    account_code        VARCHAR(20) NOT NULL,
    account_name        VARCHAR(150) NOT NULL,
    account_type        VARCHAR(20) NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
    parent_account_id   BIGINT REFERENCES chart_of_accounts(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, account_code)
);

CREATE TABLE gl_posting_rules (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    source_module       VARCHAR(20) NOT NULL CHECK (source_module IN ('cost_transaction','ipc','payment')),
    source_subtype      VARCHAR(30),
        -- when source_module='cost_transaction': mirrors cost_transactions.source_module
        -- ('procurement','subcontract','manual_adjustment', etc.) — lets procurement and
        -- subcontract cost hit different GL accounts even though both post through the
        -- same cost_transactions table.
    debit_account_id    BIGINT NOT NULL REFERENCES chart_of_accounts(id),
    credit_account_id   BIGINT NOT NULL REFERENCES chart_of_accounts(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from       DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to          DATE,
    notes                   TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (debit_account_id <> credit_account_id)
);
CREATE INDEX idx_gl_rules_lookup ON gl_posting_rules(org_id, source_module, source_subtype, is_active);

-- ============================================================================
-- PHASE 3.2 — GENERAL LEDGER
-- ============================================================================

CREATE TABLE general_ledger (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    project_id          BIGINT REFERENCES projects(id),        -- NULL = non-project overhead
    account_id          BIGINT NOT NULL REFERENCES chart_of_accounts(id),
    transaction_date    DATE NOT NULL,
    debit               NUMERIC(18,2) NOT NULL DEFAULT 0,
    credit               NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency_id            BIGINT NOT NULL REFERENCES currencies(id),
    source_module             VARCHAR(20) NOT NULL CHECK (source_module IN ('cost_transaction','ipc','payment','manual_journal')),
    source_table                 VARCHAR(60) NOT NULL,
    source_record_id                BIGINT NOT NULL,
    journal_batch_id                   BIGINT NOT NULL,   -- groups the paired debit+credit lines of one posting event
    description                           TEXT,
    reversal_of_gl_id                        BIGINT REFERENCES general_ledger(id),
    created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)),
    CHECK (source_module = 'manual_journal' OR reversal_of_gl_id IS NULL)
);
CREATE INDEX idx_gl_project_account ON general_ledger(project_id, account_id);
CREATE INDEX idx_gl_source          ON general_ledger(source_table, source_record_id);
CREATE INDEX idx_gl_batch           ON general_ledger(journal_batch_id);
CREATE SEQUENCE gl_journal_batch_seq;   -- app layer pulls nextval() once per posting event, reuses it for every line in that batch

-- ============================================================================
-- PHASE 3.3 — MANUAL JOURNAL ENTRIES (Finance's controlled correction path —
-- the only way Finance ever touches the GL by hand)
-- ============================================================================

CREATE TABLE manual_journal_entries (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    project_id          BIGINT REFERENCES projects(id),
    entry_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    description          TEXT NOT NULL,
    reason_category         VARCHAR(30) NOT NULL CHECK (reason_category IN ('reclassification','accrual','correction','write_off','other')),
    requested_by               BIGINT NOT NULL REFERENCES users(id),
    status                        VARCHAR(20) NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft','pending_approval','approved','rejected','posted','cancelled')),
    approval_instance_id             BIGINT REFERENCES approval_instances(id),
    posted_journal_batch_id             BIGINT,
    posted_at                              TIMESTAMPTZ,
    created_at                                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE manual_journal_entry_lines (
    id                  BIGSERIAL PRIMARY KEY,
    journal_entry_id     BIGINT NOT NULL REFERENCES manual_journal_entries(id) ON DELETE CASCADE,
    account_id             BIGINT NOT NULL REFERENCES chart_of_accounts(id),
    debit                     NUMERIC(18,2) NOT NULL DEFAULT 0,
    credit                     NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency_id                   BIGINT NOT NULL REFERENCES currencies(id),
    description                      TEXT,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0))
);
CREATE INDEX idx_mje_lines_entry ON manual_journal_entry_lines(journal_entry_id);

-- ============================================================================
-- PHASE 3.4 — CLIENT PAYMENT CERTIFICATES (IPC)
-- ============================================================================

CREATE TABLE ipcs (
    id                          BIGSERIAL PRIMARY KEY,
    project_id                   BIGINT NOT NULL REFERENCES projects(id),
    contract_id                    BIGINT NOT NULL REFERENCES contracts(id),
    ipc_no                            VARCHAR(20) NOT NULL,
    period_from                          DATE NOT NULL,
    period_to                               DATE NOT NULL,
    gross_work_done_this_period                NUMERIC(18,2) NOT NULL DEFAULT 0,
    cumulative_gross_work_done                    NUMERIC(18,2) NOT NULL DEFAULT 0,
    materials_on_site_value                          NUMERIC(18,2) NOT NULL DEFAULT 0,
    less_retention                                      NUMERIC(18,2) NOT NULL DEFAULT 0,
    less_advance_recovery                                  NUMERIC(18,2) NOT NULL DEFAULT 0,
    less_previous_certified                                   NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_amount_due                                               NUMERIC(18,2) GENERATED ALWAYS AS (
                                                                      gross_work_done_this_period + materials_on_site_value
                                                                      - less_retention - less_advance_recovery - less_previous_certified
                                                                  ) STORED,
    status                                                          VARCHAR(20) NOT NULL DEFAULT 'draft'
                                                                        CHECK (status IN ('draft','submitted_to_client','client_approved','disputed','posted','paid')),
    approval_instance_id                                               BIGINT REFERENCES approval_instances(id),  -- internal sign-off, before client submission
    prepared_by                                                           BIGINT NOT NULL REFERENCES users(id),
    submitted_date                                                           DATE,
    client_approved_date                                                       DATE,
    posted_ar_id                                                                  BIGINT,  -- FK added after accounts_receivable table
    paid_date                                                                        DATE,
    created_at                                                                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                                             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, ipc_no)
);
CREATE INDEX idx_ipcs_project_status ON ipcs(project_id, status);

CREATE TABLE ipc_boq_lines (
    id                      BIGSERIAL PRIMARY KEY,
    ipc_id                    BIGINT NOT NULL REFERENCES ipcs(id) ON DELETE CASCADE,
    project_boq_item_id         BIGINT NOT NULL REFERENCES project_boq(id),
    quantity_this_period            NUMERIC(14,3) NOT NULL,
    cumulative_quantity                NUMERIC(14,3) NOT NULL,
    unit_rate                             NUMERIC(14,2) NOT NULL,
    amount_this_period                       NUMERIC(18,2) GENERATED ALWAYS AS (quantity_this_period * unit_rate) STORED,
    cumulative_amount                           NUMERIC(18,2) GENERATED ALWAYS AS (cumulative_quantity * unit_rate) STORED,
    quantity_sheet_id                              BIGINT REFERENCES quantity_sheets(id),  -- the site evidence this line is drawn from
    created_at                                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ipc_boq_lines_ipc ON ipc_boq_lines(ipc_id);

CREATE TABLE ipc_supporting_docs (
    id                  BIGSERIAL PRIMARY KEY,
    ipc_id              BIGINT NOT NULL REFERENCES ipcs(id) ON DELETE CASCADE,
    document_id          BIGINT NOT NULL REFERENCES documents(id),
    doc_type                VARCHAR(30) CHECK (doc_type IN ('quantity_sheet','photos','measurement_certificate','other')),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE retention_ledger (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    ipc_id               BIGINT NOT NULL REFERENCES ipcs(id),
    retained_amount         NUMERIC(18,2) NOT NULL,
    release_type               VARCHAR(30) CHECK (release_type IN ('half_at_substantial_completion','half_at_dlp_end','other')),
    release_status                 VARCHAR(20) NOT NULL DEFAULT 'held' CHECK (release_status IN ('held','released')),
    release_date                      DATE,
    created_at                           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_retention_project_status ON retention_ledger(project_id, release_status);

-- ============================================================================
-- PHASE 3.5 — AP / AR / BANKING / PAYMENTS
-- ============================================================================

CREATE TABLE accounts_payable (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    vendor_id            BIGINT NOT NULL REFERENCES vendors_subcontractors(id),
    project_id             BIGINT REFERENCES projects(id),
    source_type              VARCHAR(20) NOT NULL CHECK (source_type IN ('vendor_invoice','subcontract_certificate')),
    source_record_id            BIGINT NOT NULL,
    amount                         NUMERIC(18,2) NOT NULL,
    currency_id                       BIGINT NOT NULL REFERENCES currencies(id),
    due_date                             DATE,
    status                                  VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid')),
    created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_type, source_record_id)
);
CREATE INDEX idx_ap_vendor_status ON accounts_payable(vendor_id, status);

CREATE TABLE accounts_receivable (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    client_id             BIGINT NOT NULL REFERENCES clients(id),
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    ipc_id                      BIGINT NOT NULL REFERENCES ipcs(id),
    amount                         NUMERIC(18,2) NOT NULL,
    currency_id                       BIGINT NOT NULL REFERENCES currencies(id),
    due_date                             DATE,
    status                                  VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid')),
    created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ipc_id)
);
CREATE INDEX idx_ar_client_status ON accounts_receivable(client_id, status);

ALTER TABLE ipcs ADD CONSTRAINT fk_ipc_posted_ar FOREIGN KEY (posted_ar_id) REFERENCES accounts_receivable(id);

CREATE TABLE bank_accounts (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    bank_name            VARCHAR(150) NOT NULL,
    account_no             VARCHAR(50) NOT NULL,
    currency_id               BIGINT NOT NULL REFERENCES currencies(id),
    is_active                    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, account_no)
);

CREATE TABLE payments (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    payment_type         VARCHAR(20) NOT NULL CHECK (payment_type IN ('incoming','outgoing')),
    party_type              VARCHAR(20) NOT NULL CHECK (party_type IN ('client','vendor')),
    party_id                   BIGINT NOT NULL,  -- polymorphic: clients.id or vendors_subcontractors.id, per party_type
    related_ap_id                 BIGINT REFERENCES accounts_payable(id),
    related_ar_id                    BIGINT REFERENCES accounts_receivable(id),
    amount                              NUMERIC(18,2) NOT NULL,
    currency_id                            BIGINT NOT NULL REFERENCES currencies(id),
    payment_date                              DATE NOT NULL DEFAULT CURRENT_DATE,
    bank_account_id                              BIGINT NOT NULL REFERENCES bank_accounts(id),
    method                                          VARCHAR(20) NOT NULL CHECK (method IN ('transfer','cheque','cash')),
    reference_no                                       VARCHAR(50),
    status                                                VARCHAR(20) NOT NULL DEFAULT 'draft'
                                                              CHECK (status IN ('draft','approved','posted','reconciled')),
    approval_instance_id                                     BIGINT REFERENCES approval_instances(id),
    created_by                                                  BIGINT REFERENCES users(id),
    created_at                                                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (payment_type = 'outgoing' AND party_type = 'vendor' AND related_ap_id IS NOT NULL AND related_ar_id IS NULL)
        OR
        (payment_type = 'incoming' AND party_type = 'client' AND related_ar_id IS NOT NULL AND related_ap_id IS NULL)
    )
);
CREATE INDEX idx_payments_bank_account ON payments(bank_account_id, payment_date);
CREATE INDEX idx_payments_related_ap   ON payments(related_ap_id);
CREATE INDEX idx_payments_related_ar   ON payments(related_ar_id);

CREATE TABLE bank_reconciliation (
    id                  BIGSERIAL PRIMARY KEY,
    bank_account_id      BIGINT NOT NULL REFERENCES bank_accounts(id),
    statement_date          DATE NOT NULL,
    statement_balance          NUMERIC(18,2) NOT NULL,
    book_balance                  NUMERIC(18,2) NOT NULL,
    reconciled_flag                  BOOLEAN NOT NULL DEFAULT FALSE,
    discrepancy_notes                   TEXT,
    reconciled_by                          BIGINT REFERENCES users(id),
    created_at                                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bank_account_id, statement_date)
);

-- ============================================================================
-- PHASE 3.6 — CASH FLOW (rollup tables — every figure traces back to AP/AR/
-- PO/subcontract payment terms; nothing here is a source of truth on its own)
-- ============================================================================

CREATE TABLE cash_flow_forecast (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    period_month         DATE NOT NULL,   -- first day of month convention
    forecast_inflow         NUMERIC(18,2) NOT NULL DEFAULT 0,
    forecast_outflow            NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_cash_flow                   NUMERIC(18,2) GENERATED ALWAYS AS (forecast_inflow - forecast_outflow) STORED,
    prepared_by                        BIGINT REFERENCES users(id),
    version_date                          DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at                                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, period_month, version_date)
);

CREATE TABLE cash_flow_actual (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id),
    period_month          DATE NOT NULL,
    actual_inflow             NUMERIC(18,2) NOT NULL DEFAULT 0,
    actual_outflow               NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, period_month)
);

CREATE TABLE company_cash_position (
    id                  BIGSERIAL PRIMARY KEY,
    org_id              BIGINT NOT NULL REFERENCES organizations(id),
    as_of_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    total_bank_balance    NUMERIC(18,2) NOT NULL,
    total_receivables        NUMERIC(18,2) NOT NULL,
    total_payables               NUMERIC(18,2) NOT NULL,
    net_position                    NUMERIC(18,2) GENERATED ALWAYS AS (total_bank_balance + total_receivables - total_payables) STORED,
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, as_of_date)
);

-- ============================================================================
-- END PHASE 3 DDL
-- ============================================================================
-- ----------------------------------------------------------------------------
-- 2.1 GENERAL LEDGER: append-only, same discipline as cost_transactions,
-- cost_adjustment_requests, and cost_adjustment_sets before it.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_general_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'general_ledger is an append-only ledger — % is not permitted on row id %. Corrections must be posted as a new balanced batch via manual_journal_entries.',
        TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_update_general_ledger BEFORE UPDATE ON general_ledger
    FOR EACH ROW EXECUTE FUNCTION prevent_general_ledger_mutation();
CREATE TRIGGER trg_block_delete_general_ledger BEFORE DELETE ON general_ledger
    FOR EACH ROW EXECUTE FUNCTION prevent_general_ledger_mutation();


-- ----------------------------------------------------------------------------
-- 2.2 GENERAL LEDGER: validate every row against its source before it lands —
-- same pattern as validate_cost_transaction_insert(), one branch per legal
-- source_module (see Section 1.1 for why vendor_invoice/subcontract_certificate
-- are NOT separate branches here).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION validate_gl_insert()
RETURNS TRIGGER AS $$
DECLARE
    ct  cost_transactions%ROWTYPE;
    ipc ipcs%ROWTYPE;
    pay payments%ROWTYPE;
    mje manual_journal_entries%ROWTYPE;
BEGIN
    IF NEW.source_module = 'cost_transaction' THEN
        IF NEW.source_table <> 'cost_transactions' THEN
            RAISE EXCEPTION 'cost_transaction GL rows must have source_table = ''cost_transactions''.';
        END IF;
        SELECT * INTO ct FROM cost_transactions WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cost_transactions row % not found', NEW.source_record_id;
        END IF;
        IF ct.is_posted_to_gl THEN
            RAISE EXCEPTION 'cost_transactions % is already posted to GL. Duplicate posting is not permitted.', ct.id;
        END IF;
        IF NEW.project_id IS DISTINCT FROM ct.project_id THEN
            RAISE EXCEPTION 'GL project_id must match cost_transactions.project_id for row %.', ct.id;
        END IF;
        IF NEW.currency_id <> ct.currency_id THEN
            RAISE EXCEPTION 'GL currency_id must match cost_transactions.currency_id for row %.', ct.id;
        END IF;

    ELSIF NEW.source_module = 'ipc' THEN
        IF NEW.source_table <> 'ipcs' THEN
            RAISE EXCEPTION 'ipc GL rows must have source_table = ''ipcs''.';
        END IF;
        SELECT * INTO ipc FROM ipcs WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ipcs row % not found', NEW.source_record_id;
        END IF;
        IF ipc.status <> 'client_approved' THEN
            RAISE EXCEPTION 'ipcs % has status "%" — only a client_approved IPC may post to GL.', ipc.id, ipc.status;
        END IF;
        IF ipc.posted_ar_id IS NOT NULL THEN
            RAISE EXCEPTION 'ipcs % has already posted to GL. Duplicate posting is not permitted.', ipc.id;
        END IF;
        IF NEW.project_id <> ipc.project_id THEN
            RAISE EXCEPTION 'GL project_id must match ipcs.project_id for row %.', ipc.id;
        END IF;

    ELSIF NEW.source_module = 'payment' THEN
        IF NEW.source_table <> 'payments' THEN
            RAISE EXCEPTION 'payment GL rows must have source_table = ''payments''.';
        END IF;
        SELECT * INTO pay FROM payments WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'payments row % not found', NEW.source_record_id;
        END IF;
        IF pay.status <> 'approved' THEN
            RAISE EXCEPTION 'payments % has status "%" — only an approved payment may post to GL.', pay.id, pay.status;
        END IF;
        IF NEW.currency_id <> pay.currency_id THEN
            RAISE EXCEPTION 'GL currency_id must match payments.currency_id for row %.', pay.id;
        END IF;

    ELSIF NEW.source_module = 'manual_journal' THEN
        IF NEW.source_table <> 'manual_journal_entries' THEN
            RAISE EXCEPTION 'manual_journal GL rows must have source_table = ''manual_journal_entries''.';
        END IF;
        SELECT * INTO mje FROM manual_journal_entries WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'manual_journal_entries row % not found', NEW.source_record_id;
        END IF;
        IF mje.status <> 'approved' THEN
            RAISE EXCEPTION 'manual_journal_entries % has status "%" — only an approved entry may post to GL.', mje.id, mje.status;
        END IF;

    ELSE
        RAISE EXCEPTION 'Unrecognized GL source_module "%".', NEW.source_module;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_gl_insert BEFORE INSERT ON general_ledger
    FOR EACH ROW EXECUTE FUNCTION validate_gl_insert();


-- ----------------------------------------------------------------------------
-- 2.3 GENERAL LEDGER: every posting event must be a balanced double-entry
-- batch. Deferred to transaction commit so both lines of a batch can land
-- before the check runs.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_gl_batch_balance()
RETURNS TRIGGER AS $$
DECLARE
    bal NUMERIC(18,2);
BEGIN
    SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) INTO bal
    FROM general_ledger WHERE journal_batch_id = NEW.journal_batch_id;

    IF bal <> 0 THEN
        RAISE EXCEPTION 'general_ledger journal_batch_id % does not balance (debit - credit = %). Every posting event must be a balanced double-entry batch.',
            NEW.journal_batch_id, bal;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_gl_batch_balance
    AFTER INSERT ON general_ledger
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_gl_batch_balance();


-- ----------------------------------------------------------------------------
-- 2.4 MANUAL JOURNAL ENTRIES: status guard + line-lock, same shape as the
-- subcontract_certificates guards from Phase 2.1.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_manual_journal_entry_status()
RETURNS TRIGGER AS $$
DECLARE
    line_balance NUMERIC(18,2);
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'draft'            AND NEW.status IN ('pending_approval','cancelled'))
        OR (OLD.status = 'pending_approval' AND NEW.status IN ('approved','rejected','cancelled'))
        OR (OLD.status = 'approved'         AND NEW.status = 'posted')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on manual_journal_entries %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    -- Cannot even submit an unbalanced entry for approval.
    IF NEW.status = 'pending_approval' THEN
        SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) INTO line_balance
        FROM manual_journal_entry_lines WHERE journal_entry_id = NEW.id;
        IF line_balance <> 0 THEN
            RAISE EXCEPTION 'manual_journal_entries % does not balance (debit - credit = %) — cannot submit for approval.',
                NEW.id, line_balance;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_manual_journal_entry_status
    BEFORE UPDATE ON manual_journal_entries
    FOR EACH ROW EXECUTE FUNCTION guard_manual_journal_entry_status();


CREATE OR REPLACE FUNCTION guard_manual_journal_entry_lines_lock()
RETURNS TRIGGER AS $$
DECLARE
    entry_id     BIGINT;
    entry_status VARCHAR(20);
BEGIN
    entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    SELECT status INTO entry_status FROM manual_journal_entries WHERE id = entry_id;

    IF entry_status IS NULL THEN
        RAISE EXCEPTION 'manual_journal_entries row % not found', entry_id;
    END IF;
    IF entry_status <> 'draft' THEN
        RAISE EXCEPTION
            'manual_journal_entry_lines cannot be %ed — parent entry % has status "%", not "draft".',
            TG_OP, entry_id, entry_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_manual_journal_entry_lines_lock
    BEFORE INSERT OR UPDATE OR DELETE ON manual_journal_entry_lines
    FOR EACH ROW EXECUTE FUNCTION guard_manual_journal_entry_lines_lock();


-- ----------------------------------------------------------------------------
-- 2.5 IPCs: status chain guard, same shape as subcontract_certificates.
-- draft -> submitted_to_client -> {client_approved, disputed} -> posted -> paid
-- disputed -> submitted_to_client allowed (resubmission after negotiation)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_ipc_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'draft'              AND NEW.status = 'submitted_to_client')
        OR (OLD.status = 'submitted_to_client' AND NEW.status IN ('client_approved','disputed'))
        OR (OLD.status = 'disputed'             AND NEW.status = 'submitted_to_client')
        OR (OLD.status = 'client_approved'       AND NEW.status = 'posted')
        OR (OLD.status = 'posted'                 AND NEW.status = 'paid')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on ipcs %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_ipc_status
    BEFORE UPDATE ON ipcs
    FOR EACH ROW EXECUTE FUNCTION guard_ipc_status();


-- ----------------------------------------------------------------------------
-- 2.6 IPC / certificate-line immutability and financial lock — same pattern
-- as Phase 2.1's subcontract_certificates guards, applied here to ipcs.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_ipc_boq_lines_lock()
RETURNS TRIGGER AS $$
DECLARE
    ipc_id_val BIGINT;
    ipc_status VARCHAR(20);
BEGIN
    ipc_id_val := COALESCE(NEW.ipc_id, OLD.ipc_id);
    SELECT status INTO ipc_status FROM ipcs WHERE id = ipc_id_val;

    IF ipc_status IS NULL THEN
        RAISE EXCEPTION 'ipcs row % not found', ipc_id_val;
    END IF;
    IF ipc_status <> 'draft' THEN
        RAISE EXCEPTION 'ipc_boq_lines cannot be %ed — parent IPC % has status "%", not "draft".',
            TG_OP, ipc_id_val, ipc_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_ipc_boq_lines_lock
    BEFORE INSERT OR UPDATE OR DELETE ON ipc_boq_lines
    FOR EACH ROW EXECUTE FUNCTION guard_ipc_boq_lines_lock();


CREATE OR REPLACE FUNCTION guard_ipc_financial_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status <> 'draft' THEN
        IF NEW.gross_work_done_this_period <> OLD.gross_work_done_this_period
           OR NEW.materials_on_site_value      <> OLD.materials_on_site_value
           OR NEW.less_retention                 <> OLD.less_retention
           OR NEW.less_advance_recovery             <> OLD.less_advance_recovery
           OR NEW.less_previous_certified             <> OLD.less_previous_certified
           OR NEW.project_id                             <> OLD.project_id
           OR NEW.contract_id                              <> OLD.contract_id
           OR NEW.ipc_no                                     <> OLD.ipc_no
        THEN
            RAISE EXCEPTION
                'ipcs % has left draft status — financial and identity fields are frozen.', OLD.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_ipc_financial_lock
    BEFORE UPDATE ON ipcs
    FOR EACH ROW EXECUTE FUNCTION guard_ipc_financial_lock();


-- ----------------------------------------------------------------------------
-- 2.7 PAYMENTS: status guard.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_payment_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'draft'    AND NEW.status = 'approved')
        OR (OLD.status = 'approved' AND NEW.status = 'posted')
        OR (OLD.status = 'posted'   AND NEW.status = 'reconciled')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on payments %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_payment_status
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION guard_payment_status();
-- Placeholder DOA rows — dummy round numbers, same caveat as every prior seed.
-- *** CONFIRM REAL THRESHOLDS BEFORE GO-LIVE ***
INSERT INTO delegation_of_authority (org_id, module, min_amount, max_amount, currency_id, approval_level, approver_role_id, notes) VALUES
(1, 'ipc_submission',          0,        1000000, 1, 1, (SELECT id FROM roles WHERE role_name='Project Manager'),         'PLACEHOLDER'),
(1, 'ipc_submission',          1000000.01, NULL,  1, 1, (SELECT id FROM roles WHERE role_name='Contracts Manager'),       'PLACEHOLDER'),
(1, 'manual_journal_entry',    0,        50000,   1, 1, (SELECT id FROM roles WHERE role_name='Finance Manager'),         'PLACEHOLDER'),
(1, 'manual_journal_entry',    50000.01, NULL,    1, 1, (SELECT id FROM roles WHERE role_name='General Manager'),         'PLACEHOLDER'),
(1, 'payment',                 0,        100000,  1, 1, (SELECT id FROM roles WHERE role_name='Finance Manager'),         'PLACEHOLDER'),
(1, 'payment',                 100000.01, NULL,   1, 1, (SELECT id FROM roles WHERE role_name='General Manager'),         'PLACEHOLDER');

INSERT INTO approval_workflow_steps (org_id, module, step_no, doa_id, is_parallel, sla_hours)
SELECT 1, module, 1, id, FALSE, 48
FROM delegation_of_authority
WHERE module IN ('ipc_submission','manual_journal_entry','payment') AND approval_level = 1;

-- Role activation
INSERT INTO roles (org_id, role_name, is_system_role) VALUES
(1, 'Accountant', FALSE);
