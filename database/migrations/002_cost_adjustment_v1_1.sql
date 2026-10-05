-- ============================================================================
-- ADDENDUM v1.1 — COST TRANSACTIONS CORRECTION LAYER
-- Prerequisite: Phase 0 + Phase 1 schema already applied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ALTER cost_transactions — lineage pointer + sign discipline
-- ----------------------------------------------------------------------------

ALTER TABLE cost_transactions
    ADD COLUMN IF NOT EXISTS reversal_of_transaction_id BIGINT REFERENCES cost_transactions(id);

CREATE INDEX IF NOT EXISTS idx_ct_reversal_of
    ON cost_transactions(reversal_of_transaction_id);

-- Only manual_adjustment rows may carry a negative amount. A negative
-- committed/actual cost from procurement, subcontract, payroll, equipment
-- or overhead is a bug, not a correction.
ALTER TABLE cost_transactions
    ADD CONSTRAINT chk_ct_sign_discipline
    CHECK (source_module = 'manual_adjustment' OR amount >= 0);

-- A reversal pointer is only meaningful on a manual_adjustment row.
ALTER TABLE cost_transactions
    ADD CONSTRAINT chk_ct_reversal_pointer_scope
    CHECK (reversal_of_transaction_id IS NULL OR source_module = 'manual_adjustment');

-- ----------------------------------------------------------------------------
-- 2. cost_adjustment_requests
--    NOTE: no CHECK constraint here references another row or another table.
--    All cross-row rules are enforced by triggers in Section 3.
-- ----------------------------------------------------------------------------

CREATE TABLE cost_adjustment_requests (
    id                              BIGSERIAL PRIMARY KEY,
    org_id                          BIGINT NOT NULL REFERENCES organizations(id),
    project_id                      BIGINT NOT NULL REFERENCES projects(id),
    cost_code_id                    BIGINT NOT NULL REFERENCES cost_codes(id),
    boq_item_id                     BIGINT REFERENCES project_boq(id),
    currency_id                     BIGINT NOT NULL REFERENCES currencies(id),
    transaction_type                VARCHAR(20) NOT NULL
                                        CHECK (transaction_type IN ('committed','actual')),

    adjustment_type                 VARCHAR(20) NOT NULL
                                        CHECK (adjustment_type IN ('reversal','replacement')),

    -- reversal  -> the ledger row being cancelled (mandatory)
    -- replacement -> NULL (a replacement does not point at the bad row directly;
    --                it points at the reversal request that cancelled it)
    original_cost_transaction_id    BIGINT REFERENCES cost_transactions(id),

    -- replacement -> the posted reversal request this replacement follows (mandatory)
    -- reversal    -> NULL
    linked_reversal_request_id      BIGINT REFERENCES cost_adjustment_requests(id),

    reason_category                 VARCHAR(30) NOT NULL
                                        CHECK (reason_category IN (
                                            'data_entry_error','wrong_cost_code','wrong_project',
                                            'duplicate_posting','wrong_amount','wrong_boq_item','other'
                                        )),
    description                     TEXT NOT NULL,

    -- reversal    -> strictly negative, equal to -1 * original.amount
    -- replacement -> strictly positive
    requested_amount                NUMERIC(18,2) NOT NULL,

    requested_by                    BIGINT NOT NULL REFERENCES users(id),
    request_date                    DATE NOT NULL DEFAULT CURRENT_DATE,
    status                          VARCHAR(20) NOT NULL DEFAULT 'draft'
                                        CHECK (status IN ('draft','pending_approval','approved','rejected','posted','cancelled')),
    approval_instance_id            BIGINT REFERENCES approval_instances(id),
    posted_cost_transaction_id      BIGINT REFERENCES cost_transactions(id),
    posted_at                       TIMESTAMPTZ,
    created_by                      BIGINT REFERENCES users(id),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Single-row CHECKs only (all legal in PostgreSQL):
    CONSTRAINT chk_car_amount_nonzero
        CHECK (requested_amount <> 0),
    CONSTRAINT chk_car_reversal_shape
        CHECK (
            adjustment_type <> 'reversal'
            OR (original_cost_transaction_id IS NOT NULL
                AND linked_reversal_request_id IS NULL
                AND requested_amount < 0)
        ),
    CONSTRAINT chk_car_replacement_shape
        CHECK (
            adjustment_type <> 'replacement'
            OR (linked_reversal_request_id IS NOT NULL
                AND original_cost_transaction_id IS NULL
                AND requested_amount > 0)
        ),
    CONSTRAINT chk_car_posted_fields
        CHECK (
            (status = 'posted' AND posted_cost_transaction_id IS NOT NULL AND posted_at IS NOT NULL)
            OR (status <> 'posted' AND posted_cost_transaction_id IS NULL AND posted_at IS NULL)
        )
);

-- Indexes
CREATE INDEX idx_car_project_status      ON cost_adjustment_requests(project_id, status);
CREATE INDEX idx_car_original_txn        ON cost_adjustment_requests(original_cost_transaction_id);
CREATE INDEX idx_car_linked_reversal     ON cost_adjustment_requests(linked_reversal_request_id);
CREATE INDEX idx_car_cost_code           ON cost_adjustment_requests(cost_code_id);
CREATE INDEX idx_car_requested_by        ON cost_adjustment_requests(requested_by);
CREATE INDEX idx_car_approval_instance   ON cost_adjustment_requests(approval_instance_id);

-- RULE 5a: a cost_transaction may not be reversed twice.
-- Only one live reversal request per original transaction; a rejected or
-- cancelled request frees the slot for a new attempt.
CREATE UNIQUE INDEX uq_car_one_live_reversal_per_txn
    ON cost_adjustment_requests(original_cost_transaction_id)
    WHERE adjustment_type = 'reversal'
      AND status NOT IN ('rejected','cancelled');

-- A posted reversal may be followed by at most one live replacement.
CREATE UNIQUE INDEX uq_car_one_live_replacement_per_reversal
    ON cost_adjustment_requests(linked_reversal_request_id)
    WHERE adjustment_type = 'replacement'
      AND status NOT IN ('rejected','cancelled');

-- ----------------------------------------------------------------------------
-- 3. VALIDATION TRIGGERS ON cost_adjustment_requests
-- ----------------------------------------------------------------------------

-- 3.1 Shape + bucket-match validation on INSERT/UPDATE
CREATE OR REPLACE FUNCTION validate_cost_adjustment_request()
RETURNS TRIGGER AS $$
DECLARE
    o   cost_transactions%ROWTYPE;
    rev cost_adjustment_requests%ROWTYPE;
BEGIN
    IF NEW.adjustment_type = 'reversal' THEN

        SELECT * INTO o FROM cost_transactions WHERE id = NEW.original_cost_transaction_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'original_cost_transaction_id % not found in cost_transactions',
                NEW.original_cost_transaction_id;
        END IF;

        -- A reversal may not reverse another adjustment row.
        IF o.source_module = 'manual_adjustment' THEN
            RAISE EXCEPTION
                'cost_transactions row % is itself a manual adjustment and cannot be reversed. Adjustments are corrected by reversing the ORIGINAL source posting.',
                o.id;
        END IF;

        -- RULE 2 + RULE 5d: reversal must cancel in the EXACT same ledger bucket.
        IF NEW.project_id <> o.project_id THEN
            RAISE EXCEPTION 'Reversal project_id (%) must match original (%). A reversal cancels, it never relocates cost.',
                NEW.project_id, o.project_id;
        END IF;
        IF NEW.cost_code_id <> o.cost_code_id THEN
            RAISE EXCEPTION 'Reversal cost_code_id (%) must match original (%). A reversal cancels, it never relocates cost.',
                NEW.cost_code_id, o.cost_code_id;
        END IF;
        IF NEW.boq_item_id IS DISTINCT FROM o.boq_item_id THEN
            RAISE EXCEPTION 'Reversal boq_item_id (%) must match original (%).',
                NEW.boq_item_id, o.boq_item_id;
        END IF;
        IF NEW.currency_id <> o.currency_id THEN
            RAISE EXCEPTION 'Reversal currency_id (%) must match original (%). Cross-currency reversal is not permitted.',
                NEW.currency_id, o.currency_id;
        END IF;
        IF NEW.transaction_type <> o.transaction_type THEN
            RAISE EXCEPTION 'Reversal transaction_type (%) must match original (%). A committed cost is reversed as committed; an actual as actual.',
                NEW.transaction_type, o.transaction_type;
        END IF;

        -- Exact negation — never eyeballed.
        IF NEW.requested_amount <> -1 * o.amount THEN
            RAISE EXCEPTION 'A reversal must exactly negate the original amount (%). Got %.',
                o.amount, NEW.requested_amount;
        END IF;

    ELSIF NEW.adjustment_type = 'replacement' THEN

        SELECT * INTO rev FROM cost_adjustment_requests WHERE id = NEW.linked_reversal_request_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'linked_reversal_request_id % not found', NEW.linked_reversal_request_id;
        END IF;
        IF rev.adjustment_type <> 'reversal' THEN
            RAISE EXCEPTION 'linked_reversal_request_id % is not a reversal request', rev.id;
        END IF;

        -- RULE 3: the replacement may only be raised once the reversal is actually
        -- in the ledger. No relocating cost that has not yet been cancelled.
        IF rev.status <> 'posted' THEN
            RAISE EXCEPTION
                'Cannot raise a replacement against reversal request % — its status is "%". The reversal must be posted first.',
                rev.id, rev.status;
        END IF;

        IF NEW.transaction_type <> rev.transaction_type THEN
            RAISE EXCEPTION 'Replacement transaction_type (%) must match the reversed transaction_type (%).',
                NEW.transaction_type, rev.transaction_type;
        END IF;

        -- A replacement MAY change project / cost_code / boq_item / currency —
        -- that is its entire purpose. No bucket-match check here by design.

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_cost_adjustment_request
    BEFORE INSERT OR UPDATE ON cost_adjustment_requests
    FOR EACH ROW EXECUTE FUNCTION validate_cost_adjustment_request();


-- 3.2 RULE 5c: no changes after posting; legal status transitions only.
CREATE OR REPLACE FUNCTION guard_cost_adjustment_request_status()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'posted' THEN
        RAISE EXCEPTION
            'cost_adjustment_requests row % is posted and is now immutable. Raise a new request instead.',
            OLD.id;
    END IF;

    IF OLD.status IN ('rejected','cancelled') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION
            'cost_adjustment_requests row % is % and cannot be reopened. Raise a new request instead.',
            OLD.id, OLD.status;
    END IF;

    IF NEW.status <> OLD.status THEN
        IF NOT (
               (OLD.status = 'draft'            AND NEW.status IN ('pending_approval','cancelled'))
            OR (OLD.status = 'pending_approval' AND NEW.status IN ('approved','rejected','cancelled'))
            OR (OLD.status = 'approved'         AND NEW.status IN ('posted','cancelled'))
        ) THEN
            RAISE EXCEPTION 'Illegal status transition on cost_adjustment_requests %: % -> %',
                OLD.id, OLD.status, NEW.status;
        END IF;
    END IF;

    -- Once submitted, the financial substance is frozen; only workflow fields move.
    IF OLD.status <> 'draft' THEN
        IF NEW.adjustment_type <> OLD.adjustment_type
           OR NEW.requested_amount <> OLD.requested_amount
           OR NEW.project_id <> OLD.project_id
           OR NEW.cost_code_id <> OLD.cost_code_id
           OR NEW.currency_id <> OLD.currency_id
           OR NEW.transaction_type <> OLD.transaction_type
           OR NEW.boq_item_id IS DISTINCT FROM OLD.boq_item_id
           OR NEW.original_cost_transaction_id IS DISTINCT FROM OLD.original_cost_transaction_id
           OR NEW.linked_reversal_request_id IS DISTINCT FROM OLD.linked_reversal_request_id
        THEN
            RAISE EXCEPTION
                'cost_adjustment_requests % has left draft status — financial fields can no longer change. Cancel it and raise a new request.',
                OLD.id;
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_cost_adjustment_request_status
    BEFORE UPDATE ON cost_adjustment_requests
    FOR EACH ROW EXECUTE FUNCTION guard_cost_adjustment_request_status();


-- 3.3 Posted requests are never deleted — they are part of the audit record.
CREATE OR REPLACE FUNCTION prevent_posted_adjustment_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('posted','approved','rejected') THEN
        RAISE EXCEPTION
            'cost_adjustment_requests row % has status "%" and cannot be deleted. Cancel a draft instead; approved/rejected/posted requests are permanent audit records.',
            OLD.id, OLD.status;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_posted_adjustment_delete
    BEFORE DELETE ON cost_adjustment_requests
    FOR EACH ROW EXECUTE FUNCTION prevent_posted_adjustment_delete();

-- ----------------------------------------------------------------------------
-- 4. LEDGER GUARDS ON cost_transactions
-- ----------------------------------------------------------------------------

-- 4.1 RULE 5b: an adjustment row cannot enter the ledger before its request
--     is approved, and it must match that request field-for-field.
CREATE OR REPLACE FUNCTION validate_cost_transaction_insert()
RETURNS TRIGGER AS $$
DECLARE
    r cost_adjustment_requests%ROWTYPE;
BEGIN
    IF NEW.source_module <> 'manual_adjustment' THEN
        -- System postings (procurement, subcontract, payroll, equipment, overhead)
        -- must not carry a reversal pointer.
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only manual_adjustment rows may set reversal_of_transaction_id.';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.source_table <> 'cost_adjustment_requests' THEN
        RAISE EXCEPTION 'manual_adjustment rows must have source_table = ''cost_adjustment_requests'', got "%".',
            NEW.source_table;
    END IF;

    SELECT * INTO r FROM cost_adjustment_requests WHERE id = NEW.source_record_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No cost_adjustment_requests row with id %', NEW.source_record_id;
    END IF;

    IF r.status <> 'approved' THEN
        RAISE EXCEPTION
            'cost_adjustment_requests % has status "%" — only an approved request may post to the ledger.',
            r.id, r.status;
    END IF;

    IF r.posted_cost_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'cost_adjustment_requests % has already posted transaction %.',
            r.id, r.posted_cost_transaction_id;
    END IF;

    -- Field-for-field match: the ledger row is the request, not a reinterpretation of it.
    IF NEW.project_id <> r.project_id
       OR NEW.cost_code_id <> r.cost_code_id
       OR NEW.boq_item_id IS DISTINCT FROM r.boq_item_id
       OR NEW.currency_id <> r.currency_id
       OR NEW.transaction_type <> r.transaction_type
       OR NEW.amount <> r.requested_amount
    THEN
        RAISE EXCEPTION
            'Posted adjustment does not match approved request % (project/cost_code/boq_item/currency/transaction_type/amount must be identical).',
            r.id;
    END IF;

    -- RULE 3: a reversal row points at the original; a replacement row does not.
    -- One row never both reverses and relocates.
    IF r.adjustment_type = 'reversal' THEN
        IF NEW.reversal_of_transaction_id IS DISTINCT FROM r.original_cost_transaction_id THEN
            RAISE EXCEPTION
                'A reversal posting must set reversal_of_transaction_id = % (the original transaction).',
                r.original_cost_transaction_id;
        END IF;
    ELSE  -- replacement
        IF NEW.reversal_of_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION
                'A replacement posting is a fresh, correct transaction and must NOT set reversal_of_transaction_id. Its lineage is cost_adjustment_requests.linked_reversal_request_id.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_cost_transaction_insert
    BEFORE INSERT ON cost_transactions
    FOR EACH ROW EXECUTE FUNCTION validate_cost_transaction_insert();


-- 4.2 Append-only ledger: posted rows are never updated or deleted.
--     Use this version in Phase 1. Swap to the is_posted_to_gl-exception
--     version only when Phase 3's GL auto-posting job ships.
CREATE OR REPLACE FUNCTION prevent_cost_transactions_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'cost_transactions is an append-only ledger — % is not permitted on row id %. Post a correction via cost_adjustment_requests instead.',
        TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_update_cost_transactions
    BEFORE UPDATE ON cost_transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_cost_transactions_mutation();

CREATE TRIGGER trg_block_delete_cost_transactions
    BEFORE DELETE ON cost_transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_cost_transactions_mutation();

-- ----------------------------------------------------------------------------
-- 5. DOA CONFIGURATION — module = 'cost_adjustment'
--    *** PLACEHOLDER AMOUNTS — CONFIRM REAL THRESHOLDS BEFORE GO-LIVE ***
--    Tier is resolved on ABS(requested_amount): a reversal of 200,000 and a
--    replacement of 200,000 carry identical approval weight.
-- ----------------------------------------------------------------------------

INSERT INTO delegation_of_authority
    (org_id, module, min_amount, max_amount, currency_id, approval_level, approver_role_id, notes)
VALUES
(1, 'cost_adjustment', 0,        25000, 1, 1,
    (SELECT id FROM roles WHERE role_name = 'Project Manager'),
    'PLACEHOLDER — confirm Tier 1 ceiling for cost adjustments'),
(1, 'cost_adjustment', 25000.01, NULL,  1, 1,
    (SELECT id FROM roles WHERE role_name = 'Finance Manager'),
    'PLACEHOLDER — confirm whether Finance replaces or supplements PM above Tier 1');

INSERT INTO approval_workflow_steps (org_id, module, step_no, doa_id, is_parallel, sla_hours)
SELECT 1, 'cost_adjustment', 1, id, FALSE, 48
FROM delegation_of_authority
WHERE module = 'cost_adjustment' AND approval_level = 1;

-- ============================================================================
-- END ADDENDUM v1.1
-- ============================================================================
