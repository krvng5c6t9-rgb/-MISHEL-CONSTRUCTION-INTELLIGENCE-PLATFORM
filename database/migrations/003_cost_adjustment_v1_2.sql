DROP TRIGGER IF EXISTS trg_prevent_posted_adjustment_delete ON cost_adjustment_requests;
DROP FUNCTION IF EXISTS prevent_posted_adjustment_delete();

CREATE OR REPLACE FUNCTION prevent_cost_adjustment_request_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'cost_adjustment_requests row % cannot be physically deleted (status "%"). This table is append-only — cancel a draft via status update instead.',
        OLD.id, OLD.status;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_cost_adjustment_request_delete
    BEFORE DELETE ON cost_adjustment_requests
    FOR EACH ROW EXECUTE FUNCTION prevent_cost_adjustment_request_delete();
ALTER TABLE cost_adjustment_requests
    ADD COLUMN cancellation_reason TEXT,
    ADD COLUMN cancelled_by        BIGINT REFERENCES users(id),
    ADD COLUMN cancelled_at        TIMESTAMPTZ;

ALTER TABLE cost_adjustment_requests
    ADD CONSTRAINT chk_car_cancellation_fields_together
    CHECK (
        (cancellation_reason IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL)
        OR (cancellation_reason IS NOT NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
    );
CREATE TABLE cost_adjustment_sets (
    id                          BIGSERIAL PRIMARY KEY,
    org_id                      BIGINT NOT NULL REFERENCES organizations(id),
    root_cost_transaction_id    BIGINT NOT NULL REFERENCES cost_transactions(id),
        -- always the TRUE original system-posted row this set ultimately corrects —
        -- never another adjustment row, even across a supersede chain
    supersedes_set_id           BIGINT REFERENCES cost_adjustment_sets(id),
        -- NULL = a fresh, first-time correction on root_cost_transaction_id
        -- NOT NULL = this set exists because the replacement of an earlier set was itself wrong
    supersede_reason            TEXT,
    status                      VARCHAR(20) NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active','superseded')),
    superseded_by_set_id        BIGINT REFERENCES cost_adjustment_sets(id),
    superseded_at                TIMESTAMPTZ,
    created_by                    BIGINT NOT NULL REFERENCES users(id),
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (supersedes_set_id IS DISTINCT FROM id),
    CHECK (supersedes_set_id IS NULL OR supersede_reason IS NOT NULL),
    CHECK (
        (status = 'active'     AND superseded_by_set_id IS NULL     AND superseded_at IS NULL)
        OR
        (status = 'superseded' AND superseded_by_set_id IS NOT NULL AND superseded_at IS NOT NULL)
    )
);

-- Linear chain only: each set can be superseded by at most one other set —
-- this is what makes it a chain, never a tree.
CREATE UNIQUE INDEX uq_cas_one_superseder_per_set
    ON cost_adjustment_sets(supersedes_set_id)
    WHERE supersedes_set_id IS NOT NULL;

CREATE INDEX idx_cas_root_txn        ON cost_adjustment_sets(root_cost_transaction_id);
CREATE INDEX idx_cas_supersedes      ON cost_adjustment_sets(supersedes_set_id);

ALTER TABLE cost_adjustment_requests
    ADD COLUMN adjustment_set_id BIGINT NOT NULL REFERENCES cost_adjustment_sets(id);
    -- NOT NULL is safe to add directly: no production data exists yet on this table
    -- (Phase 1 / addendum are still pre-go-live). If this ever runs against a
    -- populated table, backfill adjustment_set_id per existing reversal/replacement
    -- pair before adding the NOT NULL constraint.

CREATE INDEX idx_car_adjustment_set ON cost_adjustment_requests(adjustment_set_id);
CREATE OR REPLACE FUNCTION apply_cost_adjustment_set_supersede()
RETURNS TRIGGER AS $$
DECLARE
    old_set                cost_adjustment_sets%ROWTYPE;
    root_txn                cost_transactions%ROWTYPE;
    old_set_has_posted_repl  BOOLEAN;
BEGIN
    SELECT * INTO root_txn FROM cost_transactions WHERE id = NEW.root_cost_transaction_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'root_cost_transaction_id % not found in cost_transactions', NEW.root_cost_transaction_id;
    END IF;
    IF root_txn.source_module = 'manual_adjustment' THEN
        RAISE EXCEPTION
            'root_cost_transaction_id % is itself an adjustment row. A set''s root must always be the original system-posted transaction, even across a supersede chain.',
            root_txn.id;
    END IF;

    IF NEW.supersedes_set_id IS NOT NULL THEN
        SELECT * INTO old_set FROM cost_adjustment_sets WHERE id = NEW.supersedes_set_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'supersedes_set_id % not found', NEW.supersedes_set_id;
        END IF;
        IF old_set.status <> 'active' THEN
            RAISE EXCEPTION 'cost_adjustment_sets % is already superseded and cannot be superseded again.', old_set.id;
        END IF;
        IF old_set.root_cost_transaction_id <> NEW.root_cost_transaction_id THEN
            RAISE EXCEPTION
                'A superseding set must share the same root_cost_transaction_id (%) as the set it supersedes (set %, root %).',
                NEW.root_cost_transaction_id, old_set.id, old_set.root_cost_transaction_id;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM cost_adjustment_requests
            WHERE adjustment_set_id = old_set.id
              AND adjustment_type = 'replacement'
              AND status = 'posted'
        ) INTO old_set_has_posted_repl;
        IF NOT old_set_has_posted_repl THEN
            RAISE EXCEPTION
                'cost_adjustment_sets % has no posted replacement to correct — there is nothing to supersede yet.',
                old_set.id;
        END IF;

        UPDATE cost_adjustment_sets
        SET status = 'superseded', superseded_by_set_id = NEW.id, superseded_at = now(), updated_at = now()
        WHERE id = old_set.id;
    END IF;

    RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_cost_adjustment_set_supersede
    AFTER INSERT ON cost_adjustment_sets
    FOR EACH ROW EXECUTE FUNCTION apply_cost_adjustment_set_supersede();
CREATE OR REPLACE FUNCTION validate_cost_adjustment_request()
RETURNS TRIGGER AS $$
DECLARE
    o        cost_transactions%ROWTYPE;
    rev      cost_adjustment_requests%ROWTYPE;
    my_set   cost_adjustment_sets%ROWTYPE;
    old_repl cost_adjustment_requests%ROWTYPE;
BEGIN
    SELECT * INTO my_set FROM cost_adjustment_sets WHERE id = NEW.adjustment_set_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'adjustment_set_id % not found in cost_adjustment_sets', NEW.adjustment_set_id;
    END IF;

    IF NEW.adjustment_type = 'reversal' THEN

        SELECT * INTO o FROM cost_transactions WHERE id = NEW.original_cost_transaction_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'original_cost_transaction_id % not found in cost_transactions',
                NEW.original_cost_transaction_id;
        END IF;

        IF o.source_module = 'manual_adjustment' THEN
            -- Reversing an adjustment row directly is never allowed — that is
            -- exactly the "adjustment-of-adjustment tree" this patch closes off.
            -- The only legal route is a supersede set.
            IF my_set.supersedes_set_id IS NULL THEN
                RAISE EXCEPTION
                    'cost_transactions row % is itself a manual adjustment and cannot be reversed directly. To correct a wrong replacement, first create a cost_adjustment_sets row with supersedes_set_id set, then raise this reversal inside that new set.',
                    o.id;
            END IF;

            SELECT * INTO old_repl
            FROM cost_adjustment_requests
            WHERE adjustment_set_id = my_set.supersedes_set_id
              AND adjustment_type = 'replacement'
              AND status = 'posted';
            IF NOT FOUND OR old_repl.posted_cost_transaction_id <> o.id THEN
                RAISE EXCEPTION
                    'A supersede reversal must target exactly the posted replacement of the set being superseded (set %). Transaction % is not that row.',
                    my_set.supersedes_set_id, o.id;
            END IF;
        ELSE
            -- Ordinary, first-time reversal: must target this set's own declared root.
            IF o.id <> my_set.root_cost_transaction_id THEN
                RAISE EXCEPTION
                    'A non-supersede reversal must target this set''s root_cost_transaction_id (%). Got %.',
                    my_set.root_cost_transaction_id, o.id;
            END IF;
        END IF;

        IF NEW.project_id <> o.project_id THEN
            RAISE EXCEPTION 'Reversal project_id (%) must match the transaction being reversed (%).', NEW.project_id, o.project_id;
        END IF;
        IF NEW.cost_code_id <> o.cost_code_id THEN
            RAISE EXCEPTION 'Reversal cost_code_id (%) must match the transaction being reversed (%).', NEW.cost_code_id, o.cost_code_id;
        END IF;
        IF NEW.boq_item_id IS DISTINCT FROM o.boq_item_id THEN
            RAISE EXCEPTION 'Reversal boq_item_id (%) must match the transaction being reversed (%).', NEW.boq_item_id, o.boq_item_id;
        END IF;
        IF NEW.currency_id <> o.currency_id THEN
            RAISE EXCEPTION 'Reversal currency_id (%) must match the transaction being reversed (%). Cross-currency reversal is not permitted.', NEW.currency_id, o.currency_id;
        END IF;
        IF NEW.transaction_type <> o.transaction_type THEN
            RAISE EXCEPTION 'Reversal transaction_type (%) must match the transaction being reversed (%).', NEW.transaction_type, o.transaction_type;
        END IF;
        IF NEW.requested_amount <> -1 * o.amount THEN
            RAISE EXCEPTION 'A reversal must exactly negate the amount being reversed (%). Got %.', o.amount, NEW.requested_amount;
        END IF;

    ELSIF NEW.adjustment_type = 'replacement' THEN

        SELECT * INTO rev FROM cost_adjustment_requests WHERE id = NEW.linked_reversal_request_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'linked_reversal_request_id % not found', NEW.linked_reversal_request_id;
        END IF;
        IF rev.adjustment_type <> 'reversal' THEN
            RAISE EXCEPTION 'linked_reversal_request_id % is not a reversal request', rev.id;
        END IF;
        IF rev.status <> 'posted' THEN
            RAISE EXCEPTION
                'Cannot raise a replacement against reversal request % — its status is "%". The reversal must be posted first.',
                rev.id, rev.status;
        END IF;
        IF rev.adjustment_set_id <> NEW.adjustment_set_id THEN
            RAISE EXCEPTION
                'A replacement must belong to the same adjustment_set_id (%) as its linked reversal (%).',
                rev.adjustment_set_id, NEW.adjustment_set_id;
        END IF;
        IF NEW.transaction_type <> rev.transaction_type THEN
            RAISE EXCEPTION 'Replacement transaction_type (%) must match the reversed transaction_type (%).',
                NEW.transaction_type, rev.transaction_type;
        END IF;
        -- A replacement MAY change project / cost_code / boq_item / currency —
        -- that is its entire purpose. No bucket-match check here, unchanged from v1.1.

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- No change needed to the trigger declaration itself — it already points at this
-- function name (CREATE OR REPLACE FUNCTION updates the body in place).
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

        -- POINT 2: an approved-but-not-posted request is still an authorized audit
        -- event. Cancelling it must leave an explicit, non-deletable record of
        -- who cancelled it, when, and why — not just a silent status flip.
        IF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
            IF NEW.cancellation_reason IS NULL OR NEW.cancelled_by IS NULL OR NEW.cancelled_at IS NULL THEN
                RAISE EXCEPTION
                    'Cancelling an approved cost_adjustment_requests row (%) requires cancellation_reason, cancelled_by, and cancelled_at to all be set in the same update.',
                    OLD.id;
            END IF;
        END IF;
    END IF;

    -- Once submitted, the financial substance is frozen; only workflow/cancellation fields move.
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
           OR NEW.adjustment_set_id IS DISTINCT FROM OLD.adjustment_set_id
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
-- DELETE: unconditional block, same pattern as every other audit-bearing table in this design.
CREATE OR REPLACE FUNCTION prevent_cost_adjustment_set_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'cost_adjustment_sets row % cannot be physically deleted (status "%"). This table is append-only.',
        OLD.id, OLD.status;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_cost_adjustment_set_delete
    BEFORE DELETE ON cost_adjustment_sets
    FOR EACH ROW EXECUTE FUNCTION prevent_cost_adjustment_set_delete();


-- UPDATE: financial identity fields are frozen at insert. The only legal
-- change, ever, is the single active -> superseded transition, and only
-- with the shape apply_cost_adjustment_set_supersede() actually produces.
CREATE OR REPLACE FUNCTION guard_cost_adjustment_set_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'superseded' THEN
        RAISE EXCEPTION
            'cost_adjustment_sets row % is already superseded and is now immutable.', OLD.id;
    END IF;

    -- OLD.status = 'active' beyond this point. No in-place edits while active —
    -- the only legal move is the controlled transition to superseded.
    IF NEW.status <> 'superseded' THEN
        RAISE EXCEPTION
            'cost_adjustment_sets row % cannot be updated while active — the only legal transition is active -> superseded.',
            OLD.id;
    END IF;

    IF NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.root_cost_transaction_id IS DISTINCT FROM OLD.root_cost_transaction_id
       OR NEW.supersedes_set_id IS DISTINCT FROM OLD.supersedes_set_id
       OR NEW.supersede_reason IS DISTINCT FROM OLD.supersede_reason
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION
            'cost_adjustment_sets row % — financial identity fields (org_id, root_cost_transaction_id, supersedes_set_id, supersede_reason, created_by, created_at) cannot change after insert.',
            OLD.id;
    END IF;

    IF NEW.superseded_by_set_id IS NULL OR NEW.superseded_at IS NULL THEN
        RAISE EXCEPTION
            'cost_adjustment_sets row % — superseded_by_set_id and superseded_at must both be set when transitioning to superseded.',
            OLD.id;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_cost_adjustment_set_update
    BEFORE UPDATE ON cost_adjustment_sets
    FOR EACH ROW EXECUTE FUNCTION guard_cost_adjustment_set_update();
